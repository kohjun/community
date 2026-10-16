import { previewPost } from "../domain/discussions";
import { visibleAnswerId } from "./discussion-policy";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/connection";
import { verifiedEventReviews } from "../db/event-operations-schema";
import { eventLifecycle } from "../db/event-lifecycle-schema";
import { eventSettings, mediaAssets, pollVotes, posts, profiles } from "../db/schema";
import { applicationUrlSchema, uuidSchema } from "../domain/validation";
import type { CommunityPost } from "../domain/community";
import { videoAssets } from "../db/video-schema";
import type { PublicImage, PublicVideo } from "../domain/contracts";
import { presentPostDetail } from "../domain/presenters";
import { AppError } from "./errors";
import { preciseTimestamp } from "./pagination";
import { timeLabel } from "./presentation";
import { contentVisible, authorVisible } from "./safety-visibility";
import { visibleEventVenueId, visibleEventVenueVersion } from "./event-venue-service";
import { periodLikeCount } from "./popularity";
import { verifiedReviewParticipation } from "./verified-review-policy";
export const likeCount = sql<number>`(select count(*)::int from sliper.post_likes l where l.post_id = ${posts.id})`;
const viewCount = sql<number>`(select count(*)::int from sliper.post_daily_views v where v.post_id = ${posts.id})`;
const commentCount = sql<number>`(select count(*)::int from sliper.comments c where c.post_id = ${posts.id} and c.status = 'published')`;
export const eventAvailable = sql<boolean>`coalesce(
  ${eventSettings.open}
  and not exists(select 1 from sliper.event_lifecycle lifecycle where lifecycle.post_id=${posts.id} and lifecycle.cancelled_at is not null)
  and (${eventSettings.startsAt} is null or ${eventSettings.startsAt}>statement_timestamp())
  and (${eventSettings.endsAt} is null or ${eventSettings.endsAt}>statement_timestamp())
  and ${eventSettings.capacity}>(select count(*) from sliper.event_applications a
    where a.post_id=${posts.id}
      and (a.status='confirmed' or (a.status='pending_payment' and a.expires_at>statement_timestamp()))),
  false)`;
