import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/connection";
import {
  eventRecords,
  eventApplications,
  eventSettings,
  externalReceipts,
  paymentOrders,
  posts,
  profiles,
  refundRequests,
  roomManagers,
} from "../db/schema";
import {
  admissionTickets,
  eventAdmissions,
  verifiedEventReviews,
} from "../db/event-operations-schema";
import { readEventVenueSnapshot } from "./event-venue-service";
import { templateProvenance } from "../db/library-schema";
import { eventResults } from "../db/player-schema";
import { memberSafety } from "../db/safety-schema";
import { membershipActive } from "../domain/safety";
import {
  scanInputSchema,
  ticketInputSchema,
  verifiedReviewInputSchema,
  type AdmissionCandidate,
  type AdmissionRoster,
  type EventReviewView,
  type TicketView,
} from "../domain/event-operations";
import { AppError, requireActor } from "./errors";
import { assertContentVisible, authorVisible, contentVisible } from "./safety-visibility";
import { enforceRequestLimit } from "./request-limits";
import { awardActivity } from "./activity";
import { assertEventRunning, isEventCancelled } from "./event-lifecycle-service";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
const hash = (code: string) => createHash("sha256").update(code).digest("hex");
export function eventOperationsService(db: Database, clock = () => new Date()) {
  async function lock(tx: Tx, actor: string, postId: string, manage = false) {
    const [post] = await tx
      .select()
      .from(posts)
      .where(eq(posts.id, z.uuid().parse(postId)))
      .for("update");
    if (!post || post.kind !== "모집" || post.status !== "published")
      throw new AppError("NOT_FOUND", "행사를 찾을 수 없어요.");
    const [state] = await tx.select().from(memberSafety).where(eq(memberSafety.userId, actor));
    if (!membershipActive(state)) throw new AppError("FORBIDDEN", "계정 이용이 제한되어 있어요.");
    if (manage && post.authorId !== actor) {
      const [role] = await tx
        .select()
        .from(roomManagers)
        .where(and(eq(roomManagers.postId, postId), eq(roomManagers.userId, actor)));
      if (!role) throw new AppError("FORBIDDEN", "이 행사 담당자만 관리할 수 있어요.");
    }
    const [settings] = await tx
      .select()
      .from(eventSettings)
      .where(eq(eventSettings.postId, postId));
    if (!settings) throw new AppError("CONFLICT", "행사 설정이 준비되지 않았어요.");
    return { post, settings };
  }
  async function eligibility(tx: Tx, application: typeof eventApplications.$inferSelect) {
    if (application.status !== "confirmed")
      throw new AppError("CONFLICT", "참가가 확정된 신청만 입장할 수 있어요.");
    const [state] = await tx
      .select()
      .from(memberSafety)
      .where(eq(memberSafety.userId, application.userId));
    if (!membershipActive(state))
      throw new AppError("CONFLICT", "이 참가자의 계정 이용이 제한되어 있어요.");
    const [refund] = await tx
      .select({ id: refundRequests.id })
      .from(refundRequests)
      .where(
        and(eq(refundRequests.applicationId, application.id), eq(refundRequests.state, "pending")),
      );
    if (refund)
      throw new AppError(
        "CONFLICT",
        "환불 검토 중인 참가 내역이에요. 환불 관리에서 먼저 확인해주세요.",
      );
    const [order] = await tx
      .select()
      .from(paymentOrders)
      .where(eq(paymentOrders.applicationId, application.id));
    const [receipt] = await tx
      .select()
      .from(externalReceipts)
      .where(eq(externalReceipts.applicationId, application.id));
    if (application.source === "external" || application.amountKRW > 0) {
      const payment = application.source === "external" ? receipt : order;
      if (!payment || payment.state !== "paid" || payment.amountKRW !== application.amountKRW)
        throw new AppError(
          "CONFLICT",
          "결제 확인이 필요해요. 결제 예외 관리에서 먼저 확인해주세요.",
        );
    }
  }
  function window(settings: typeof eventSettings.$inferSelect) {
    if (!settings.startsAt || !settings.endsAt)
      throw new AppError("CONFLICT", "담당자가 정확한 행사 시작·종료 시각을 먼저 설정해야 해요.");
    const now = clock();
    if (now >= settings.endsAt) throw new AppError("CONFLICT", "종료된 행사에는 입장할 수 없어요.");
    return {
      now,
      starts: settings.startsAt,
      ends: settings.endsAt,
      open: now.getTime() >= settings.startsAt.getTime() - 2 * 3600000,
    };
  }
  async function issue(actor: string | null, postId: string, input: unknown): Promise<TicketView> {
    const user = requireActor(actor),
      value = ticketInputSchema.parse(input);
    await enforceRequestLimit(db, user, "ticket", 30);
    return db.transaction(async (tx) => {
      const { post, settings } = await lock(tx, user, postId);
      await assertEventRunning(tx, postId);
      const times = window(settings);
      const [application] = await tx
        .select()
        .from(eventApplications)
        .where(
          and(
            eq(eventApplications.id, value.applicationId),
            eq(eventApplications.postId, postId),
            eq(eventApplications.userId, user),
          ),
        )
        .for("update");
      if (!application) throw new AppError("NOT_FOUND", "본인의 참가 신청을 찾을 수 없어요.");
      await eligibility(tx, application);
      const [entered] = await tx
        .select()
        .from(eventAdmissions)
        .where(eq(eventAdmissions.applicationId, application.id));
      if (entered) throw new AppError("CONFLICT", "이미 입장 확인을 완료했어요.");
      const code = randomBytes(32).toString("base64url");
      await tx
        .insert(admissionTickets)
        .values({ applicationId: application.id, codeHash: hash(code), expiresAt: times.ends })
        .onConflictDoUpdate({
          target: admissionTickets.applicationId,
          set: { codeHash: hash(code), expiresAt: times.ends, createdAt: times.now },
        });
      return {
        applicationId: application.id,
        code,
        expiresAt: times.ends.toISOString(),
        attendeeName: application.attendeeName,
        title: post.title,
      };
    });
  }
  async function scan(
    actor: string | null,
    postId: string,
    input: unknown,
    admit = false,
  ): Promise<AdmissionCandidate> {
    const user = requireActor(actor),
      value = scanInputSchema.parse(input);
    await enforceRequestLimit(db, user, "ticket_scan", 240, 60);
    return db.transaction(async (tx) => {
      const { post, settings } = await lock(tx, user, postId, true);
      await assertEventRunning(tx, postId);
      const times = window(settings);
      const [ticket] = await tx
        .select()
        .from(admissionTickets)
        .where(eq(admissionTickets.codeHash, hash(value.code)))
        .for("update");
      if (!ticket || ticket.expiresAt <= times.now)
        throw new AppError("NOT_FOUND", "만료되었거나 다시 발급된 입장권이에요.");
      const [application] = await tx
        .select()
        .from(eventApplications)
        .where(
          and(eq(eventApplications.id, ticket.applicationId), eq(eventApplications.postId, postId)),
        )
        .for("update");
      if (!application) throw new AppError("NOT_FOUND", "이 행사의 입장권이 아니에요.");
      await eligibility(tx, application);
      const [profile] = await tx
        .select({ nickname: profiles.nickname })
        .from(profiles)
        .where(eq(profiles.id, application.userId));
      let [entered] = await tx
        .select()
        .from(eventAdmissions)
        .where(eq(eventAdmissions.applicationId, application.id));
      if (admit && !entered) {
        if (!times.open)
          throw new AppError("CONFLICT", "입장 확인은 행사 시작 2시간 전부터 가능해요.");
        if (application.userId === user)
          throw new AppError("FORBIDDEN", "본인의 입장은 다른 행사 담당자가 확인해야 해요.");
        [entered] = await tx
          .insert(eventAdmissions)
          .values({
            applicationId: application.id,
            postId,
            userId: application.userId,
            checkedBy: user,
            checkedAt: times.now,
          })
          .returning();
      }
      const message = entered
        ? "입장 확인을 완료했어요."
        : !times.open
          ? "행사 시작 2시간 전부터 입장을 확인할 수 있어요."
          : application.userId === user
            ? "본인의 입장은 다른 담당자가 확인해주세요."
            : "참가자 정보를 확인하고 입장 완료를 눌러주세요.";
      return {
        applicationId: application.id,
        attendeeName: application.attendeeName,
        nickname: profile?.nickname ?? "참가자",
        title: post.title,
        checkedAt: entered?.checkedAt.toISOString() ?? null,
        canAdmit: !entered && times.open && application.userId !== user,
        message,
      };
    });
  }
  async function roster(
    actor: string | null,
    postId: string,
    input: unknown = {},
  ): Promise<AdmissionRoster> {
    const user = requireActor(actor),
      query = z
        .strictObject({
          page: z.coerce.number().int().min(1).max(10000).default(1),
          search: z.string().trim().max(80).default(""),
        })
        .parse(input);
    return db.transaction(async (tx) => {
      const { post, settings } = await lock(tx, user, postId, true);
      const [stats] = await tx
        .select({
          confirmed: sql<number>`count(*)::int`,
          checkedIn: sql<number>`count(*) filter(where ${eventAdmissions.applicationId} is not null)::int`,
        })
        .from(eventApplications)
        .leftJoin(eventAdmissions, eq(eventAdmissions.applicationId, eventApplications.id))
        .where(
          and(eq(eventApplications.postId, postId), eq(eventApplications.status, "confirmed")),
        );
      const rows = await tx
        .select({
          applicationId: eventApplications.id,
          attendeeName: eventApplications.attendeeName,
          nickname: profiles.nickname,
          checkedAt: eventAdmissions.checkedAt,
        })
        .from(eventApplications)
        .innerJoin(profiles, eq(profiles.id, eventApplications.userId))
        .leftJoin(eventAdmissions, eq(eventAdmissions.applicationId, eventApplications.id))
        .where(
          and(
            eq(eventApplications.postId, postId),
            eq(eventApplications.status, "confirmed"),
            query.search
              ? or(
                  ilike(eventApplications.attendeeName, `%${query.search}%`),
                  ilike(profiles.nickname, `%${query.search}%`),
                )
              : undefined,
          ),
        )
        .orderBy(eventApplications.createdAt, eventApplications.id)
        .limit(21)
        .offset((query.page - 1) * 20);
      return {
        postId,
        title: post.title,
        startsAt: settings.startsAt?.toISOString() ?? null,
        endsAt: settings.endsAt?.toISOString() ?? null,
        confirmed: stats?.confirmed ?? 0,
        checkedIn: stats?.checkedIn ?? 0,
        items: rows
          .slice(0, 20)
          .map((r) => ({ ...r, checkedAt: r.checkedAt?.toISOString() ?? null })),
        page: query.page,
        hasMore: rows.length > 20,
      };
    });
  }
  async function reviews(actor: string | null, postId: string, page = 1): Promise<EventReviewView> {
    z.uuid().parse(postId);
    const [event] = await db
      .select({ title: posts.title, endsAt: eventSettings.endsAt })
      .from(posts)
      .innerJoin(eventSettings, eq(eventSettings.postId, posts.id))
      .where(
        and(
          eq(posts.id, postId),
          eq(posts.status, "published"),
          contentVisible("post", posts.id),
          authorVisible(posts.authorId, actor),
        ),
      );
    if (!event) throw new AppError("NOT_FOUND", "행사를 찾을 수 없어요.");
    const cancelled = await isEventCancelled(db, postId);
    const [own] = actor
      ? await db
          .select({
            checkedAt: eventAdmissions.checkedAt,
            status: eventApplications.status,
            reviewPostId: verifiedEventReviews.reviewPostId,
          })
          .from(eventAdmissions)
          .innerJoin(eventApplications, eq(eventApplications.id, eventAdmissions.applicationId))
          .leftJoin(
            verifiedEventReviews,
            eq(verifiedEventReviews.applicationId, eventAdmissions.applicationId),
          )
          .where(and(eq(eventAdmissions.postId, postId), eq(eventAdmissions.userId, actor)))
      : [];
    const rows = await db
      .select({
        reviewPostId: posts.id,
        title: posts.title,
        body: posts.bodyMarkdown,
        author: profiles.nickname,
        rating: verifiedEventReviews.rating,
        createdAt: posts.createdAt,
      })
      .from(verifiedEventReviews)
      .innerJoin(posts, eq(posts.id, verifiedEventReviews.reviewPostId))
      .leftJoin(profiles, eq(profiles.id, posts.authorId))
      .where(
        and(
          eq(verifiedEventReviews.eventPostId, postId),
          eq(posts.status, "published"),
          contentVisible("post", posts.id),
          authorVisible(posts.authorId, actor),
        ),
      )
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(21)
      .offset((page - 1) * 20);
    return {
      postId,
      title: event.title,
      canReview:
        !cancelled &&
        !!own &&
        own.status === "confirmed" &&
        !!event.endsAt &&
        event.endsAt <= clock() &&
        !own.reviewPostId,
      checkedAt: own?.checkedAt.toISOString() ?? null,
      ownReviewPostId: own?.reviewPostId ?? null,
      reviews: rows.slice(0, 20).map((r) => ({
        ...r,
        author: r.author ?? "탈퇴한 회원",
        createdAt: r.createdAt.toISOString(),
      })),
      page,
      hasMore: rows.length > 20,
    };
  }
  async function writeReview(actor: string | null, postId: string, input: unknown) {
    const user = requireActor(actor),
      value = verifiedReviewInputSchema.parse(input);
    await assertContentVisible(db, "post", z.uuid().parse(postId));
    await enforceRequestLimit(db, user, "post", 20);
    await db.transaction(async (tx) => {
      const { post, settings } = await lock(tx, user, postId);
      await assertEventRunning(tx, postId);
      const [visible] = await tx
        .select({ id: posts.id })
        .from(posts)
        .where(
          and(
            eq(posts.id, postId),
            contentVisible("post", posts.id),
            authorVisible(posts.authorId, user),
          ),
        );
      if (!visible) throw new AppError("NOT_FOUND", "행사를 찾을 수 없어요.");
      if (!settings.endsAt || settings.endsAt > clock())
        throw new AppError("CONFLICT", "행사가 종료된 뒤 후기를 남길 수 있어요.");
      if (post.authorId === user)
        throw new AppError("FORBIDDEN", "주최자는 자신의 행사에 참가 후기를 남길 수 없어요.");
      const [admission] = await tx
        .select()
        .from(eventAdmissions)
        .innerJoin(eventApplications, eq(eventApplications.id, eventAdmissions.applicationId))
        .where(
          and(
            eq(eventAdmissions.postId, postId),
            eq(eventAdmissions.userId, user),
            eq(eventApplications.status, "confirmed"),
          ),
        );
      if (!admission)
        throw new AppError("FORBIDDEN", "QR 입장이 확인된 참가자만 인증 후기를 작성할 수 있어요.");
      const [prior] = await tx
        .select()
        .from(verifiedEventReviews)
        .where(
          and(eq(verifiedEventReviews.eventPostId, postId), eq(verifiedEventReviews.userId, user)),
        );
      if (prior)
        throw new AppError(
          "CONFLICT",
          "이 행사에는 이미 인증 후기를 남겼어요. 기존 글에서 수정할 수 있어요.",
        );
      const [source] = await tx
        .select({ entryId: templateProvenance.entryId })
        .from(templateProvenance)
        .where(eq(templateProvenance.postId, postId));
      const [created] = await tx
        .insert(posts)
        .values({
          authorId: user,
          categorySlug: post.categorySlug,
          kind: "후기",
          isAnonymous: false,
          title: value.title,
          bodyMarkdown: value.bodyMarkdown,
        })
        .returning({ id: posts.id });
      await tx.insert(verifiedEventReviews).values({
        reviewPostId: created!.id,
        eventPostId: postId,
        applicationId: admission.event_admissions.applicationId,
        userId: user,
        hostId: post.authorId,
        templateEntryId: source?.entryId ?? null,
        eventTitle: post.title,
        rating: value.rating,
      });
      await awardActivity(tx, user, "post", created!.id);
    });
    return reviews(user, postId);
  }
  async function finalize(actor: string | null, postId: string) {
    const user = requireActor(actor);
    return db.transaction(async (tx) => {
      const { post, settings } = await lock(tx, user, postId, true);
      await assertEventRunning(tx, postId);
      if (!settings.endsAt || settings.endsAt > clock())
        throw new AppError("CONFLICT", "행사 종료 시각 이후에 참가 전적을 반영할 수 있어요.");
      const entries = await tx
        .select({
          applicationId: eventAdmissions.applicationId,
          userId: eventAdmissions.userId,
          recorderId: eventAdmissions.checkedBy,
        })
        .from(eventAdmissions)
        .innerJoin(eventApplications, eq(eventApplications.id, eventAdmissions.applicationId))
        .where(eq(eventAdmissions.postId, postId));
      const created = entries.length
        ? await tx
            .insert(eventResults)
            .values(
              entries.map((entry) => ({
                ...entry,
                postId,
                presence: "attended",
                outcome: "participated",
                reason: "QR 입장 확인으로 참가 완료",
              })),
            )
            .onConflictDoNothing()
            .returning({ id: eventResults.applicationId })
        : [];
      const completedAt = settings.completedAt ?? clock();
      if (!settings.completedAt)
        await tx
          .update(eventSettings)
          .set({ open: false, completedAt, completedBy: user })
          .where(eq(eventSettings.postId, postId));
      else
        await tx.update(eventSettings).set({ open: false }).where(eq(eventSettings.postId, postId));
      const [host] = post.authorId
        ? await tx
            .select({ publicId: profiles.publicId, nickname: profiles.nickname })
            .from(profiles)
            .where(eq(profiles.id, post.authorId))
        : [];
      const [source] = await tx
        .select()
        .from(templateProvenance)
        .where(eq(templateProvenance.postId, postId));
      const venueSnapshot = await readEventVenueSnapshot(tx, postId);
      await tx
        .insert(eventRecords)
        .values({
          postId,
          ownerId: post.authorId,
          completedAt,
          snapshot: {
            title: post.title,
            category: post.categorySlug,
            location: post.location ?? "",
            venue: venueSnapshot,
            startsAt: settings.startsAt?.toISOString() ?? null,
            endsAt: settings.endsAt?.toISOString() ?? null,
            hostPublicId: host?.publicId ?? null,
            hostNickname: host?.nickname ?? "탈퇴한 회원",
            template: source
              ? {
                  id: source.entryId,
                  title: source.snapshot.title,
                  versionId: source.versionId,
                  versionNumber: source.snapshot.versionNumber ?? null,
                }
              : null,
          },
        })
        .onConflictDoNothing();
      return { recorded: created.length };
    });
  }
  return { issue, scan, roster, reviews, writeReview, finalize, lock };
}
