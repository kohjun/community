import { DISCUSSION_TYPES } from "../domain/discussions";
import { visibleAnswerId, previewTitleSql, previewBodySql } from "./discussion-policy";
import { questionResolutions } from "../db/schema";
import { periodLikeCount } from "./popularity";
import { videoAssets } from "../db/video-schema";
import { postDocumentVideoIds } from "../domain/post-document";
import { verifiedEventReviews } from "../db/event-operations-schema";
import { and, asc, eq, exists, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/connection";
import {
  bookmarks,
  comments,
  mediaAssets,
  notifications,
  postDailyViews,
  postLikes,
  posts,
  profiles,
  pollVotes,
  eventApplications,
  eventSettings,
} from "../db/schema";
import {
  categorySlugSchema,
  createCommentSchema,
  createPostSchema,
  updateCommentSchema,
  updatePostSchema,
  uuidSchema,
  voteInputSchema,
} from "../domain/validation";
import type {
  CommunityComment,
  CommunityDetail,
  CommunityFeed,
  FeedQuery,
  CommentPageQuery,
  CommentMutation,
} from "../domain/community";
import type { CursorPage } from "../domain/contracts";
import { lightningCategorySchema } from "../domain/lightning-categories";
import { presentComment } from "../domain/presenters";
import { AppError, requireActor } from "./errors";
import { createPostReader, eventAvailable, likeCount } from "./post-reader";
import { EARTH_RADIUS_KM } from "../domain/location";
import { decodeNearbyCursor, encodeNearbyCursor } from "./nearby-pagination";
import { profileService } from "./profile-service";
import { notificationService } from "./notification-service";
import { timeLabel } from "./presentation";
import { awardActivity } from "./activity";
import { bindEventVenue } from "./event-venue-service";
import { enqueueCommentPush } from "./push-events";
import { contentVisible, authorVisible } from "./safety-visibility";
import { enforceRequestLimit } from "./request-limits";
import {
  afterPosition,
  cursorSchema,
  decodeCursor,
  encodeCursor,
  pageQuerySchema,
  pageScope,
  preciseTimestamp,
} from "./pagination";

const numericQuery = (min: number, max: number, integer = false) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)
        ? Number(value)
        : value,
    (integer ? z.number().int() : z.number()).finite().min(min).max(max).optional(),
  );
const booleanQuery = z.preprocess(
  (value) => (value === "true" ? true : value === "false" ? false : value),
  z.boolean().optional(),
);
export const feedQuerySchema = z
  .strictObject({
    category: categorySlugSchema.optional(),
    kind: z.enum(["모집", "후기", "이야기", "투표"]).optional(),
    discussionType: z.enum(DISCUSSION_TYPES).optional(),
    focus: z.enum(["all", "unanswered", "interests"]).default("all"),
    topic: z.string().trim().max(64).optional(),
    tag: z.string().trim().max(24).optional(),
    search: z.string().trim().max(100).optional(),
    view: z.enum(["home", "popular", "bookmarks", "mine"]).default("home"),
    sort: z.enum(["latest", "popular", "nearest"]).default("latest"),
    period: z.enum(["today", "week", "all"]).default("all"),
    rankingAt: z.iso.datetime().optional(),
    latitude: numericQuery(-90, 90),
    longitude: numericQuery(-180, 180),
    radiusKm: numericQuery(0.1, 100),
    eventOnly: booleanQuery,
    meetupType: z.enum(["event", "lightning"]).optional(),
    activityCategory: lightningCategorySchema.optional(),
    fromDate: z.iso.date().optional(),
    toDate: z.iso.date().optional(),
    minPriceKRW: numericQuery(0, 10000000, true),
    maxPriceKRW: numericQuery(0, 10000000, true),
    availableOnly: booleanQuery,
    cursor: cursorSchema.optional(),
    page: numericQuery(1, 1000000, true),
    limit: z.coerce.number().int().min(1).max(48).default(24),
  })
  .superRefine((query, context) => {
    if (query.activityCategory !== undefined && query.meetupType !== "lightning")
      context.addIssue({
        code: "custom",
        path: ["activityCategory"],
        message: "활동 카테고리는 번개 목록에서만 선택할 수 있어요.",
      });
    if (query.page !== undefined && query.cursor !== undefined)
      context.addIssue({
        code: "custom",
        path: ["cursor"],
        message: "페이지 번호와 목록 위치는 함께 사용할 수 없어요.",
      });
    if ((query.latitude === undefined) !== (query.longitude === undefined))
      context.addIssue({
        code: "custom",
        path: ["latitude"],
        message: "현재 위치의 위도와 경도를 함께 입력해주세요.",
      });
    if ((query.sort === "nearest" || query.radiusKm !== undefined) && query.latitude === undefined)
      context.addIssue({
        code: "custom",
        path: ["latitude"],
        message: "거리순과 반경 검색에는 현재 위치가 필요해요.",
      });
    if (query.fromDate && query.toDate && query.fromDate > query.toDate)
      context.addIssue({
        code: "custom",
        path: ["toDate"],
        message: "종료 날짜는 시작 날짜 이후여야 해요.",
      });
    if (
      query.minPriceKRW !== undefined &&
      query.maxPriceKRW !== undefined &&
      query.minPriceKRW > query.maxPriceKRW
    )
      context.addIssue({
        code: "custom",
        path: ["maxPriceKRW"],
        message: "최대 참가비는 최소 참가비 이상이어야 해요.",
      });
  });
