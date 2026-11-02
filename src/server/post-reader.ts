import { previewPost } from "../domain/discussions";
import { visibleAnswerId } from "./discussion-policy";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/connection";
import { eventLifecycle } from "../db/event-lifecycle-schema";
import { eventSettings, posts, profiles } from "../db/schema";
import { applicationUrlSchema, uuidSchema } from "../domain/validation";
import type { CommunityPost } from "../domain/community";
import { presentPostDetail } from "../domain/presenters";
import { AppError } from "./errors";
import { preciseTimestamp } from "./pagination";
import { timeLabel } from "./presentation";
import { contentVisible, authorVisible } from "./safety-visibility";
import { visibleEventVenueId, visibleEventVenueVersion } from "./event-venue-service";
import { periodLikeCount } from "./popularity";
import { postMetadataColumns } from "./post-metadata-sql";
import { unionAll } from "drizzle-orm/pg-core";
export const likeCount = sql<number>`(select count(*)::int from sliper.post_likes l where l.post_id = ${posts.id})`;
const viewCount = sql<number>`(select count(*)::int from sliper.post_daily_views v where v.post_id = ${posts.id})`;
const commentCount = sql<number>`(select count(*)::int from sliper.comments c where c.post_id = ${posts.id} and c.status = 'published')`;
export const eventAvailable = sql<boolean>`coalesce(
  ${eventSettings.open}
  and not exists(select 1 from sliper.event_lifecycle lifecycle where lifecycle.post_id=${posts.id} and lifecycle.cancelled_at is not null)
  and (${eventSettings.startsAt} is null or ${eventSettings.startsAt}>statement_timestamp())
  and (${eventSettings.endsAt} is null or ${eventSettings.endsAt}>statement_timestamp())
  and ${eventSettings.capacity}>(select count(*) from sliper.event_waitlist w where w.post_id=${posts.id} and ((w.state='offered' and w.offer_until>statement_timestamp()) or (w.state='submitted' and exists(select 1 from sliper.event_applications pending where pending.post_id=w.post_id and pending.user_id=w.user_id and pending.status='pending_approval'))))+(select count(*) from sliper.event_applications a
    where a.post_id=${posts.id}
      and (a.status='confirmed' or (a.status='pending_payment' and a.expires_at>statement_timestamp()))),
  false)`;
interface PostSelection {
  where?: SQL | undefined;
  limit: number;
  popular?: boolean | SQL<number>;
  location?: { distance: SQL<number | null>; nearest: boolean } | undefined;
  offset?: number;
  upcoming?: boolean;
  detail?: boolean;
}

