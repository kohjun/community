import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { eventSettings, posts, profiles } from "../db/schema";
import { eventLifecycle } from "../db/event-lifecycle-schema";
import type { CommunityFeed, CommunityPost, FeedQuery } from "../domain/community";
import { communityService, feedCursorScope, feedQuerySchema } from "./community-service";
import { discoveryCache, type DiscoveryValue } from "./discovery-cache-store";
import { contentVisible } from "./safety-visibility";
import { visibleAnswerId } from "./discussion-policy";
import { visibleEventVenueId, visibleEventVenueVersion } from "./event-venue-service";
import { postMetadataColumns } from "./post-metadata-sql";
import { eventAvailable } from "./post-reader";
import { preciseTimestamp, encodeCursor } from "./pagination";
import { AppError } from "./errors";
import { z } from "zod";

/** Cache only public, non-personalized discovery. Every reuse passes a fresh DB visibility gate. */
export function cacheableFeed(q: ReturnType<typeof feedQuerySchema.parse>) {
  return (
    q.focus === "all" &&
    !["mine", "bookmarks"].includes(q.view) &&
    !q.cursor &&
    !q.search &&
    q.latitude === undefined &&
    q.longitude === undefined &&
    q.radiusKm === undefined &&
    q.sort !== "nearest" &&
    (q.page ?? 1) <= 5
  );
}
function listPosts(value: DiscoveryValue): CommunityPost[] {
  return Array.isArray(value)
    ? value
    : [...value.posts, ...value.featured, ...(value.hot ?? []), ...(value.upcoming ?? [])];
}
type State = Pick<
  CommunityPost,
  | "id"
  | "author"
  | "isMine"
  | "isLiked"
  | "isBookmarked"
  | "acceptedAnswerId"
  | "verifiedParticipation"
  | "communityVenueId"
  | "communityVenueVersion"
  | "eventAvailable"
