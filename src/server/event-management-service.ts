import { createHash } from "node:crypto";
import { and, eq, desc, sql, or, ilike } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/connection";
import {
  posts,
  profiles,
  eventSettings,
  eventApplications,
  paymentOrders,
  roomManagers,
  externalReceipts,
  externalWebhookEvents,
  refundRequests,
} from "../db/schema";
import {
  externalClaimSchema,
  externalDecisionSchema,
  externalPaymentEventSchema,
  managementQuerySchema,
  type EventOverview,
  type EventDashboard,
  type ManagedEvent,
} from "../domain/participation";
import { AppError, requireActor } from "./errors";
import { assertContentVisible } from "./safety-visibility";
import { assertEventRunning, isEventCancelled } from "./event-lifecycle-service";
import type { applicationSchema } from "../domain/participation";
import type { ApplicationQuestion } from "../domain/application-questions";
import { decodeCursor, encodeCursor, pageScope, preciseTimestamp } from "./pagination";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Helpers = {
  lockEvent: (
    tx: Tx,
    id: string,
  ) => Promise<{
    post: typeof posts.$inferSelect;
    settings: typeof eventSettings.$inferSelect | undefined;
  }>;
  overview: (actor: string | null, id: string) => Promise<EventOverview>;
  appProjection: typeof import("./participation-service").appProjection;
  applicationView: typeof import("./participation-service").applicationView;
  questionnaireVersion: (questions: readonly ApplicationQuestion[]) => string;
  prepareApplication: (
    tx: Tx,
    user: string,
    settings: typeof eventSettings.$inferSelect,
    value: z.infer<typeof applicationSchema>,
  ) => Promise<{
    attendeeName: string;
    contact: string;
    note: string;
    answers: typeof eventApplications.$inferSelect.answers;
    questionnaireVersion: string;
    refundConsentAt: ReturnType<typeof sql> | null;
  }>;
};
const effectiveStatus = sql<string>`case when ${eventApplications.status}='pending_payment' and ${eventApplications.expiresAt}<=statement_timestamp() then 'expired' else ${eventApplications.status} end`;
const occupied = sql`(status='confirmed' or (status='pending_payment' and expires_at>statement_timestamp()))`;
export function eventManagementService(db: Database, helpers: Helpers) {
  async function manager(tx: Tx, user: string, postId: string) {
    const value = await helpers.lockEvent(tx, postId);
    const [role] = await tx
      .select({ userId: roomManagers.userId })
      .from(roomManagers)
      .where(and(eq(roomManagers.postId, postId), eq(roomManagers.userId, user)));
    if (value.post.authorId !== user && !role)
      throw new AppError("FORBIDDEN", "행사 담당자만 관리 화면을 이용할 수 있어요.");
    return value;
  }
  async function claimExternal(actor: string | null, postId: string, input: unknown) {
    const user = requireActor(actor),
      value = externalClaimSchema.parse(input);
    await assertContentVisible(db, "post", z.uuid().parse(postId));
    await db.transaction(async (tx) => {
      const { post, settings } = await helpers.lockEvent(tx, postId);
      await assertEventRunning(tx, postId);
      if (!post.applicationUrl)
        throw new AppError(
          "CONFLICT",
          "외부 신청 링크가 있는 행사에서만 참가 확인을 요청할 수 있어요.",
        );
      if (!settings) throw new AppError("CONFLICT", "참가 확인 설정이 준비되지 않았어요.");
      let [existing] = await tx
        .select()
        .from(eventApplications)
        .where(
          and(
            eq(eventApplications.postId, postId),
            eq(eventApplications.userId, user),
            sql`(status in ('pending_approval','confirmed') or (status='pending_payment' and expires_at>statement_timestamp()))`,
          ),
        );
      if (!existing)
        [existing] = await tx
          .select()
          .from(eventApplications)
          .where(
            and(
              eq(eventApplications.postId, postId),
              eq(eventApplications.userId, user),
              eq(eventApplications.status, "review"),
            ),
          )
          .orderBy(desc(eventApplications.createdAt), desc(eventApplications.id))
          .limit(1);
      if (existing) {
        if (
          existing.source !== "external" ||
          existing.externalReference !== value.externalReference
        )
          throw new AppError(
            "CONFLICT",
            "이미 진행 중인 참가 내역이 있어요. 담당자 확인 또는 요청 취소 후 다시 시도해주세요.",
          );
        if (existing.questionnaireVersion !== null || existing.status === "confirmed") return;
        // A signed payment may arrive before the member has completed the form.
        // Only that unsubmitted external record may be completed once in place.
        const submission = await helpers.prepareApplication(tx, user, settings, value);
        const [receipt] = await tx
          .select()
          .from(externalReceipts)
          .where(eq(externalReceipts.applicationId, existing.id));
        let status = existing.status;
        if (receipt?.state === "paid" && settings.approvalMode === "automatic") {
          const [other] = await tx
            .select({ id: eventApplications.id })
            .from(eventApplications)
            .where(
              and(
                eq(eventApplications.postId, postId),
                eq(eventApplications.userId, user),
                sql`id<>${existing.id} and status in ('pending_payment','pending_approval','confirmed')`,
              ),
            )
            .limit(1);
          status =
            !other &&
            (!settings.endsAt || settings.endsAt.getTime() > Date.now()) &&
            (await hasSeat(tx, postId, settings.capacity))
              ? "confirmed"
              : "review";
        }
        await tx
          .update(eventApplications)
          .set({
            ...submission,
            status,
            confirmedAt: status === "confirmed" ? sql`statement_timestamp()` : existing.confirmedAt,
            decisionNote:
              existing.decisionNote === "참가 질문에 답변한 뒤 참가 확인을 제출해주세요."
                ? ""
                : existing.decisionNote,
            updatedAt: sql`statement_timestamp()`,
          })
          .where(eq(eventApplications.id, existing.id));
        return;
      }
      if (!settings.open) throw new AppError("CONFLICT", "참가 확인 접수가 열려 있지 않아요.");
      const [usedReference] = await tx
        .select({ id: externalReceipts.applicationId })
        .from(externalReceipts)
        .where(
          and(
            eq(externalReceipts.postId, postId),
            eq(externalReceipts.reference, value.externalReference),
          ),
        )
        .limit(1);
      if (usedReference)
        throw new AppError(
          "CONFLICT",
          "이미 처리된 외부 신청 번호예요. 새 신청 번호를 확인해주세요.",
        );
      const submission = await helpers.prepareApplication(tx, user, settings, value);
      await tx.insert(eventApplications).values({
        postId,
        userId: user,
        source: "external",
        externalReference: value.externalReference,
        ...submission,
        amountKRW: settings.amountKRW,
        status: "pending_approval",
        expiresAt: null,
      });
    });
    return helpers.overview(actor, postId);
  }
  async function hasSeat(tx: Tx, postId: string, capacity: number) {
    const [total] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(eventApplications)
      .where(and(eq(eventApplications.postId, postId), occupied));
    return total!.count < capacity;
  }
  async function decideExternal(actor: string | null, applicationId: string, input: unknown) {
    const user = requireActor(actor),
      value = externalDecisionSchema.parse(input),
      id = z.uuid().parse(applicationId);
    const [lookup] = await db
      .select({ postId: eventApplications.postId })
      .from(eventApplications)
      .where(eq(eventApplications.id, id));
    if (!lookup) throw new AppError("NOT_FOUND", "참가 확인 요청을 찾을 수 없어요.");
    try {
      await db.transaction(async (tx) => {
        const { settings } = await manager(tx, user, lookup.postId);
        const [app] = await tx.select().from(eventApplications).where(eq(eventApplications.id, id));
        if (!settings || app!.source !== "external")
          throw new AppError(
            "CONFLICT",
            "외부 신청 참가 확인 요청만 이 화면에서 처리할 수 있어요.",
          );
        const [receipt] = await tx
          .select()
          .from(externalReceipts)
          .where(eq(externalReceipts.applicationId, id));
        if (value.decision === "approve") {
          await assertEventRunning(tx, lookup.postId);
          if (app!.status === "confirmed") return;
          if (app!.questionnaireVersion === null)
            throw new AppError(
              "CONFLICT",
              "참가자가 먼저 가입 기본 정보와 참가 질문 답변을 제출해야 승인할 수 있어요.",
            );
          if (
            !["pending_approval", "review"].includes(app!.status) ||
            receipt?.state === "refunded"
          )
            throw new AppError("CONFLICT", "승인 가능한 요청이 아니에요.");
          const [otherActive] = await tx
            .select({ id: eventApplications.id })
            .from(eventApplications)
            .where(
              and(
                eq(eventApplications.postId, app!.postId),
                eq(eventApplications.userId, app!.userId),
                sql`id<>${id} and status in ('pending_payment','pending_approval','confirmed')`,
              ),
            )
            .limit(1);
          if (otherActive)
            throw new AppError(
              "CONFLICT",
              "같은 회원의 다른 참가 내역이 진행 중이에요. 중복 내역을 먼저 확인해주세요.",
            );
          if (!(await hasSeat(tx, app!.postId, settings.capacity)))
            throw new AppError(
              "CONFLICT",
              "정원이 찼어요. 외부 플랫폼의 정원·환불 정책을 확인해주세요.",
            );
          if (!receipt)
            await tx.insert(externalReceipts).values({
              applicationId: id,
              postId: app!.postId,
              reference: app!.externalReference!,
              amountKRW: app!.amountKRW,
              provider: "manual",
              verification: "manual",
              verifiedBy: user,
              state: "paid",
            });
          await tx
            .update(eventApplications)
            .set({
              status: "confirmed",
              confirmedAt: sql`statement_timestamp()`,
              decisionNote: value.reason,
              updatedAt: sql`statement_timestamp()`,
            })
            .where(eq(eventApplications.id, id));
        } else if (value.decision === "reject") {
          if (app!.status === "rejected") return;
          if (app!.status !== "pending_approval" || receipt)
            throw new AppError(
              "CONFLICT",
              "미확인 요청만 반려할 수 있어요. 확인된 결제는 환불 확인으로 처리해주세요.",
            );
          await tx
            .update(eventApplications)
            .set({
              status: "rejected",
              decisionNote: value.reason,
              updatedAt: sql`statement_timestamp()`,
            })
            .where(eq(eventApplications.id, id));
        } else {
          if (app!.status === "refunded") return;
          if (!receipt || !["confirmed", "review", "pending_approval"].includes(app!.status))
            throw new AppError("CONFLICT", "결제가 확인된 참가 내역만 환불 확인할 수 있어요.");
          const [pendingRefund] = await tx
            .select({ id: refundRequests.id })
            .from(refundRequests)
            .where(and(eq(refundRequests.applicationId, id), eq(refundRequests.state, "pending")));
          if (pendingRefund)
            throw new AppError(
              "CONFLICT",
              "접수된 환불 요청에서 정해진 환불 금액을 확인한 뒤 처리해주세요.",
            );
          await tx
            .update(externalReceipts)
            .set({
              state: "refunded",
              refundedAmountKRW: app!.amountKRW,
              updatedAt: sql`statement_timestamp()`,
            })
            .where(eq(externalReceipts.applicationId, id));
          await tx
            .update(eventApplications)
            .set({
              status: "refunded",
              decisionNote: value.reason,
              updatedAt: sql`statement_timestamp()`,
            })
            .where(eq(eventApplications.id, id));
        }
      });
    } catch (error) {
      if ((error as { cause?: { code?: string } }).cause?.code === "23505")
        throw new AppError("CONFLICT", "같은 외부 신청 번호가 이미 다른 참가자에게 확인되었어요.");
      throw error;
    }
    return { postId: lookup.postId };
  }
  async function externalPayment(provider: string, input: unknown) {
    const event = externalPaymentEventSchema.parse(input),
      digest = createHash("sha256").update(JSON.stringify(event)).digest("hex");
    if (
      event.refundAmountKRW !== undefined &&
      (event.status !== "refunded" || event.refundAmountKRW > event.amountKRW)
    )
      throw new AppError("VALIDATION", "환불 알림 금액을 확인해주세요.");
    if (
      !/^[a-zA-Z0-9_-]{1,40}$/.test(provider) ||
      provider === "manual" ||
      provider === "local-test"
    )
      throw new AppError("VALIDATION", "외부 연동 제공자를 확인해주세요.");
    try {
      return await db.transaction(async (tx) => {
        const { post, settings } = await helpers.lockEvent(tx, event.postId);
        const cancelled = await isEventCancelled(tx, event.postId);
        if (!post.applicationUrl || !settings)
          throw new AppError("CONFLICT", "외부 신청을 받는 행사가 아니에요.");
        const [profile] = await tx
          .select({ id: profiles.id })
          .from(profiles)
          .where(eq(profiles.publicId, event.publicProfileId));
        if (!profile) throw new AppError("NOT_FOUND", "외부 신청과 연결할 회원이 없어요.");
        const [prior] = await tx
          .select()
          .from(externalWebhookEvents)
          .where(
            and(
              eq(externalWebhookEvents.provider, provider),
              eq(externalWebhookEvents.eventId, event.eventId),
            ),
          );
        if (prior) {
          if (prior.digest !== digest) throw new AppError("CONFLICT", "중복 알림의 내용이 달라요.");
          return { duplicate: true };
        }
        let [app] = await tx
          .select()
          .from(eventApplications)
          .where(
            and(
              eq(eventApplications.postId, event.postId),
              eq(eventApplications.userId, profile.id),
              eq(eventApplications.source, "external"),
              eq(eventApplications.externalReference, event.externalReference),
            ),
          )
          .orderBy(desc(eventApplications.createdAt), desc(eventApplications.id))
          .limit(1);
        if (!app) {
          const [active] = await tx
            .select({ id: eventApplications.id })
            .from(eventApplications)
            .where(
              and(
                eq(eventApplications.postId, event.postId),
                eq(eventApplications.userId, profile.id),
                sql`status in ('pending_approval','confirmed','pending_payment')`,
              ),
            );
          if (settings.amountKRW !== event.amountKRW)
            throw new AppError("CONFLICT", "행사 비용과 외부 결제 금액이 일치하지 않아요.");
          [app] = await tx
            .insert(eventApplications)
            .values({
              postId: event.postId,
              userId: profile.id,
              source: "external",
              externalReference: event.externalReference,
              attendeeName: event.attendeeName,
              contact: event.contact,
              amountKRW: event.amountKRW,
              questionnaireVersion:
                settings.questions.length > 0
                  ? null
                  : helpers.questionnaireVersion(settings.questions),
              status: cancelled || active ? "review" : "pending_approval",
              decisionNote: cancelled
                ? "취소된 행사에 도착한 결제 내역이에요. 외부 플랫폼 환불 확인이 필요해요."
                : active
                  ? "같은 회원의 다른 참가 내역이 있어 담당자 확인이 필요해요."
                  : settings.questions.length > 0
                    ? "참가 질문에 답변한 뒤 참가 확인을 제출해주세요."
                    : "",
              expiresAt: null,
            })
            .returning();
        }
        if (app!.amountKRW !== event.amountKRW)
          throw new AppError("CONFLICT", "참가 내역과 결제 금액이 일치하지 않아요.");
        const [receipt] = await tx
          .select()
          .from(externalReceipts)
          .where(eq(externalReceipts.applicationId, app!.id));
        if (
          receipt?.state === "refunded" &&
          event.status === "refunded" &&
          receipt.refundedAmountKRW !== (event.refundAmountKRW ?? event.amountKRW)
        )
          throw new AppError("CONFLICT", "이미 확인한 실제 환불 금액과 알림 금액이 달라요.");
        if (receipt && receipt.provider !== provider && receipt.provider !== "manual")
          throw new AppError("CONFLICT", "기존 결제 제공자와 일치하지 않아요.");
        if (!receipt)
          await tx.insert(externalReceipts).values({
            applicationId: app!.id,
            postId: event.postId,
            reference: event.externalReference,
            amountKRW: event.amountKRW,
            provider,
            verification: "integration",
            state: event.status,
            refundedAmountKRW:
              event.status === "refunded" ? (event.refundAmountKRW ?? event.amountKRW) : null,
          });
        else if (event.status === "refunded" && receipt.state !== "refunded")
          await tx
            .update(externalReceipts)
            .set({
              state: "refunded",
              refundedAmountKRW: event.refundAmountKRW ?? event.amountKRW,
              updatedAt: sql`statement_timestamp()`,
            })
            .where(eq(externalReceipts.applicationId, app!.id));
        let status = app!.status;
        if (receipt?.state === "refunded" || event.status === "refunded") status = "refunded";
        else if (cancelled && app!.status !== "confirmed") status = "review";
        else if (
          app!.status === "pending_approval" &&
          app!.questionnaireVersion !== null &&
          settings.approvalMode === "automatic"
        )
          status =
            !cancelled &&
            (!settings.endsAt || settings.endsAt.getTime() > Date.now()) &&
            (await hasSeat(tx, event.postId, settings.capacity))
              ? "confirmed"
              : "review";
        else if (["rejected", "cancelled"].includes(app!.status)) status = "review";
        // Refund/cancellation never gets silently reversed by a late paid event.
        if (app!.status === "refunded") status = "refunded";
        if (status !== app!.status)
          await tx
            .update(eventApplications)
            .set({
              status,
              confirmedAt: status === "confirmed" ? sql`statement_timestamp()` : app!.confirmedAt,
              updatedAt: sql`statement_timestamp()`,
            })
            .where(eq(eventApplications.id, app!.id));
        if (event.status === "refunded")
          await tx
            .update(refundRequests)
            .set({
              state: "completed",
              actualRefundKRW: event.refundAmountKRW ?? event.amountKRW,
              processedAt: sql`statement_timestamp()`,
              decisionNote: "외부 플랫폼의 검증된 취소·환불 알림 확인",
            })
            .where(
              and(eq(refundRequests.applicationId, app!.id), eq(refundRequests.state, "pending")),
            );
        await tx
          .insert(externalWebhookEvents)
          .values({ provider, eventId: event.eventId, postId: event.postId, digest });
        return { duplicate: false, status };
      });
    } catch (error) {
      if ((error as { cause?: { code?: string } }).cause?.code === "23505")
        throw new AppError("CONFLICT", "이미 다른 참가 내역에 사용된 외부 신청 번호예요.");
      throw error;
    }
  }
  async function dashboard(
    actor: string | null,
    postId: string,
    input: unknown = {},
  ): Promise<EventDashboard> {
    const user = requireActor(actor),
      query = managementQuerySchema.parse(input),
      scope = pageScope(["event-dashboard", user, postId, query.status, query.search]),
      before = decodeCursor(query.cursor, scope);
    const data = await db.transaction(async (tx) => {
      await manager(tx, user, postId);
      const [stats] = await tx
        .select({
          total: sql<number>`count(*)::int`,
          confirmed: sql<number>`count(*) filter(where ${effectiveStatus}='confirmed')::int`,
          pendingApproval: sql<number>`count(*) filter(where ${effectiveStatus}='pending_approval')::int`,
          pendingPayment: sql<number>`count(*) filter(where ${effectiveStatus}='pending_payment')::int`,
          review: sql<number>`count(*) filter(where ${effectiveStatus}='review')::int`,
          refunded: sql<number>`count(*) filter(where ${effectiveStatus}='refunded')::int`,
          cancelled: sql<number>`count(*) filter(where ${effectiveStatus} in ('cancelled','expired'))::int`,
          rejected: sql<number>`count(*) filter(where ${effectiveStatus}='rejected')::int`,
        })
        .from(eventApplications)
        .where(eq(eventApplications.postId, postId));
      const search = query.search
        ? or(
            ilike(eventApplications.attendeeName, `%${query.search}%`),
            ilike(eventApplications.contact, `%${query.search}%`),
            ilike(eventApplications.externalReference, `%${query.search}%`),
          )
        : undefined;
      const rows = await tx
        .select(helpers.appProjection)
        .from(eventApplications)
        .innerJoin(posts, eq(posts.id, eventApplications.postId))
        .leftJoin(paymentOrders, eq(paymentOrders.applicationId, eventApplications.id))
        .where(
          and(
            eq(eventApplications.postId, postId),
            query.status !== "all" ? sql`${effectiveStatus}=${query.status}` : undefined,
            search,
            before
              ? sql`(${eventApplications.createdAt},${eventApplications.id})<(${before.at}::timestamptz,${before.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(eventApplications.createdAt), desc(eventApplications.id))
        .limit(31);
      return {
        stats: stats!,
        attendees: rows.slice(0, 30).map(helpers.applicationView),
        nextCursor: rows.length > 30 ? encodeCursor(scope, rows[29]!) : null,
      };
    });
    return { event: await helpers.overview(actor, postId), ...data };
  }
  async function managedEvents(actor: string | null, cursor?: string | null) {
    const user = requireActor(actor),
      scope = pageScope(["managed-events", user]),
      before = decodeCursor(cursor ?? undefined, scope);
    const rows = await db
      .select({
        postId: posts.id,
        id: posts.id,
        title: posts.title,
        createdAt: preciseTimestamp(posts.createdAt),
        external: sql<boolean>`${posts.applicationUrl} is not null`,
        configured: sql<boolean>`${eventSettings.postId} is not null`,
        completedAt: eventSettings.completedAt,
        endsAt: eventSettings.endsAt,
        recordStatus: sql<
          "draft" | "published" | "withdrawn" | null
        >`(select status from sliper.event_records r where r.post_id=${posts.id})`,
        capacity: eventSettings.capacity,
        open: sql<boolean>`coalesce(${eventSettings.open},false)`,
        confirmed: sql<number>`(select count(*)::int from sliper.event_applications a where a.post_id=${posts.id} and a.status='confirmed')`,
        pendingApproval: sql<number>`(select count(*)::int from sliper.event_applications a where a.post_id=${posts.id} and a.status='pending_approval')`,
        pendingPayment: sql<number>`(select count(*)::int from sliper.event_applications a where a.post_id=${posts.id} and a.status='pending_payment' and a.expires_at>statement_timestamp())`,
        review: sql<number>`(select count(*)::int from sliper.event_applications a where a.post_id=${posts.id} and a.status='review')`,
        refunded: sql<number>`(select count(*)::int from sliper.event_applications a where a.post_id=${posts.id} and a.status='refunded')`,
      })
      .from(posts)
      .leftJoin(eventSettings, eq(eventSettings.postId, posts.id))
      .where(
        and(
          eq(posts.kind, "모집"),
          eq(posts.status, "published"),
          sql`(${posts.authorId}=${user} or exists(select 1 from sliper.room_managers m where m.post_id=${posts.id} and m.user_id=${user}))`,
          before
            ? sql`(${posts.createdAt},${posts.id})<(${before.at}::timestamptz,${before.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(31);
    return {
      items: rows
        .slice(0, 30)
        .map(({ id: _id, createdAt: _at, completedAt, endsAt, ...row }): ManagedEvent => ({
          ...row,
          completedAt: completedAt?.toISOString() ?? null,
          endsAt: endsAt?.toISOString() ?? null,
        })),
      nextCursor:
        rows.length > 30
          ? encodeCursor(scope, { id: rows[29]!.id, createdAt: rows[29]!.createdAt })
          : null,
    };
  }
  return { claimExternal, decideExternal, externalPayment, dashboard, managedEvents };
}