export function createPostReader(db: Database) {
  function readRows(
    where: SQL | undefined,
    actor: string | null,
    limit: number,
    popular: boolean | SQL<number> = false,
    location?: { distance: SQL<number | null>; nearest: boolean },
    offset = 0,
    upcoming = false,
    selectionGroup = 0,
  ) {
    const ordering = [
      ...(location?.nearest
        ? [asc(location.distance)]
        : popular
          ? [desc(typeof popular === "boolean" ? likeCount : popular)]
          : upcoming
            ? [asc(eventSettings.startsAt)]
            : []),
      desc(posts.createdAt),
      desc(posts.id),
    ];
    return db
      .select({
        selectionGroup: sql<number>`${selectionGroup}::integer`,
        selectionOrder:
          sql<number>`row_number() over (order by ${sql.join(ordering, sql`, `)})`.mapWith(Number),
        ...postMetadataColumns(actor),
        post: posts,
        acceptedAnswerId: visibleAnswerId(actor),
        profile: profiles,
        timestamp: preciseTimestamp(posts.createdAt),
        revision: preciseTimestamp(posts.updatedAt),
        likes: likeCount,
        popularityScore: popular && typeof popular !== "boolean" ? popular : likeCount,
        views: viewCount,
        comments: commentCount,
        meetupType: eventSettings.meetupType,
        activityCategory: eventSettings.activityCategory,
        venueLatitude: eventSettings.venueLatitude,
        venueLongitude: eventSettings.venueLongitude,
        communityVenueId: visibleEventVenueId(actor, posts.id),
        communityVenueVersion: visibleEventVenueVersion(actor, posts.id),
        eventStartsAt: eventSettings.startsAt,
        eventCancelledAt: eventLifecycle.cancelledAt,
        eventAmountKRW: eventSettings.amountKRW,
        eventAvailable,
        distanceKm: location?.distance ?? sql<number | null>`null::double precision`,
        liked: actor
          ? sql<boolean>`exists(select 1 from sliper.post_likes l where l.post_id = ${posts.id} and l.user_id = ${actor})`
          : sql<boolean>`false`,
        bookmarked: actor
          ? sql<boolean>`exists(select 1 from sliper.bookmarks b where b.post_id = ${posts.id} and b.user_id = ${actor})`
          : sql<boolean>`false`,
      })
      .from(posts)
      .leftJoin(profiles, eq(profiles.id, posts.authorId))
      .leftJoin(eventSettings, eq(eventSettings.postId, posts.id))
      .leftJoin(eventLifecycle, eq(eventLifecycle.postId, posts.id))
      .where(
        and(
          eq(posts.status, "published"),
          contentVisible("post", posts.id),
          authorVisible(posts.authorId, actor),
          where,
        ),
      )
      .orderBy(...ordering)
      .limit(limit)
      .offset(offset);
  }
  type PostRow = Awaited<ReturnType<typeof readRows>>[number];

  function presentRows(
    rows: PostRow[],
    actor: string | null,
    popular: boolean | SQL<number>,
    detail: boolean,
  ): CommunityPost[] {
    return rows.map(
      ({
        post,
        images,
        attachedVideos,
        voteCounts,
        selectedVote,
        verifiedParticipation,
        acceptedAnswerId,
        profile,
        timestamp,
        revision,
        likes,
        popularityScore,
        views,
        comments: count,
        liked,
        bookmarked,
        meetupType,
        activityCategory,
        venueLatitude,
        venueLongitude,
        communityVenueId,
        communityVenueVersion,
        eventStartsAt,
        eventCancelledAt,
        eventAmountKRW,
        eventAvailable: available,
        distanceKm,
      }) => {
        const counts = new Map(voteCounts.map((vote) => [vote.index, vote.count]));
        const dto = presentPostDetail(
          post,
          {
            profile,
            viewerId: actor,
            stats: { likeCount: likes, viewCount: views, commentCount: count, bookmarkCount: 0 },
            isLiked: liked,
            isBookmarked: bookmarked,
          },
          images,
          attachedVideos,
        );
        const result: CommunityPost = {
          id: dto.id,
          discussionType: post.kind === "이야기" ? (post.discussionType ?? "free") : null,
          acceptedAnswerId,
          spoiler: post.spoiler,
          spoilerTitle: post.spoilerTitle,
          spoilerSummary: post.spoilerSummary,
          ...(verifiedParticipation ? { verifiedParticipation } : {}),
          category: dto.categorySlug,
          kind: post.kind,
          title: dto.title,
          body: dto.bodyMarkdown,
          bodyDocument: dto.bodyDocument ?? null,
          excerpt: dto.bodyMarkdown
            .replace(/[#*_>`\[\]]/g, "")
            .replace(/\s+/g, " ")
            .slice(0, 100),
          author: dto.author.displayName,
          anonymous: dto.author.kind === "anonymous",
          time: timeLabel(post.createdAt),
          createdAt: timestamp,
          updatedAt: revision,
          likes,
          ...(popular ? { popularityScore } : {}),
          views,
          comments: count,
          images,
          videos: dto.videos ?? [],
          ...(images[0] ? { image: images[0].src } : {}),
          ...(post.location ? { location: post.location } : {}),
          ...(post.eventDate ? { eventDate: post.eventDate } : {}),
          meetupType: post.kind === "모집" && meetupType === "lightning" ? "lightning" : "event",
          activityCategory:
            post.kind === "모집" && meetupType === "lightning"
              ? (activityCategory ?? "other")
              : null,
          venueLatitude: post.kind === "모집" ? venueLatitude : null,
          venueLongitude: post.kind === "모집" ? venueLongitude : null,
          communityVenueId: post.kind === "모집" ? communityVenueId : null,
          communityVenueVersion: post.kind === "모집" ? communityVenueVersion : null,
          eventStartsAt: post.kind === "모집" ? (eventStartsAt?.toISOString() ?? null) : null,
          eventCancelledAt: post.kind === "모집" ? (eventCancelledAt?.toISOString() ?? null) : null,
          eventAmountKRW: post.kind === "모집" ? eventAmountKRW : null,
          eventAvailable: post.kind === "모집" && available,
          distanceKm: post.kind === "모집" && distanceKm !== null ? Number(distanceKm) : null,
          applicationUrl:
            post.kind === "모집"
              ? (applicationUrlSchema.safeParse(post.applicationUrl).data ?? null)
              : null,
          featured: post.featured,
          sample: post.sample,
          eventFee: post.eventFee,
          contactInfo: post.contactInfo,
          topic: post.topic,
          tags: post.tags,
          poll: post.poll
            ? {
                question: post.poll.question,
                options: post.poll.options.map((label, index) => ({
                  label,
                  votes: counts?.get(index) ?? 0,
                })),
                total: [...(counts?.values() ?? [])].reduce((total, count) => total + count, 0),
                selected: selectedVote ?? null,
              }
            : null,
          isMine: dto.isMine,
          isLiked: liked,
          isBookmarked: bookmarked,
        };
        return detail ? result : previewPost(result);
      },
    );
  }

  async function projectGroups(actor: string | null, groups: PostSelection[]) {
    const queries = groups.map((group, index) =>
      readRows(
        group.where,
        actor,
        group.limit,
        group.popular ?? false,
        group.location,
        group.offset ?? 0,
        group.upcoming ?? false,
        index,
      ),
    );
    if (!queries.length) return [];
    // Each UNION branch retains its own filter, order and limit. No shared user-data cache.
    const rows =
      queries.length === 1
        ? await queries[0]!
        : await unionAll(queries[0]!, queries[1]!, ...queries.slice(2));
    return groups.map((group, index) =>
      presentRows(
        rows
          .filter((row) => row.selectionGroup === index)
          .sort((a, b) => a.selectionOrder - b.selectionOrder),
        actor,
        group.popular ?? false,
        group.detail ?? false,
      ),
    );
  }

  async function projectPosts(
    where: SQL | undefined,
    actor: string | null,
    limit: number,
    popular: boolean | SQL<number> = false,
    location?: { distance: SQL<number | null>; nearest: boolean },
    offset = 0,
    upcoming = false,
    detail = false,
  ): Promise<CommunityPost[]> {
    const [result] = await projectGroups(actor, [
      { where, limit, popular, location, offset, upcoming, detail },
    ]);
    return result!;
  }

  function highlightSelections(): PostSelection[] {
    const score = periodLikeCount("today", new Date());
    return [
      { where: eq(posts.featured, true), limit: 12 },
      {
        where: and(
          sql`${posts.kind} in ('이야기','후기','투표')`,
          eq(posts.sample, false),
          sql`${score}>0`,
        ),
        limit: 6,
        popular: score,
      },
      {
        where: and(
          eq(posts.kind, "모집"),
          eq(posts.sample, false),
          eventAvailable,
          sql`${eventSettings.startsAt} is not null`,
        ),
        limit: 8,
        upcoming: true,
      },
    ];
  }

  async function highlights(actor: string | null) {
    const [featured, hot, upcoming] = await projectGroups(actor, highlightSelections());
    return { featured: featured!, hot: hot!, upcoming: upcoming! };
  }

  async function projectFeed(actor: string | null, selection: PostSelection) {
    const [items, featured, hot, upcoming] = await projectGroups(actor, [
      selection,
      ...highlightSelections(),
    ]);
    return { posts: items!, featured: featured!, hot: hot!, upcoming: upcoming! };
  }
  async function getPost(id: string, actor: string | null): Promise<CommunityPost> {
    const result = await projectPosts(
      eq(posts.id, uuidSchema.parse(id)),
      actor,
      1,
      false,
      undefined,
      0,
      false,
      true,
    );
    if (!result[0]) throw new AppError("NOT_FOUND", "게시글이 없거나 삭제되었어요.");
    return result[0];
  }

  return { projectPosts, getPost, highlights, projectFeed };
}
export type PostProjector = ReturnType<typeof createPostReader>["projectPosts"];
