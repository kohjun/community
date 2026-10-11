import { previewTitleSql } from "./discussion-policy";
import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/connection";
import { eventRecords, mediaAssets, posts, profiles } from "../db/schema";
import { eventRecordLinks } from "../db/records-schema";
import { libraryEntries, templateProvenance } from "../db/library-schema";
import { crews, crewEvents } from "../db/crew-schema";
import { videoAssets } from "../db/video-schema";
import { verifiedEventReviews } from "../db/event-operations-schema";
import {
  recordQuerySchema,
  recordSaveSchema,
  recordPublishSchema,
  type RecordSummary,
  type RecordDetail,
  type RecordPage,
  type RecordLink,
  type RecordStatus,
} from "../domain/records";
import { postDocumentToMarkdown, type PostDocument } from "../domain/post-document";
import type { PublicImage, PublicVideo } from "../domain/contracts";
import { AppError } from "./errors";
import { recordVisible, requireRecordMember } from "./record-policy";
import { attachRecordMedia } from "./record-media";
import { acceptedCreditViews, creditMemberVisible } from "./event-credit-service";
import { contentVisible } from "./safety-visibility";
import { registeredVenueSnapshotVisible, visibleRegisteredVenue } from "./place-policy";
import { preciseTimestamp } from "./pagination";
import { enforceRequestLimit } from "./request-limits";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryDb = Database | Tx;
function attendanceCount(postId: SQL, qr: boolean | null = null) {
  return sql<number>`(select count(*)::int from sliper.event_results er
    where er.post_id=${postId} and er.presence='attended'
    ${
      qr === null
        ? sql``
        : qr
          ? sql`and exists(select 1 from sliper.event_admissions ea where ea.application_id=er.application_id and ea.post_id=er.post_id and ea.user_id=er.user_id)`
          : sql`and not exists(select 1 from sliper.event_admissions ea where ea.application_id=er.application_id and ea.post_id=er.post_id and ea.user_id=er.user_id)`
    })`;
}
/** These counts refer to actual attendance, never confirmed applications or crew rows. */
export function recordMetricProjection(actor: string) {
  const id = sql`${eventRecords.postId}`;
  const reviews = sql`from sliper.verified_event_reviews vr
    join sliper.posts vp on vp.id=vr.review_post_id
    where vr.event_post_id=${id} and vp.status='published' and not vp.sample
    and not exists(select 1 from sliper.content_restrictions cr where cr.target_type='post' and cr.target_id=vp.id and cr.hidden)
    and ${creditMemberVisible(actor, sql`vp.author_id`)}
    and exists(select 1 from sliper.event_results result where result.application_id=vr.application_id and result.post_id=vr.event_post_id and result.user_id=vr.user_id and result.presence='attended')`;
  return {
    attended: attendanceCount(id),
    qrAttended: attendanceCount(id, true),
    managerAttended: attendanceCount(id, false),
    reviewCount: sql<number>`(select count(*)::int ${reviews})`,
    averageRating: sql<number | null>`(select round(avg(vr.rating)::numeric,2) ${reviews})`,
  };
}
const recordProjection = {
  record: eventRecords,
  updatedAt: preciseTimestamp(eventRecords.updatedAt),
  hostPublicId: profiles.publicId,
  hostNickname: profiles.nickname,
  canManage: sql<boolean>`false`,
};
type RecordRow = {
  record: Pick<
    typeof eventRecords.$inferSelect,
    "postId" | "snapshot" | "completedAt" | "status" | "ownerId"
  >;
  updatedAt: string;
  hostPublicId: string | null;
  hostNickname: string | null;
  canManage: boolean;
  venueVisible: boolean;
  attended: number;
  qrAttended: number;
  managerAttended: number;
  reviewCount: number;
  averageRating: number | null;
};
export function recordSummary(row: RecordRow, actor: string): RecordSummary {
  return {
    postId: row.record.postId,
    title: row.record.snapshot.title,
    category: row.record.snapshot.category,
    location:
      row.record.snapshot.venue && !row.venueVisible
        ? "장소 정보 비공개"
        : row.record.snapshot.location,
    startsAt: row.record.snapshot.startsAt,
    endsAt: row.record.snapshot.endsAt,
    completedAt: row.record.completedAt.toISOString(),
    status: row.record.status as RecordStatus,
    hostPublicId: row.hostPublicId,
    hostNickname: row.hostNickname ?? "탈퇴한 회원",
    attended: Number(row.attended),
    qrAttended: Number(row.qrAttended),
    managerAttended: Number(row.managerAttended),
    reviewCount: Number(row.reviewCount),
    averageRating: row.averageRating === null ? null : Number(row.averageRating),
    updatedAt: row.updatedAt,
    canEdit: row.record.ownerId === actor,
  };
}
function assertPublishable(record: {
  purpose: string;
  execution: string;
  bodyDocument: PostDocument | null;
}) {
  if (
    record.purpose.trim().length < 10 ||
    record.execution.trim().length < 10 ||
    !record.bodyDocument ||
    !postDocumentToMarkdown(record.bodyDocument).trim()
  )
    throw new AppError(
      "VALIDATION",
      "기획 의도와 진행 내용을 10자 이상 적고 현장 기록을 추가해주세요.",
    );
}
export function recordService(db: Database) {
  async function rows(connection: QueryDb, user: string, id?: string) {
    return connection
      .select({
        ...recordProjection,
        ...recordMetricProjection(user),
        venueVisible: registeredVenueSnapshotVisible(user, sql`${eventRecords.snapshot}`),
        canManage: sql<boolean>`(${eventRecords.ownerId}=${user}::uuid or exists(select 1 from sliper.room_managers rm where rm.post_id=${eventRecords.postId} and rm.user_id=${user}::uuid))`,
      })
      .from(eventRecords)
      .leftJoin(profiles, eq(profiles.id, eventRecords.ownerId))
      .where(and(id ? eq(eventRecords.postId, id) : undefined, recordVisible(user, true)));
  }
  async function list(actor: string | null, input: unknown = {}): Promise<RecordPage> {
    const user = await requireRecordMember(db, actor),
      value = recordQuerySchema.parse(input);
    if (value.libraryId) {
      const [source] = await db
        .select({ id: libraryEntries.id })
        .from(libraryEntries)
        .where(
          and(
            eq(libraryEntries.id, value.libraryId),
            eq(libraryEntries.status, "published"),
            contentVisible("library", libraryEntries.id),
            creditMemberVisible(user, libraryEntries.ownerId),
          ),
        );
      if (!source)
        throw new AppError("NOT_FOUND", "볼 수 있는 자료의 행사 기록만 찾아볼 수 있어요.");
    }
    const search = "%" + value.q.replace(/[\\%_]/g, "\\$&") + "%";
    const found = await db
      .select({
        ...recordProjection,
        ...recordMetricProjection(user),
        venueVisible: registeredVenueSnapshotVisible(user, sql`${eventRecords.snapshot}`),
      })
      .from(eventRecords)
      .leftJoin(profiles, eq(profiles.id, eventRecords.ownerId))
      .where(
        and(
          recordVisible(user, value.mine === "1"),
          value.mine === "1"
            ? eq(eventRecords.ownerId, user)
            : eq(eventRecords.status, "published"),
          value.libraryId
            ? sql`(exists(select 1 from sliper.event_record_links link where link.record_post_id=${eventRecords.postId} and link.library_entry_id=${value.libraryId}::uuid) or exists(select 1 from sliper.template_provenance source where source.post_id=${eventRecords.postId} and source.entry_id=${value.libraryId}::uuid))`
            : undefined,
          value.category ? sql`${eventRecords.snapshot}->>'category'=${value.category}` : undefined,
          value.q ? ilike(sql`${eventRecords.snapshot}->>'title'`, search) : undefined,
        ),
      )
      .orderBy(desc(eventRecords.completedAt), desc(eventRecords.postId))
      .limit(21)
      .offset((value.page - 1) * 20);
    return {
      items: found.slice(0, 20).map((row) => recordSummary(row, user)),
      page: value.page,
      hasMore: found.length > 20,
    };
  }
  async function related(connection: QueryDb, user: string, postId: string) {
    const [postLinks, libraryLinks, crewLinks, source] = await Promise.all([
      connection
        .select({ id: posts.id, title: previewTitleSql })
        .from(eventRecordLinks)
        .innerJoin(posts, eq(posts.id, eventRecordLinks.relatedPostId))
        .where(
          and(
            eq(eventRecordLinks.recordPostId, postId),
            eq(posts.status, "published"),
            contentVisible("post", posts.id),
            creditMemberVisible(user, posts.authorId),
          ),
        )
        .orderBy(asc(eventRecordLinks.id)),
      connection
        .select({ id: libraryEntries.id, title: libraryEntries.title, kind: libraryEntries.kind })
        .from(eventRecordLinks)
        .innerJoin(libraryEntries, eq(libraryEntries.id, eventRecordLinks.libraryEntryId))
        .where(
          and(
            eq(eventRecordLinks.recordPostId, postId),
            eq(libraryEntries.status, "published"),
            contentVisible("library", libraryEntries.id),
            creditMemberVisible(user, libraryEntries.ownerId),
          ),
        )
        .orderBy(asc(eventRecordLinks.id)),
      connection
        .select({ id: crews.id, title: crews.name })
        .from(crewEvents)
        .innerJoin(crews, eq(crews.id, crewEvents.crewId))
        .where(
          and(
            eq(crewEvents.postId, postId),
            contentVisible("crew", crews.id),
            creditMemberVisible(user, crews.ownerId),
          ),
        )
        .orderBy(asc(crews.id))
        .limit(20),
      connection
        .select({ id: libraryEntries.id, title: libraryEntries.title, kind: libraryEntries.kind })
        .from(templateProvenance)
        .innerJoin(libraryEntries, eq(libraryEntries.id, templateProvenance.entryId))
        .where(
          and(
            eq(templateProvenance.postId, postId),
            eq(libraryEntries.status, "published"),
            contentVisible("library", libraryEntries.id),
            creditMemberVisible(user, libraryEntries.ownerId),
          ),
        ),
    ]);
    const libraries = [...libraryLinks];
    for (const item of source)
      if (!libraries.some((link) => link.id === item.id)) libraries.push(item);
    const links: RecordLink[] = [
      ...postLinks.map((link) => ({ ...link, href: "/posts/" + link.id, kind: "post" as const })),
      ...libraries.map((link) => ({
        ...link,
        href: `/archive/${link.id}`,
        kind: link.kind as "template" | "rulebook",
      })),
      ...crewLinks.map((link) => ({ ...link, href: "/crews/" + link.id, kind: "crew" as const })),
    ];
    return {
      links,
      relatedPostIds: postLinks.map((row) => row.id),
      libraryIds: libraryLinks.map((row) => row.id),
    };
  }
  async function detail(actor: string | null, postId: string): Promise<RecordDetail> {
    const user = await requireRecordMember(db, actor);
    z.uuid().parse(postId);
    const [row] = await rows(db, user, postId);
    if (!row) throw new AppError("NOT_FOUND", "행사 기록을 찾을 수 없어요.");
    const [imageRows, videoRows, relatedView, reviewRows, credits] = await Promise.all([
      db
        .select()
        .from(mediaAssets)
        .where(and(eq(mediaAssets.recordPostId, postId), eq(mediaAssets.status, "ready")))
        .orderBy(asc(mediaAssets.sortOrder)),
      db
        .select()
        .from(videoAssets)
        .where(and(eq(videoAssets.recordPostId, postId), eq(videoAssets.status, "ready")))
        .orderBy(asc(videoAssets.sortOrder)),
      related(db, user, postId),
      db
        .select({
          postId: posts.id,
          title: previewTitleSql,
          rating: verifiedEventReviews.rating,
          author: profiles.nickname,
        })
        .from(verifiedEventReviews)
        .innerJoin(posts, eq(posts.id, verifiedEventReviews.reviewPostId))
        .leftJoin(profiles, eq(profiles.id, posts.authorId))
        .where(
          and(
            eq(verifiedEventReviews.eventPostId, postId),
            eq(posts.status, "published"),
            eq(posts.sample, false),
            contentVisible("post", posts.id),
            creditMemberVisible(user, posts.authorId),
            sql`exists(select 1 from sliper.event_results result where result.application_id=${verifiedEventReviews.applicationId} and result.presence='attended')`,
          ),
        )
        .orderBy(desc(posts.createdAt), desc(posts.id))
        .limit(20),
      acceptedCreditViews(db, user, postId),
    ]);
    const images: PublicImage[] = imageRows.map((image) => ({
      id: image.id,
      src: "/api/media/" + image.id,
      contentType: image.contentType as PublicImage["contentType"],
      sortOrder: image.sortOrder,
    }));
    const videos: PublicVideo[] = videoRows.map((video) => ({
      id: video.id,
      src: "/api/videos/" + video.id,
      contentType: "video/mp4",
      byteSize: video.byteSize,
      width: video.width,
      height: video.height,
      durationSeconds: video.durationSeconds,
      sortOrder: video.sortOrder,
    }));
    return {
      ...recordSummary(row, user),
      snapshot: {
        ...row.record.snapshot,
        location: recordSummary(row, user).location,
        venue: row.venueVisible ? (row.record.snapshot.venue ?? null) : null,
        hostPublicId: row.hostPublicId,
        hostNickname: row.hostNickname ?? "탈퇴한 회원",
        template: relatedView.links.some((link) => link.id === row.record.snapshot.template?.id)
          ? row.record.snapshot.template
          : null,
      },
      purpose: row.record.purpose,
      execution: row.record.execution,
      highlights: row.record.highlights,
      improvements: row.record.improvements,
      venueTips: row.record.snapshot.venue && !row.venueVisible ? "" : row.record.venueTips,
      canEditVenueTips:
        row.record.ownerId === user && (!row.record.snapshot.venue || row.venueVisible),
      bodyDocument: row.record.bodyDocument,
      bodyMarkdown: row.record.bodyMarkdown,
      images,
      videos,
      ...relatedView,
      reviews: reviewRows.map((review) => ({
        ...review,
        author: review.author ?? "탈퇴한 회원",
        href: "/posts/" + review.postId,
      })),
      credits,
      canManage: row.canManage,
    };
  }
  async function lock(tx: Tx, user: string, postId: string, expectedUpdatedAt: string) {
    const [post] = await tx
      .select({ id: posts.id, authorId: posts.authorId })
      .from(posts)
      .where(eq(posts.id, postId))
      .for("update");
    if (!post) throw new AppError("NOT_FOUND", "행사 기록을 찾을 수 없어요.");
    const [record] = await tx
      .select()
      .from(eventRecords)
      .where(and(eq(eventRecords.postId, postId), recordVisible(user, true)))
      .for("update");
    if (!record) throw new AppError("NOT_FOUND", "행사 기록을 찾을 수 없어요.");
    if (record.ownerId !== user || post.authorId !== user)
      throw new AppError("FORBIDDEN", "주최자만 행사 기록을 편집하거나 공개할 수 있어요.");
    const [same] = await tx
      .select({ id: eventRecords.postId })
      .from(eventRecords)
      .where(
        and(
          eq(eventRecords.postId, postId),
          sql`${eventRecords.updatedAt}=${expectedUpdatedAt}::timestamptz`,
        ),
      );
    if (!same)
      throw new AppError(
        "CONFLICT",
        "다른 화면에서 기록을 수정했어요. 새로고침한 뒤 다시 시도해주세요.",
      );
    return record;
  }
  async function validateLinks(
    tx: Tx,
    user: string,
    postId: string,
    postIds: string[],
    libraryIds: string[],
  ) {
    if (
      new Set(postIds).size !== postIds.length ||
      new Set(libraryIds).size !== libraryIds.length ||
      postIds.includes(postId)
    )
      throw new AppError("VALIDATION", "중복되거나 현재 행사와 같은 연결을 제거해주세요.");
    const [foundPosts, foundLibraries] = await Promise.all([
      postIds.length
        ? tx
            .select({ id: posts.id })
            .from(posts)
            .where(
              and(
                inArray(posts.id, postIds),
                eq(posts.status, "published"),
                contentVisible("post", posts.id),
                creditMemberVisible(user, posts.authorId),
              ),
            )
        : [],
      libraryIds.length
        ? tx
            .select({ id: libraryEntries.id })
            .from(libraryEntries)
            .where(
              and(
                inArray(libraryEntries.id, libraryIds),
                eq(libraryEntries.status, "published"),
                contentVisible("library", libraryEntries.id),
                creditMemberVisible(user, libraryEntries.ownerId),
              ),
            )
        : [],
    ]);
    if (foundPosts.length !== postIds.length || foundLibraries.length !== libraryIds.length)
      throw new AppError("NOT_FOUND", "볼 수 있는 게시글이나 아카이브 자료만 연결해주세요.");
  }
  async function save(actor: string | null, postId: string, input: unknown): Promise<RecordDetail> {
    const user = await requireRecordMember(db, actor),
      value = recordSaveSchema.parse(input);
    z.uuid().parse(postId);
    await enforceRequestLimit(db, user, "record_edit", 60);
    await db.transaction(async (tx) => {
      const prior = await lock(tx, user, postId, value.expectedUpdatedAt);
      if (
        value.venueTips !== undefined &&
        prior.snapshot.venue &&
        !(await visibleRegisteredVenue(tx as unknown as Database, user, prior.snapshot.venue.id))
      )
        throw new AppError("FORBIDDEN", "공유 장소를 볼 수 없어 장소 운영 팁을 수정할 수 없어요.");
      if (prior.status === "published") assertPublishable(value);
      await validateLinks(tx, user, postId, value.relatedPostIds, value.libraryIds);
      await attachRecordMedia(tx, postId, user, value.bodyDocument);
      await tx.delete(eventRecordLinks).where(eq(eventRecordLinks.recordPostId, postId));
      const links = [
        ...value.relatedPostIds.map((id) => ({ recordPostId: postId, relatedPostId: id })),
        ...value.libraryIds.map((id) => ({ recordPostId: postId, libraryEntryId: id })),
      ];
      if (links.length) await tx.insert(eventRecordLinks).values(links);
      await tx
        .update(eventRecords)
        .set({
          purpose: value.purpose,
          execution: value.execution,
          highlights: value.highlights,
          improvements: value.improvements,
          venueTips: value.venueTips ?? prior.venueTips,
          bodyDocument: value.bodyDocument,
          bodyMarkdown: value.bodyDocument ? postDocumentToMarkdown(value.bodyDocument) : "",
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(eventRecords.postId, postId));
    });
    return detail(user, postId);
  }
  async function publish(
    actor: string | null,
    postId: string,
    input: unknown,
  ): Promise<RecordDetail> {
    const user = await requireRecordMember(db, actor),
      value = recordPublishSchema.parse(input);
    z.uuid().parse(postId);
    await enforceRequestLimit(db, user, "record_publish", 30);
    await db.transaction(async (tx) => {
      const prior = await lock(tx, user, postId, value.expectedUpdatedAt);
      if (value.published) assertPublishable(prior);
      if (value.published && !prior.publishedAt) {
        // A single insert and a recipient key keep repeat publication notifications unique.
        await tx.execute(sql`insert into sliper.inbox_items(recipient_id,dedupe_key,kind,post_id,source_id,actor_id,title,body,url)
          select recipients.user_id,'record:published:' || ${postId}::text,'records',${postId}::uuid,${postId}::uuid,${user}::uuid,
          ${prior.snapshot.title.slice(0, 120)},'참여한 행사의 회고가 공개되었어요.',${"/records/" + postId}
          from (select er.user_id from sliper.event_results er where er.post_id=${postId}::uuid and er.presence='attended'
            union select ec.user_id from sliper.event_credits ec where ec.post_id=${postId}::uuid and ec.status='accepted') recipients
          join sliper.profiles recipient on recipient.id=recipients.user_id
          where recipients.user_id<>${user}::uuid and ${creditMemberVisible(user, sql`recipients.user_id`)}
          on conflict(recipient_id,dedupe_key) do nothing`);
      }
      await tx
        .update(eventRecords)
        .set({
          status: value.published ? "published" : "withdrawn",
          publishedAt: value.published
            ? (prior.publishedAt ?? sql`statement_timestamp()`)
            : prior.publishedAt,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(eventRecords.postId, postId));
    });
    return detail(user, postId);
  }
  return { list, detail, save, publish };
}