export function createPostReader(db: Database) {
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
    const rows = await db
      .select({
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
      .orderBy(
        ...(location?.nearest
          ? [asc(location.distance)]
          : popular
            ? [desc(typeof popular === "boolean" ? likeCount : popular)]
            : upcoming
              ? [asc(eventSettings.startsAt)]
              : []),
        desc(posts.createdAt),
        desc(posts.id),
      )
      .limit(limit)
      .offset(offset);
    const assets = rows.length
      ? await db
          .select()
          .from(mediaAssets)
          .where(
            and(
              inArray(
                mediaAssets.postId,
                rows.map((r) => r.post.id),
              ),
              eq(mediaAssets.status, "ready"),
            ),
          )
          .orderBy(asc(mediaAssets.sortOrder))
      : [];
    const videos = rows.length
      ? await db
          .select()
          .from(videoAssets)
          .where(
            and(
              inArray(
                videoAssets.postId,
                rows.map((row) => row.post.id),
              ),
              eq(videoAssets.status, "ready"),
            ),
          )
          .orderBy(asc(videoAssets.sortOrder))
      : [];
    const pollIds = rows.filter((r) => r.post.poll).map((r) => r.post.id);
    const [voteCounts, myVotes] = pollIds.length
      ? await Promise.all([
          db
            .select({
              postId: pollVotes.postId,
              index: pollVotes.optionIndex,
              count: sql<number>`count(*)::int`,
            })
            .from(pollVotes)
            .where(inArray(pollVotes.postId, pollIds))
            .groupBy(pollVotes.postId, pollVotes.optionIndex),
          actor
            ? db
                .select()
                .from(pollVotes)
                .where(and(inArray(pollVotes.postId, pollIds), eq(pollVotes.userId, actor)))
            : Promise.resolve([]),
        ])
      : [[], []];
    const verifiedRows = rows.length
      ? await db
          .select({
            reviewPostId: verifiedEventReviews.reviewPostId,
            eventPostId: verifiedEventReviews.eventPostId,
            eventTitle: sql<string>`case when exists(select 1 from sliper.posts e where e.id=${verifiedEventReviews.eventPostId} and e.status='published' and not exists(select 1 from sliper.content_restrictions cr where cr.target_type='post' and cr.target_id=e.id and cr.hidden)) then ${verifiedEventReviews.eventTitle} else '참가한 행사' end`,
            rating: verifiedEventReviews.rating,
            templateEntryId: verifiedEventReviews.templateEntryId,
            hostPublicId: sql<
              string | null
            >`case when exists(select 1 from sliper.posts e where e.id=${verifiedEventReviews.eventPostId} and not e.is_anonymous and e.status='published' and not exists(select 1 from sliper.content_restrictions cr where cr.target_type='post' and cr.target_id=e.id and cr.hidden)) then (select p.public_id::text from sliper.profiles p where p.id=${verifiedEventReviews.hostId}) else null end`,
          })
          .from(verifiedEventReviews)
          .where(
            and(
              inArray(
                verifiedEventReviews.reviewPostId,
                rows.map((r) => r.post.id),
              ),
              verifiedReviewParticipation({
                applicationId: sql`"sliper"."verified_event_reviews"."application_id"`,
                postId: sql`"sliper"."verified_event_reviews"."event_post_id"`,
                userId: sql`"sliper"."verified_event_reviews"."user_id"`,
                hostId: sql`"sliper"."verified_event_reviews"."host_id"`,
              }),
            ),
          )
      : [];
    const verifiedByPost = new Map(
      verifiedRows.map(({ reviewPostId, ...metadata }) => [reviewPostId, metadata]),
    );
    const imagesByPost = new Map<string, PublicImage[]>();
    for (const asset of assets) {
      if (!asset.postId) continue;
      const images = imagesByPost.get(asset.postId) ?? [];
      images.push({
        id: asset.id,
        src: `/api/media/${asset.id}`,
        contentType: asset.contentType as PublicImage["contentType"],
        sortOrder: asset.sortOrder,
      });
      imagesByPost.set(asset.postId, images);
    }
    const videosByPost = new Map<string, PublicVideo[]>();
    for (const asset of videos) {
      if (!asset.postId) continue;
      const attached = videosByPost.get(asset.postId) ?? [];
      attached.push({
        id: asset.id,
        src: `/api/videos/${asset.id}`,
        contentType: "video/mp4",
        byteSize: asset.byteSize,
        width: asset.width,
        height: asset.height,
        durationSeconds: asset.durationSeconds,
        sortOrder: asset.sortOrder,
      });
      videosByPost.set(asset.postId, attached);
    }
    const countsByPost = new Map<string, Map<number, number>>();
    for (const vote of voteCounts) {
      const counts = countsByPost.get(vote.postId) ?? new Map();
      counts.set(vote.index, vote.count);
      countsByPost.set(vote.postId, counts);
    }
    const selectedByPost = new Map(myVotes.map((vote) => [vote.postId, vote.optionIndex]));
    return rows.map(
      ({
        post,
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
        const images = imagesByPost.get(post.id) ?? [];
        const attachedVideos = videosByPost.get(post.id) ?? [];
        const counts = countsByPost.get(post.id);
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
          ...(verifiedByPost.has(post.id)
            ? { verifiedParticipation: verifiedByPost.get(post.id)! }
            : {}),
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
                selected: selectedByPost.get(post.id) ?? null,
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

  async function highlights(actor: string | null) {
    const score = periodLikeCount("today", new Date());
    const [featured, hot, upcoming] = await Promise.all([
      projectPosts(eq(posts.featured, true), actor, 12),
      projectPosts(
        and(
          sql`${posts.kind} in ('이야기','후기','투표')`,
          eq(posts.sample, false),
          sql`${score}>0`,
        ),
        actor,
        6,
        score,
      ),
      projectPosts(
        and(
          eq(posts.kind, "모집"),
          eq(posts.sample, false),
          eventAvailable,
          sql`${eventSettings.startsAt} is not null`,
        ),
        actor,
        8,
        false,
        undefined,
        0,
        true,
      ),
    ]);
    return { featured, hot, upcoming };
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

  return { projectPosts, getPost, highlights };
}
export type PostProjector = ReturnType<typeof createPostReader>["projectPosts"];