// Shared by RSC, Route Handlers and future Server Actions. Never trusts client authors.
export function communityService(db: Database, clock: () => Date = () => new Date()) {
  const { projectPosts, getPost, highlights } = createPostReader(db);
  const { me, updateProfile, visit, completeOnboarding } = profileService(db, projectPosts);
  const { inbox, markRead } = notificationService(db);
  async function feed(actor: string | null, input: FeedQuery = {}): Promise<CommunityFeed> {
    const q = feedQuerySchema.parse(input);
    const now = clock();
    const rankingAt = q.rankingAt ? new Date(q.rankingAt) : now;
    if (rankingAt > now || (q.cursor && q.sort === "popular" && q.period !== "all" && !q.rankingAt))
      throw new AppError(
        "VALIDATION",
        "인기 목록의 기준 시각을 확인하고 처음부터 다시 불러와주세요.",
      );
    const score = q.period === "all" ? likeCount : periodLikeCount(q.period, rankingAt);
    const conditions: SQL[] = [
      contentVisible("post", posts.id),
      authorVisible(posts.authorId, actor),
    ];
    if (q.sort === "popular" && q.period !== "all") conditions.push(sql`${score}>0`);
    if (q.category) conditions.push(eq(posts.categorySlug, q.category));
    if (q.kind)
      conditions.push(
        q.kind === "이야기" ? inArray(posts.kind, ["이야기", "후기"]) : eq(posts.kind, q.kind),
      );
    if (q.discussionType)
      conditions.push(
        eq(posts.kind, "이야기"),
        sql`coalesce(${posts.discussionType}, 'free')=${q.discussionType}`,
      );
    if (q.focus === "unanswered")
      conditions.push(
        eq(posts.kind, "이야기"),
        eq(posts.discussionType, "question"),
        sql`${visibleAnswerId(actor)} is null`,
      );
    let interestFeed: CommunityFeed["interestFeed"];
    if (q.focus === "interests") {
      const [subscriptions] = actor
        ? await db
            .select({
              exists: sql<boolean>`exists(select 1 from sliper.category_subscriptions where user_id=${actor}) or exists(select 1 from sliper.host_subscriptions where user_id=${actor})`,
            })
            .from(sql`(select 1) one`)
        : [];
      interestFeed = !actor ? "login" : subscriptions?.exists ? "personalized" : "setup";
      if (interestFeed === "personalized")
        conditions.push(sql`(
        exists(select 1 from sliper.category_subscriptions cs where cs.user_id=${actor} and cs.category_slug=${posts.categorySlug}::text)
        or (not ${posts.isAnonymous} and exists(select 1 from sliper.host_subscriptions hs where hs.user_id=${actor} and hs.host_id=${posts.authorId})))`);
    }
    if (q.topic) conditions.push(eq(posts.topic, q.topic));
    if (q.tag) conditions.push(sql`not ${posts.spoiler} and ${q.tag} = any(${posts.tags})`);
    if (q.search) {
      const escaped = q.search.replace(/[\\%_]/g, "\\$&");
      conditions.push(
        or(
          ilike(previewTitleSql, `%${escaped}%`),
          ilike(previewBodySql, `%${escaped}%`),
          ...(q.meetupType === "lightning"
            ? [ilike(sql`array_to_string(${posts.tags}, ' ')`, `%${escaped}%`)]
            : []),
        )!,
      );
    }
    if (q.view === "mine") conditions.push(eq(posts.authorId, requireActor(actor)));
    if (q.view === "bookmarks")
      conditions.push(
        exists(
          db
            .select({ id: bookmarks.postId })
            .from(bookmarks)
            .where(and(eq(bookmarks.postId, posts.id), eq(bookmarks.userId, requireActor(actor)))),
        ),
      );
    const eventSearch =
      q.eventOnly === true ||
      q.meetupType !== undefined ||
      q.activityCategory !== undefined ||
      q.latitude !== undefined ||
      q.fromDate !== undefined ||
      q.toDate !== undefined ||
      q.minPriceKRW !== undefined ||
      q.maxPriceKRW !== undefined ||
      q.availableOnly === true;
    let distance: SQL<number | null> | undefined;
    if (eventSearch) conditions.push(eq(posts.kind, "모집"));
    if (q.meetupType)
      conditions.push(
        q.meetupType === "lightning"
          ? eq(eventSettings.meetupType, "lightning")
          : sql`coalesce(${eventSettings.meetupType}, 'event')=${q.meetupType}`,
      );
    if (q.activityCategory)
      conditions.push(
        q.activityCategory === "other"
          ? or(eq(eventSettings.activityCategory, "other"), isNull(eventSettings.activityCategory))!
          : eq(eventSettings.activityCategory, q.activityCategory),
      );
    if (q.latitude !== undefined && q.longitude !== undefined) {
      distance = sql<
        number | null
      >`(2*${EARTH_RADIUS_KM}::double precision*asin(sqrt(least(1::double precision,
        greatest(0::double precision,
          power(sin(radians(${eventSettings.venueLatitude}-${q.latitude}::double precision)/2),2)
          +cos(radians(${q.latitude}::double precision))*cos(radians(${eventSettings.venueLatitude}))
          *power(sin(radians(${eventSettings.venueLongitude}-${q.longitude}::double precision)/2),2)
        )))))`;
      conditions.push(
        sql`${eventSettings.venueLatitude} is not null and ${eventSettings.venueLongitude} is not null`,
      );
      if (q.radiusKm !== undefined)
        conditions.push(sql`${distance}<=${q.radiusKm}::double precision`);
    }
    if (q.fromDate)
      conditions.push(
        sql`(${eventSettings.startsAt} at time zone 'Asia/Seoul')::date>=${q.fromDate}::date`,
      );
    if (q.toDate)
      conditions.push(
        sql`(${eventSettings.startsAt} at time zone 'Asia/Seoul')::date<=${q.toDate}::date`,
      );
    if (q.minPriceKRW !== undefined)
      conditions.push(sql`${eventSettings.amountKRW}>=${q.minPriceKRW}`);
    if (q.maxPriceKRW !== undefined)
      conditions.push(sql`${eventSettings.amountKRW}<=${q.maxPriceKRW}`);
    if (q.availableOnly === true) conditions.push(eventAvailable);
    if (
      q.view === "home" &&
      !q.category &&
      !q.kind &&
      !q.search &&
      !q.discussionType &&
      q.focus === "all" &&
      !q.topic &&
      !q.tag &&
      !eventSearch
    )
      conditions.push(eq(posts.featured, false));
    if (q.page !== undefined) {
      const [count] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(posts)
        .leftJoin(eventSettings, eq(eventSettings.postId, posts.id))
        .where(and(eq(posts.status, "published"), ...conditions));
      const totalItems = count?.total ?? 0;
      const totalPages = Math.max(1, Math.ceil(totalItems / q.limit));
      const page = Math.min(q.page, totalPages);
      const [items, discovery] = await Promise.all([
        projectPosts(
          and(...conditions),
          actor,
          q.limit,
          q.sort === "popular" ? score : false,
          distance ? { distance, nearest: q.sort === "nearest" } : undefined,
          (page - 1) * q.limit,
        ),
        highlights(actor),
      ]);
      return {
        interestFeed,
        posts: items,
        ...discovery,
        rankingAt: rankingAt.toISOString(),
        nextCursor: null,
        pagination: { page, pageSize: q.limit, totalItems, totalPages },
      };
    }
    const scope = pageScope([
      "feed",
      actor,
      q.category,
      q.kind,
      q.search,
      q.topic,
      q.discussionType,
      q.focus,
      q.tag,
      q.view,
      q.sort,
      q.period,
      q.sort !== "popular" || q.period === "all" ? null : rankingAt.toISOString(),
      q.latitude,
      q.longitude,
      q.radiusKm,
      q.eventOnly,
      q.meetupType,
      q.activityCategory,
      q.fromDate,
      q.toDate,
      q.minPriceKRW,
      q.maxPriceKRW,
      q.availableOnly,
    ]);
    if (q.sort === "nearest") {
      const cursor = decodeNearbyCursor(q.cursor, scope);
      if (cursor) {
        const position = sql`(${posts.createdAt}, ${posts.id})<(${cursor.at}::timestamptz, ${cursor.id}::uuid)`;
        conditions.push(
          or(
            sql`${distance!}>${cursor.distanceKm}::double precision`,
            and(sql`${distance!}=${cursor.distanceKm}::double precision`, position),
          )!,
        );
      }
    } else {
      const cursor = decodeCursor(q.cursor, scope);
      if (cursor) {
        const position = afterPosition(posts.createdAt, posts.id, cursor, "desc");
        if (q.sort === "popular") {
          if (cursor.score === undefined)
            throw new AppError("VALIDATION", "인기순 목록을 다시 불러와주세요.");
          conditions.push(
            or(sql`${score} < ${cursor.score}`, and(sql`${score} = ${cursor.score}`, position))!,
          );
        } else conditions.push(position);
      }
    }
    const [items, discovery] = await Promise.all([
      projectPosts(
        and(...conditions),
        actor,
        q.limit + 1,
        q.sort === "popular" ? score : false,
        distance ? { distance, nearest: q.sort === "nearest" } : undefined,
      ),
      highlights(actor),
    ]);
    const page = items.slice(0, q.limit),
      tail = page.at(-1);
    return {
      interestFeed,
      posts: page,
      ...discovery,
      rankingAt: rankingAt.toISOString(),
      nextCursor:
        items.length > q.limit && tail
          ? q.sort === "nearest"
            ? encodeNearbyCursor(scope, tail)
            : encodeCursor(scope, tail, q.sort === "popular" ? tail.popularityScore : undefined)
          : null,
    };
  }

  async function projectComments(
    where: SQL,
    actor: string | null,
    limit: number,
  ): Promise<CommunityComment[]> {
    const rows = await db
      .select({
        comment: comments,
        profile: profiles,
        timestamp: preciseTimestamp(comments.createdAt),
        visible: sql<boolean>`${contentVisible("comment", comments.id)} and ${authorVisible(comments.authorId, actor)}`,
        replyCount: sql<number>`(select count(*)::int from sliper.comments child where child.parent_id = ${comments.id} and child.post_id = ${comments.postId})`,
      })
      .from(comments)
      .leftJoin(profiles, eq(profiles.id, comments.authorId))
      .where(where)
      .orderBy(asc(comments.createdAt), asc(comments.id))
      .limit(limit);
    return rows.map(({ comment, profile, timestamp, replyCount, visible }) => {
      const dto = presentComment(
        visible
          ? comment
          : {
              ...comment,
              status: "deleted",
              authorId: null,
              bodyMarkdown: "",
              deletedAt: new Date(),
            },
        visible ? profile : null,
        actor,
      );
      return {
        id: dto.id,
        postId: dto.postId,
        parentId: dto.parentId,
        author: visible ? (dto.author?.displayName ?? "삭제된 댓글") : "숨겨진 댓글",
        anonymous: dto.author?.kind === "anonymous",
        body: visible
          ? (dto.bodyMarkdown ?? "삭제된 댓글입니다.")
          : "차단 또는 운영 조치로 숨겨진 댓글입니다.",
        time: timeLabel(comment.createdAt),
        createdAt: timestamp,
        replyCount,
        isMine: dto.isMine,
        isDeleted: dto.isDeleted,
      };
    });
  }

  const commentQuerySchema = pageQuerySchema.extend({
    parentId: uuidSchema.nullable().default(null),
  });
  async function commentPage(
    postId: string,
    actor: string | null,
    input: CommentPageQuery = {},
  ): Promise<CursorPage<CommunityComment>> {
    const id = uuidSchema.parse(postId),
      q = commentQuerySchema.parse(input);
    if (
      !(
        await db
          .select({ id: posts.id })
          .from(posts)
          .where(
            and(
              eq(posts.id, id),
              eq(posts.status, "published"),
              contentVisible("post", posts.id),
              authorVisible(posts.authorId, actor),
            ),
          )
          .limit(1)
      )[0]
    )
      throw new AppError("NOT_FOUND", "게시글이 없거나 삭제되었어요.");
    if (
      q.parentId &&
      !(
        await db
          .select({ id: comments.id })
          .from(comments)
          .where(and(eq(comments.id, q.parentId), eq(comments.postId, id)))
          .limit(1)
      )[0]
    )
      throw new AppError("NOT_FOUND", "댓글을 찾을 수 없어요.");
    const scope = pageScope(["comments", id, q.parentId]);
    const cursor = decodeCursor(q.cursor, scope);
    const rows = await projectComments(
      and(
        eq(comments.postId, id),
        q.parentId ? eq(comments.parentId, q.parentId) : isNull(comments.parentId),
        cursor ? afterPosition(comments.createdAt, comments.id, cursor, "asc") : undefined,
      )!,
      actor,
      q.limit + 1,
    );
    const items = rows.slice(0, q.limit),
      tail = items.at(-1);
    return { items, nextCursor: rows.length > q.limit && tail ? encodeCursor(scope, tail) : null };
  }
  async function detail(id: string, actor: string | null): Promise<CommunityDetail> {
    const post = await getPost(id, actor),
      page = await commentPage(id, actor);
    const acceptedAnswer = post.acceptedAnswerId
      ? ((await projectComments(eq(comments.id, post.acceptedAnswerId), actor, 1))[0] ?? null)
      : null;
    return { post, acceptedAnswer, comments: page.items, nextCommentCursor: page.nextCursor };
  }
  async function commentResult(
    id: string,
    postId: string,
    actor: string,
  ): Promise<CommentMutation> {
    const [comment] = await projectComments(
      and(eq(comments.postId, postId), eq(comments.id, id))!,
      actor,
      1,
    );
    if (!comment) throw new AppError("NOT_FOUND", "댓글을 찾을 수 없어요.");
    const parent = comment.parentId
      ? ((
          await projectComments(
            and(eq(comments.postId, postId), eq(comments.id, comment.parentId))!,
            actor,
            1,
          )
        )[0] ?? null)
      : null;
    return { post: await getPost(postId, actor), comment, parent };
  }

  type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
  async function lockPost(
    tx: Transaction,
    id: string,
    actor?: string,
    viewer: string | null = actor ?? null,
  ) {
    const [row] = await tx
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.id, id),
          contentVisible("post", posts.id),
          authorVisible(posts.authorId, viewer),
        ),
      )
      .for("update");
    if (!row || row.status !== "published")
      throw new AppError("NOT_FOUND", "게시글이 없거나 삭제되었어요.");
    if (actor && row.authorId !== actor)
      throw new AppError("FORBIDDEN", "본인이 작성한 글만 변경할 수 있어요.");
    return row;
  }

  async function guardActiveRecruitment(tx: Transaction, id: string) {
    const [active] = await tx
      .select({ id: eventApplications.id })
      .from(eventApplications)
      .where(
        and(
          eq(eventApplications.postId, id),
          sql`(status in ('confirmed','review','pending_approval') or (status='pending_payment' and expires_at>statement_timestamp()))`,
        ),
      )
      .limit(1);
    if (active)
      throw new AppError(
        "CONFLICT",
        "신청자가 있는 모집글은 삭제하거나 다른 종류의 글로 바꿀 수 없어요. 신청 마감과 외부 플랫폼의 환불을 먼저 처리해주세요.",
      );
  }

  async function attachImages(tx: Transaction, postId: string, actor: string, ids: string[]) {
    const assets = ids.length
      ? await tx.select().from(mediaAssets).where(inArray(mediaAssets.id, ids)).for("update")
      : [];
    if (
      assets.length !== ids.length ||
      assets.some(
        (a) =>
          a.uploaderId !== actor ||
          a.status !== "ready" ||
          a.recordOriginPostId !== null ||
          a.recordPostId !== null ||
          (a.postId && a.postId !== postId),
      )
    ) {
      throw new AppError("FORBIDDEN", "본인이 업로드한 사용 가능한 이미지만 첨부할 수 있어요.");
    }
    await tx.update(mediaAssets).set({ postId: null }).where(eq(mediaAssets.postId, postId));
    for (const [sortOrder, id] of ids.entries())
      await tx.update(mediaAssets).set({ postId, sortOrder }).where(eq(mediaAssets.id, id));
  }

  async function attachVideos(tx: Transaction, postId: string, actor: string, ids: string[]) {
    const assets = ids.length
      ? await tx
          .select()
          .from(videoAssets)
          .where(inArray(videoAssets.id, ids))
          .orderBy(asc(videoAssets.id))
          .for("update")
      : [];
    if (
      assets.length !== ids.length ||
      assets.some(
        (asset) =>
          asset.uploaderId !== actor ||
          asset.status !== "ready" ||
          asset.recordOriginPostId !== null ||
          asset.recordPostId !== null ||
          (asset.postId && asset.postId !== postId),
      )
    )
      throw new AppError("FORBIDDEN", "본인이 업로드한 사용 가능한 영상만 첨부할 수 있어요.");
    // Detach before assigning order so reordering cannot collide with the unique index.
    await tx.update(videoAssets).set({ postId: null }).where(eq(videoAssets.postId, postId));
    for (const [sortOrder, id] of ids.entries())
      await tx.update(videoAssets).set({ postId, sortOrder }).where(eq(videoAssets.id, id));
  }

  async function createPost(actor: string | null, input: unknown) {
    const userId = requireActor(actor),
      value = createPostSchema.parse(input);
    await enforceRequestLimit(db, userId, "post", 20);
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(posts)
        .values({
          authorId: userId,
          categorySlug: value.categorySlug,
          kind: value.kind,
          applicationUrl: value.applicationUrl,
          location: value.location,
          eventDate: value.eventDate,
          eventFee: value.eventFee,
          contactInfo: value.contactInfo,
          discussionType: value.kind === "이야기" ? (value.discussionType ?? null) : null,
          spoiler: value.spoiler ?? false,
          spoilerTitle: value.spoiler ? value.spoilerTitle : null,
          spoilerSummary: value.spoiler ? value.spoilerSummary : null,
          topic: value.topic,
          tags: value.tags,
          poll: value.poll,
          title: value.title,
          bodyMarkdown: value.bodyMarkdown,
          bodyDocument: value.bodyDocument ?? null,
          isAnonymous: value.isAnonymous,
        })
        .returning({ id: posts.id });
      if (value.kind === "모집" && value.venue) {
        await tx.insert(eventSettings).values({
          postId: row!.id,
          amountKRW: 0,
          capacity: 12,
          open: false,
          venueLatitude: value.venue.latitude,
          venueLongitude: value.venue.longitude,
        });
        await bindEventVenue(tx, userId, row!.id, value.venue);
      }
      await attachImages(tx, row!.id, userId, value.imageAssetIds);
      await attachVideos(
        tx,
        row!.id,
        userId,
        value.bodyDocument ? postDocumentVideoIds(value.bodyDocument) : [],
      );
      await awardActivity(tx, userId, "post", row!.id);
      return row!.id;
    });
    return getPost(id, actor);
  }

  async function updatePost(actor: string | null, input: unknown) {
    const userId = requireActor(actor),
      value = updatePostSchema.parse(input);
    await db.transaction(async (tx) => {
      const previous = await lockPost(tx, value.postId, userId);
      const discussionType =
        value.kind !== "이야기"
          ? null
          : value.discussionType === undefined
            ? previous.discussionType
            : value.discussionType;
      const spoiler = value.spoiler ?? previous.spoiler;
      const spoilerTitle =
        value.spoilerTitle === undefined ? previous.spoilerTitle : value.spoilerTitle;
      const spoilerSummary =
        value.spoilerSummary === undefined ? previous.spoilerSummary : value.spoilerSummary;
      if (spoiler && (value.kind === "모집" || !spoilerTitle?.trim()))
        throw new AppError("VALIDATION", "스포일러 없는 미리보기 제목을 입력해주세요.");
      if (previous.bodyDocument && value.bodyDocument === undefined)
        throw new AppError("VALIDATION", "이미지·영상이 포함된 글은 새 편집기로 수정해주세요.");
      const [verified] = await tx
        .select({ id: verifiedEventReviews.reviewPostId })
        .from(verifiedEventReviews)
        .where(eq(verifiedEventReviews.reviewPostId, value.postId));
      if (
        verified &&
        (value.kind !== "후기" || value.categorySlug !== previous.categorySlug || value.isAnonymous)
      )
        throw new AppError(
          "VALIDATION",
          "인증 후기는 기존 행사 카테고리와 닉네임 공개를 유지해주세요.",
        );
      const [configuration] = await tx
        .select({ type: eventSettings.meetupType, amountKRW: eventSettings.amountKRW })
        .from(eventSettings)
        .where(eq(eventSettings.postId, value.postId));
      if (
        configuration?.type === "lightning" &&
        (value.kind !== "모집" ||
          (!value.applicationUrl && (configuration.amountKRW !== 0 || value.eventFee !== "무료")))
      )
        throw new AppError(
          "VALIDATION",
          "번개는 모집글로 유지해주세요. 유료 번개에는 외부 신청 링크가 필요하며, 직접 참가로 바꾸려면 행사 관리에서 참가비를 0원으로 설정해주세요.",
        );
      if (value.kind !== "모집" || !!previous.applicationUrl !== !!value.applicationUrl)
        await guardActiveRecruitment(tx, value.postId);
      // Compare inside the existing row lock, using PostgreSQL microsecond precision.
      const [current] = await tx
        .select({ id: posts.id })
        .from(posts)
        .where(
          and(
            eq(posts.id, value.postId),
            sql`${posts.updatedAt} = ${value.expectedUpdatedAt}::timestamptz`,
          ),
        );
      if (!current)
        throw new AppError(
          "CONFLICT",
          "다른 화면에서 이 글을 수정했어요. 최신 글을 확인한 뒤 다시 수정해주세요.",
        );
      const [voted] = await tx
        .select({ id: pollVotes.postId })
        .from(pollVotes)
        .where(eq(pollVotes.postId, value.postId))
        .limit(1);
      if (
        voted &&
        (previous.poll?.question !== value.poll?.question ||
          JSON.stringify(previous.poll?.options) !== JSON.stringify(value.poll?.options))
      )
        throw new AppError("CONFLICT", "참여한 사람이 있는 투표의 주제와 항목은 변경할 수 없어요.");
      await tx
        .update(posts)
        .set({
          categorySlug: value.categorySlug,
          kind: value.kind,
          applicationUrl: value.applicationUrl,
          location: value.location,
          eventDate: value.eventDate,
          eventFee:
            configuration?.type === "lightning"
              ? configuration.amountKRW === 0
                ? "무료"
                : configuration.amountKRW.toLocaleString("ko-KR") + "원"
              : value.eventFee,
          contactInfo: value.contactInfo,
          discussionType,
          spoiler,
          spoilerTitle: spoiler ? spoilerTitle : null,
          spoilerSummary: spoiler ? spoilerSummary : null,
          topic: value.topic,
          tags: value.tags,
          poll: value.poll,
          title: value.title,
          bodyMarkdown: value.bodyMarkdown,
          bodyDocument: value.bodyDocument ?? null,
          isAnonymous: value.isAnonymous,
        })
        .where(eq(posts.id, value.postId));
      if (value.kind !== "이야기" || discussionType !== "question")
        await tx.delete(questionResolutions).where(eq(questionResolutions.postId, value.postId));
      if (value.kind === "모집" && value.venue !== undefined) {
        await tx
          .insert(eventSettings)
          .values({ postId: value.postId, amountKRW: 0, capacity: 12, open: false })
          .onConflictDoNothing();
        const venue = await bindEventVenue(tx, userId, value.postId, value.venue);
        await tx.update(eventSettings).set(venue).where(eq(eventSettings.postId, value.postId));
      }
      await attachImages(tx, value.postId, userId, value.imageAssetIds);
      await attachVideos(
        tx,
        value.postId,
        userId,
        value.bodyDocument ? postDocumentVideoIds(value.bodyDocument) : [],
      );
    });
    return getPost(value.postId, actor);
  }

  async function resolveQuestion(actor: string | null, postId: string, input: unknown) {
    const user = requireActor(actor),
      id = uuidSchema.parse(postId);
    const value = z
      .strictObject({ commentId: uuidSchema.nullable(), expectedUpdatedAt: z.iso.datetime() })
      .parse(input);
    await db.transaction(async (tx) => {
      const post = await lockPost(tx, id, user);
      if (post.kind !== "이야기" || post.discussionType !== "question")
        throw new AppError("VALIDATION", "질문 글에서만 답변을 채택할 수 있어요.");
      const [revision] = await tx
        .select({ id: posts.id })
        .from(posts)
        .where(
          and(eq(posts.id, id), sql`${posts.updatedAt}=${value.expectedUpdatedAt}::timestamptz`),
        );
      if (!revision)
        throw new AppError("CONFLICT", "질문이 변경되었어요. 새로고침 후 다시 선택해주세요.");
      if (value.commentId) {
        const [answer] = await tx
          .select()
          .from(comments)
          .where(
            and(
              eq(comments.id, value.commentId),
              eq(comments.postId, id),
              eq(comments.status, "published"),
              contentVisible("comment", comments.id),
              authorVisible(comments.authorId, user),
              sql`${comments.authorId} is not null and ${comments.authorId}<>${user}`,
              sql`not exists(select 1 from sliper.member_safety ms where ms.user_id=${comments.authorId} and (ms.status='closed' or (ms.status='suspended' and (ms.suspended_until is null or ms.suspended_until>statement_timestamp()))))`,
            ),
          )
          .for("update");
        if (!answer)
          throw new AppError("VALIDATION", "이 질문에 달린 다른 회원의 공개 답변을 선택해주세요.");
        await tx
          .insert(questionResolutions)
          .values({ postId: id, commentId: answer.id, resolvedBy: user })
          .onConflictDoUpdate({
            target: questionResolutions.postId,
            set: { commentId: answer.id, resolvedBy: user, resolvedAt: new Date() },
          });
      } else await tx.delete(questionResolutions).where(eq(questionResolutions.postId, id));
      await tx.update(posts).set({ updatedAt: new Date() }).where(eq(posts.id, id));
    });
    return detail(id, user);
  }

  async function deletePost(actor: string | null, postId: string) {
    const userId = requireActor(actor),
      id = uuidSchema.parse(postId);
    await db.transaction(async (tx) => {
      await lockPost(tx, id, userId);
      await guardActiveRecruitment(tx, id);
      await tx.update(posts).set({ status: "deleted" }).where(eq(posts.id, id));
      await tx.delete(notifications).where(eq(notifications.postId, id));
    });
    return { id };
  }

  async function createComment(actor: string | null, input: unknown) {
    const userId = requireActor(actor),
      value = createCommentSchema.parse(input);
    await enforceRequestLimit(db, userId, "comment", 60);
    const id = await db.transaction(async (tx) => {
      const post = await lockPost(tx, value.postId, undefined, userId);
      const parent = value.parentId
        ? (
            await tx
              .select()
              .from(comments)
              .where(and(eq(comments.id, value.parentId), eq(comments.postId, value.postId)))
              .for("update")
          )[0]
        : null;
      if (value.parentId && (!parent || parent.status !== "published"))
        throw new AppError("NOT_FOUND", "답글을 달 댓글이 없거나 삭제되었어요.");
      const [comment] = await tx
        .insert(comments)
        .values({ ...value, authorId: userId })
        .returning();
      const recipients = new Map<string, "post_comment" | "comment_reply">();
      if (post.authorId && post.authorId !== userId) recipients.set(post.authorId, "post_comment");
      if (parent?.authorId && parent.authorId !== userId)
        recipients.set(parent.authorId, "comment_reply");
      for (const [recipientId, kind] of recipients)
        await tx
          .insert(notifications)
          .values({ recipientId, kind, postId: value.postId, commentId: comment!.id })
          .onConflictDoNothing();
      await enqueueCommentPush(tx, {
        postId: value.postId,
        commentId: comment!.id,
        actorId: userId,
        recipients: Array.from(recipients.keys()),
      });
      await awardActivity(tx, userId, "comment", comment!.id);
      return comment!.id;
    });
    return commentResult(id, value.postId, userId);
  }

  async function changeComment(actor: string | null, input: unknown, deleting = false) {
    const userId = requireActor(actor);
    const value = deleting
      ? { commentId: uuidSchema.parse(input), bodyMarkdown: "" }
      : updateCommentSchema.parse(input);
    const [target] = await db.select().from(comments).where(eq(comments.id, value.commentId));
    if (!target) throw new AppError("NOT_FOUND", "댓글을 찾을 수 없어요.");
    await db.transaction(async (tx) => {
      await lockPost(tx, target.postId, undefined, userId);
      const [row] = await tx
        .select()
        .from(comments)
        .where(eq(comments.id, value.commentId))
        .for("update");
      if (!row || row.status !== "published")
        throw new AppError("NOT_FOUND", "댓글이 삭제되었어요.");
      if (row.authorId !== userId)
        throw new AppError("FORBIDDEN", "본인이 작성한 댓글만 변경할 수 있어요.");
      await tx
        .update(comments)
        .set(deleting ? { status: "deleted" } : { bodyMarkdown: value.bodyMarkdown })
        .where(eq(comments.id, value.commentId));
      if (deleting)
        await tx.delete(notifications).where(eq(notifications.commentId, value.commentId));
    });
    return commentResult(value.commentId, target.postId, userId);
  }

  async function react(
    actor: string | null,
    postId: string,
    kind: "like" | "bookmark",
    active: boolean,
  ) {
    const userId = requireActor(actor),
      id = uuidSchema.parse(postId),
      table = kind === "like" ? postLikes : bookmarks;
    await db.transaction(async (tx) => {
      await lockPost(tx, id, undefined, userId);
      if (active) await tx.insert(table).values({ postId: id, userId }).onConflictDoNothing();
      else await tx.delete(table).where(and(eq(table.postId, id), eq(table.userId, userId)));
    });
    return getPost(id, actor);
  }

  async function recordView(postId: string, visitorHash: string, actor: string | null) {
    const id = uuidSchema.parse(postId);
    await db.transaction(async (tx) => {
      await lockPost(tx, id, undefined, actor);
      await tx.insert(postDailyViews).values({ postId: id, visitorHash }).onConflictDoNothing();
    });
    return getPost(id, actor);
  }

  async function vote(actor: string | null, postId: string, input: unknown) {
    const userId = requireActor(actor),
      id = uuidSchema.parse(postId),
      value = voteInputSchema.parse(input);
    await db.transaction(async (tx) => {
      const post = await lockPost(tx, id, undefined, userId);
      if (!post.poll || post.kind !== "투표" || value.optionIndex >= post.poll.options.length)
        throw new AppError("VALIDATION", "사용할 수 없는 투표 항목이에요.");
      await tx
        .insert(pollVotes)
        .values({ postId: id, userId, optionIndex: value.optionIndex })
        .onConflictDoUpdate({
          target: [pollVotes.postId, pollVotes.userId],
          set: { optionIndex: value.optionIndex },
        });
      await awardActivity(tx, userId, "vote", id);
    });
    return getPost(id, actor);
  }

  return {
    feed,
    detail,
    getPost,
    commentPage,
    resolveQuestion,
    createPost,
    updatePost,
    deletePost,
    createComment,
    changeComment,
    react,
    recordView,
    inbox,
    markRead,
    highlights,
    vote,
    me,
    updateProfile,
    completeOnboarding,
    visit,
  };
}
