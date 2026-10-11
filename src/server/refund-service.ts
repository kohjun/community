import { and, eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/connection";
import {
  eventApplications,
  eventSettings,
  externalReceipts,
  paymentOrders,
  posts,
  refundRequests,
  roomManagers,
} from "../db/schema";
import {
  refundQuote,
  refundRequestSchema,
  refundResolutionSchema,
  type RefundView,
  type RefundRequestView,
} from "../domain/refund";
import { AppError, requireActor } from "./errors";
import { hostRefundCause } from "./event-lifecycle-service";
import type { RefundCause } from "../domain/event-lifecycle";
import { decodeCursor, encodeCursor, pageScope, preciseTimestamp } from "./pagination";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export function refundService(db: Database) {
  async function lock(tx: Tx, postId: string, user: string, manage: boolean) {
    const [post] = await tx
      .select()
      .from(posts)
      .where(eq(posts.id, z.uuid().parse(postId)))
      .for("update");
    if (!post || post.kind !== "모집" || post.status !== "published")
      throw new AppError("NOT_FOUND", "행사를 찾을 수 없어요.");
    if (manage) {
      const [staff] = await tx
        .select({ id: roomManagers.userId })
        .from(roomManagers)
        .where(and(eq(roomManagers.postId, postId), eq(roomManagers.userId, user)));
      if (post.authorId !== user && !staff)
        throw new AppError("FORBIDDEN", "행사 담당자만 환불 요청을 확인할 수 있어요.");
    }
    return post;
  }
  const projection = {
    id: refundRequests.id,
    applicationId: refundRequests.applicationId,
    attendeeName: eventApplications.attendeeName,
    cause: refundRequests.cause,
    amountKRW: refundRequests.amountKRW,
    rate: refundRequests.rate,
    refundableKRW: refundRequests.refundableKRW,
    reason: refundRequests.reason,
    state: refundRequests.state,
    actualRefundKRW: refundRequests.actualRefundKRW,
    decisionNote: refundRequests.decisionNote,
    requestedAt: preciseTimestamp(refundRequests.requestedAt),
    processedAt: refundRequests.processedAt,
  };
  function view(row: {
    id: string;
    applicationId: string;
    attendeeName: string;
    cause: string;
    amountKRW: number;
    rate: number;
    refundableKRW: number;
    reason: string;
    state: string;
    actualRefundKRW: number | null;
    decisionNote: string;
    requestedAt: string;
    processedAt: Date | null;
  }): RefundRequestView {
    return {
      ...row,
      state: row.state as RefundRequestView["state"],
      cause: row.cause as RefundCause,
      processedAt: row.processedAt?.toISOString() ?? null,
    };
  }
  async function overview(
    actor: string | null,
    postId: string,
    manage = false,
    cursor?: string | null,
  ): Promise<RefundView> {
    const user = requireActor(actor),
      scope = pageScope(["refunds", user, postId, manage ? "manage" : "mine"]),
      before = decodeCursor(cursor ?? undefined, scope);
    return db.transaction(async (tx) => {
      await lock(tx, postId, user, manage);
      const [settings] = await tx
        .select()
        .from(eventSettings)
        .where(eq(eventSettings.postId, postId));
      const [app] = await tx
        .select()
        .from(eventApplications)
        .where(and(eq(eventApplications.postId, postId), eq(eventApplications.userId, user)))
        .orderBy(
          sql`case when status='confirmed' then 0 else 1 end`,
          desc(eventApplications.createdAt),
          desc(eventApplications.id),
        )
        .limit(1);
      const rows = await tx
        .select(projection)
        .from(refundRequests)
        .innerJoin(eventApplications, eq(eventApplications.id, refundRequests.applicationId))
        .where(
          and(
            eq(refundRequests.postId, postId),
            manage ? undefined : eq(refundRequests.userId, user),
            before
              ? sql`(${refundRequests.requestedAt},${refundRequests.id})<(${before.at}::timestamptz,${before.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(refundRequests.requestedAt), desc(refundRequests.id))
        .limit(31);
      const [pending] = app
        ? await tx
            .select({ id: refundRequests.id })
            .from(refundRequests)
            .where(
              and(eq(refundRequests.applicationId, app.id), eq(refundRequests.state, "pending")),
            )
        : [];
      const starts = app?.eventStartsAt ?? settings?.startsAt ?? null;
      const cause = app ? await hostRefundCause(tx, app) : "participant";
      const [paid] = app
        ? await tx
            .select({ id: eventApplications.id })
            .from(eventApplications)
            .where(
              and(
                eq(eventApplications.id, app.id),
                sql`(exists(select 1 from sliper.payment_orders p where p.application_id=${app.id} and p.state='paid' and p.amount_krw=${app.amountKRW}) or exists(select 1 from sliper.external_receipts r where r.application_id=${app.id} and r.state='paid' and r.amount_krw=${app.amountKRW}))`,
              ),
            )
        : [];
      const quote =
        app && (starts || cause !== "participant")
          ? refundQuote(app.amountKRW, starts ?? new Date())
          : null;
      return {
        startsAt: starts?.toISOString() ?? null,
        policyVersion: app?.refundPolicy ?? settings?.refundPolicy ?? "sliper-v1",
        cause,
        quote:
          quote && app
            ? cause === "participant"
              ? quote
              : { ...quote, rate: 100, refundableKRW: app.amountKRW, retainedKRW: 0 }
            : null,
        applicationId: app?.id ?? null,
        canRequest:
          !!app &&
          (app.status === "confirmed" ||
            (cause !== "participant" && app.status === "review" && !!paid)) &&
          app.amountKRW > 0 &&
          (!!app.eventStartsAt || cause !== "participant") &&
          !pending,
        requests: rows.slice(0, 30).map(view),
        nextCursor:
          rows.length > 30
            ? encodeCursor(scope, { id: rows[29]!.id, createdAt: rows[29]!.requestedAt })
            : null,
      };
    });
  }
  async function request(actor: string | null, postId: string, input: unknown) {
    const user = requireActor(actor),
      value = refundRequestSchema.parse(input);
    await db.transaction(async (tx) => {
      await lock(tx, postId, user, false);
      const [app] = await tx
        .select()
        .from(eventApplications)
        .where(
          and(
            eq(eventApplications.id, value.applicationId),
            eq(eventApplications.postId, postId),
            eq(eventApplications.userId, user),
          ),
        );
      if (!app) throw new AppError("NOT_FOUND", "본인의 참가 내역을 찾을 수 없어요.");
      const [existing] = await tx
        .select({ id: refundRequests.id })
        .from(refundRequests)
        .where(and(eq(refundRequests.applicationId, app.id), eq(refundRequests.state, "pending")));
      if (existing) return;
      const cause = await hostRefundCause(tx, app);
      if (
        (app.status !== "confirmed" && !(cause !== "participant" && app.status === "review")) ||
        app.amountKRW === 0
      )
        throw new AppError(
          "CONFLICT",
          "결제가 확인된 유료 참가 내역만 취소·환불 요청할 수 있어요.",
        );
      if (!app.eventStartsAt && cause === "participant")
        throw new AppError(
          "CONFLICT",
          "신청 당시 행사 시작일이 지정되지 않았어요. 담당자에게 환불 기준을 문의해주세요.",
        );
      const quote = refundQuote(app.amountKRW, app.eventStartsAt ?? new Date());
      await tx.insert(refundRequests).values({
        applicationId: app.id,
        postId,
        userId: user,
        policyVersion: app.refundPolicy,
        eventStartsAt: app.eventStartsAt ?? new Date(),
        amountKRW: app.amountKRW,
        cause,
        rate: cause === "participant" ? quote.rate : 100,
        refundableKRW: cause === "participant" ? quote.refundableKRW : app.amountKRW,
        reason: value.reason,
      });
    });
    return overview(actor, postId);
  }
  async function resolve(actor: string | null, requestId: string, input: unknown) {
    const user = requireActor(actor),
      value = refundResolutionSchema.parse(input);
    const [lookup] = await db
      .select({ postId: refundRequests.postId })
      .from(refundRequests)
      .where(eq(refundRequests.id, z.uuid().parse(requestId)));
    if (!lookup) throw new AppError("NOT_FOUND", "환불 요청을 찾을 수 없어요.");
    await db.transaction(async (tx) => {
      await lock(tx, lookup.postId, user, true);
      const [req] = await tx.select().from(refundRequests).where(eq(refundRequests.id, requestId));
      if (req!.state === "completed" && value.decision === "complete") {
        if (req!.actualRefundKRW !== value.actualRefundKRW)
          throw new AppError("CONFLICT", "이미 확인한 실제 환불 금액이 달라요.");
        return;
      }
      if (req!.state !== "pending") throw new AppError("CONFLICT", "처리가 끝난 요청이에요.");
      const [app] = await tx
        .select()
        .from(eventApplications)
        .where(eq(eventApplications.id, req!.applicationId));
      if (
        app!.status !== "confirmed" &&
        !(req!.cause !== "participant" && app!.status === "review")
      )
        throw new AppError("CONFLICT", "현재 참가 상태를 새로 확인해주세요.");
      if (value.decision === "complete") {
        if (value.actualRefundKRW !== req!.refundableKRW)
          throw new AppError(
            "VALIDATION",
            "외부 플랫폼에서 처리한 금액이 요청 시점의 환불 금액과 일치해야 해요.",
          );
        if (app!.source === "external") {
          const [receipt] = await tx
            .select()
            .from(externalReceipts)
            .where(eq(externalReceipts.applicationId, app!.id));
          if (!receipt || receipt.state !== "paid")
            throw new AppError("CONFLICT", "외부 결제 확인 내역이 없어요.");
          await tx
            .update(externalReceipts)
            .set({
              state: "refunded",
              refundedAmountKRW: value.actualRefundKRW!,
              updatedAt: sql`statement_timestamp()`,
            })
            .where(eq(externalReceipts.applicationId, app!.id));
        } else {
          const [order] = await tx
            .select()
            .from(paymentOrders)
            .where(eq(paymentOrders.applicationId, app!.id));
          if (!order || order.state !== "paid")
            throw new AppError("CONFLICT", "결제된 주문이 없어요.");
          await tx
            .update(paymentOrders)
            .set({
              state: "refunded",
              refundedAmountKRW: value.actualRefundKRW!,
              updatedAt: sql`statement_timestamp()`,
            })
            .where(eq(paymentOrders.id, order.id));
        }
        await tx
          .update(eventApplications)
          .set({
            status: "refunded",
            decisionNote: value.reason,
            updatedAt: sql`statement_timestamp()`,
          })
          .where(eq(eventApplications.id, app!.id));
      }
      await tx
        .update(refundRequests)
        .set({
          state: value.decision === "complete" ? "completed" : "rejected",
          actualRefundKRW: value.decision === "complete" ? value.actualRefundKRW! : null,
          processedBy: user,
          decisionNote: value.reason,
          processedAt: sql`statement_timestamp()`,
        })
        .where(eq(refundRequests.id, requestId));
    });
    return { postId: lookup.postId };
  }
  return { overview, request, resolve };
}