> & { revision: string; selectedVote: number | null };
async function liveContext(db: Database, actor: string | null, ids: string[]) {
  const [row] = await db
    .select({
      hasBlocks: actor
        ? sql<boolean>`exists(select 1 from sliper.member_blocks where blocker_id=${actor})`
        : sql<boolean>`false`,
      states: sql<State[]>`${sql`coalesce((select jsonb_agg(jsonb_build_object(
        'id', ${posts.id}, 'revision', ${preciseTimestamp(posts.updatedAt)},
        'author', case when ${posts.isAnonymous} then '익명'
          when ${posts.authorId} is null and ${posts.importedAuthorName} is not null then ${posts.importedAuthorName} || ' · 이전 작성자'
          when ${profiles.id} is null then '탈퇴한 회원' else ${profiles.nickname} end,
        'isMine', ${actor ? sql`${posts.authorId}=${actor}` : sql`false`},
        'isLiked', ${actor ? sql`exists(select 1 from sliper.post_likes l where l.post_id=${posts.id} and l.user_id=${actor})` : sql`false`},
        'isBookmarked', ${actor ? sql`exists(select 1 from sliper.bookmarks b where b.post_id=${posts.id} and b.user_id=${actor})` : sql`false`},
        'selectedVote', ${actor ? sql`(select pv.option_index from sliper.poll_votes pv where pv.post_id=${posts.id} and pv.user_id=${actor})` : sql`null`},
        'acceptedAnswerId', ${visibleAnswerId(actor)},
        'verifiedParticipation', ${postMetadataColumns(actor).verifiedParticipation},
        'communityVenueId', ${visibleEventVenueId(actor, posts.id)},
        'communityVenueVersion', ${visibleEventVenueVersion(actor, posts.id)},
        'eventAvailable', ${eventAvailable}
      )) from ${posts}
      left join ${profiles} on ${profiles.id}=${posts.authorId}
      left join ${eventSettings} on ${eventSettings.postId}=${posts.id}
      left join ${eventLifecycle} on ${eventLifecycle.postId}=${posts.id}
      where ${and(inArray(posts.id, ids), eq(posts.status, "published"), contentVisible("post", posts.id))}), '[]'::jsonb)`}`,
    })
    .from(sql`(select 1) request_context`);
  return row!;
}
export function communityQueries(db: Database) {
  const raw = communityService(db),
    cache = discoveryCache(db);
  async function read<T extends DiscoveryValue>(
    key: string,
    ttl: number,
    actor: string | null,
    publicLoad: () => Promise<T>,
    fallback: () => Promise<T>,
    requiresAvailable = false,
  ): Promise<T> {
    // A clone prevents a caller's mutation or user-specific overlay from contaminating shared data.
    let freshlyLoaded = false;
    const value = structuredClone(
      await cache.read(key, ttl, async () => {
        const result = await publicLoad();
        freshlyLoaded = true;
        return result;
      }),
    ) as T;
    // The anonymous loader already applied current visibility in its DB statement.
    if (!actor && freshlyLoaded) return value;
    const items = listPosts(value),
      ids = [...new Set(items.map((p) => p.id))];
    // An empty public result contains no identity or content to re-authorize.
    if (!items.length) return value;
    const context = await liveContext(db, actor, ids);
    if (context.hasBlocks) return fallback(); // Preserve full pagination and block filtering.
    const states = new Map(context.states.map((s) => [s.id, s]));
    if (
      items.some((p) => states.get(p.id)?.revision !== p.updatedAt) ||
      (requiresAvailable &&
        !Array.isArray(value) &&
        value.posts.some((p) => !states.get(p.id)?.eventAvailable)) ||
      (!Array.isArray(value) && value.upcoming?.some((p) => !states.get(p.id)?.eventAvailable))
    ) {
      cache.delete(key);
      return fallback(); // Deleted/hidden/edited content is never returned from a warm cache.
    }
    for (const p of items) {
      const state = states.get(p.id)!;
      p.author = state.author;
      p.isMine = state.isMine === true;
      p.isLiked = state.isLiked;
      p.isBookmarked = state.isBookmarked;
      p.acceptedAnswerId = state.acceptedAnswerId ?? null;
      if (state.verifiedParticipation) p.verifiedParticipation = state.verifiedParticipation;
      else delete p.verifiedParticipation;
      p.communityVenueId = state.communityVenueId ?? null;
      p.communityVenueVersion = state.communityVenueVersion ?? null;
      p.eventAvailable = p.kind === "모집" && state.eventAvailable === true;
      if (p.poll) p.poll.selected = state.selectedVote;
    }
    return value;
  }
  const day = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  async function feed(actor: string | null, input: FeedQuery = {}): Promise<CommunityFeed> {
    const q = feedQuerySchema.parse(input);
    if (q.rankingAt && new Date(q.rankingAt).getTime() > Date.now())
      throw new AppError("VALIDATION", "인기 목록의 기준 시각을 확인해주세요.");
    if (!cacheableFeed(q)) return raw.feed(actor, q);
    const normalized = { ...q };
    if (q.sort !== "popular" || q.period === "all") delete normalized.rankingAt;
    const key = "feed:" + day() + ":" + JSON.stringify(normalized);
    const value = await read(
      key,
      20_000,
      actor,
      () => raw.feed(null, normalized),
      () => raw.feed(actor, q),
      q.availableOnly === true,
    );
    // Continuation positions remain bound to the requesting actor, even on shared first-page hits.
    const tail = value.posts.at(-1);
    if (value.nextCursor && tail)
      value.nextCursor = encodeCursor(
        feedCursorScope(q, actor, value.rankingAt!),
        tail,
        q.sort === "popular" ? tail.popularityScore : undefined,
      );
    return value;
  }
  async function highlights(actor: string | null) {
    const load = async (user: string | null): Promise<CommunityFeed> => ({
      ...(await raw.highlights(user)),
      posts: [],
      nextCursor: null,
    });
    const value = await read(
      "highlights:" + day(),
      30_000,
      actor,
      () => load(null),
      () => load(actor),
    );
    return { featured: value.featured, hot: value.hot ?? [], upcoming: value.upcoming ?? [] };
  }
  async function homeStories(actor: string | null, input: unknown) {
    const q = z.strictObject({ period: z.enum(["today", "week", "month"]) }).parse(input);
    return read(
      "stories:" + day() + ":" + q.period,
      30_000,
      actor,
      () => raw.homeStories(null, q),
      () => raw.homeStories(actor, q),
    );
  }
  return { feed, highlights, homeStories };
}
