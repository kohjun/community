import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/connection";
import { eventApplications, externalReceipts, paymentOrders } from "../db/schema";
import { paymentReviews } from "../db/event-operations-schema";
import type { PaymentIssue, PaymentReconciliation } from "../domain/event-operations";
import { eventOperationsService } from "./event-operations-service";
import { AppError, requireActor } from "./errors";
import { enforceRequestLimit } from "./request-limits";
const paymentState = sql<string>`case when ${eventApplications.source}='external' then coalesce(${externalReceipts.state},'unverified') else coalesce(${paymentOrders.state},'unverified') end`;
const paymentAmount = sql<
  number | null
>`case when ${eventApplications.source}='external' then ${externalReceipts.amountKRW} else ${paymentOrders.amountKRW} end`;
const pendingRefund = sql<
  number | null
>`(select r.refundable_krw from sliper.refund_requests r where r.application_id=${eventApplications.id} and r.state='pending' limit 1)`;
const exception = sql`((${paymentState}='paid' and ${eventApplications.status}<>'confirmed') or (${eventApplications.status}='confirmed' and (${eventApplications.amountKRW}>0 or ${eventApplications.source}='external') and ${paymentState}<>'paid') or (${paymentState}='refunded' and ${eventApplications.status}<>'refunded') or (${paymentAmount} is not null and ${paymentAmount}<>${eventApplications.amountKRW}) or ${pendingRefund} is not null)`;
export function paymentReconciliationService(db: Database) {
  const ops = eventOperationsService(db);
  async function load(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    postId: string,
    applicationId?: string,
    page = 1,
  ): Promise<PaymentIssue[]> {
    const rows = await tx
      .select({
        applicationId: eventApplications.id,
        attendeeName: eventApplications.attendeeName,
        applicationStatus: eventApplications.status,
        source: eventApplications.source,
        amountKRW: eventApplications.amountKRW,
        paymentState,
        paymentAmount,
        pendingRefundKRW: pendingRefund,
        pendingRefundId: sql<
          string | null
        >`(select r.id::text from sliper.refund_requests r where r.application_id=${eventApplications.id} and r.state='pending' limit 1)`,
        provider: sql<
          string | null
        >`case when ${eventApplications.source}='external' then ${externalReceipts.provider} else ${paymentOrders.provider} end`,
        reference: sql<
          string | null
        >`case when ${eventApplications.source}='external' then ${externalReceipts.reference} else ${paymentOrders.paymentId} end`,
        appRevision: eventApplications.updatedAt,
        paymentRevision: sql<
          string | null
        >`case when ${eventApplications.source}='external' then ${externalReceipts.updatedAt}::text else ${paymentOrders.updatedAt}::text end`,
      })
      .from(eventApplications)
      .leftJoin(paymentOrders, eq(paymentOrders.applicationId, eventApplications.id))
      .leftJoin(externalReceipts, eq(externalReceipts.applicationId, eventApplications.id))
      .where(
        and(
          eq(eventApplications.postId, postId),
          exception,
          applicationId ? eq(eventApplications.id, applicationId) : undefined,
        ),
      )
      .orderBy(desc(eventApplications.createdAt), desc(eventApplications.id))
      .limit(applicationId ? 1 : 21)
      .offset(applicationId ? 0 : (page - 1) * 20);
    const notes = rows.length
      ? await tx
          .select({
            applicationId: paymentReviews.applicationId,
            note: paymentReviews.note,
            createdAt: paymentReviews.createdAt,
            fingerprint: paymentReviews.fingerprint,
          })
          .from(paymentReviews)
          .where(
            inArray(
              paymentReviews.applicationId,
              rows.map((r) => r.applicationId),
            ),
          )
          .orderBy(desc(paymentReviews.createdAt))
      : [];
    return rows.map((row) => {
      const issues: PaymentIssue["issues"] = [];
      if (row.paymentState === "paid" && row.applicationStatus !== "confirmed")
        issues.push("paid_unconfirmed");
      if (
        row.applicationStatus === "confirmed" &&
        (row.amountKRW > 0 || row.source === "external") &&
        row.paymentState !== "paid"
      )
        issues.push("confirmed_unpaid");
      if (row.paymentState === "refunded" && row.applicationStatus !== "refunded")
        issues.push("refunded_active");
      if (row.paymentAmount !== null && row.paymentAmount !== row.amountKRW)
        issues.push("amount_mismatch");
      if (row.pendingRefundKRW !== null) issues.push("refund_pending");
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify([
            row.applicationId,
            row.applicationStatus,
            row.paymentState,
            row.paymentAmount,
            row.amountKRW,
            row.pendingRefundKRW,
            row.pendingRefundId,
            row.appRevision.toISOString(),
            row.paymentRevision,
          ]),
        )
        .digest("hex");
      return {
        applicationId: row.applicationId,
        attendeeName: row.attendeeName,
        applicationStatus: row.applicationStatus,
        source: row.source,
        amountKRW: row.amountKRW,
        paymentState: row.paymentState,
        provider: row.provider,
        reference: row.reference,
        pendingRefundKRW: row.pendingRefundKRW,
        issues,
        fingerprint,
        notes: notes
          .filter((n) => n.applicationId === row.applicationId && n.fingerprint === fingerprint)
          .slice(0, 5)
          .map((n) => ({ note: n.note, createdAt: n.createdAt.toISOString() })),
      };
    });
  }
  async function overview(
    actor: string | null,
    postId: string,
    page = 1,
  ): Promise<PaymentReconciliation> {
    const user = requireActor(actor);
    return db.transaction(async (tx) => {
      const { post } = await ops.lock(tx, user, postId, true);
      const rows = await load(tx, postId, undefined, page);
      return {
        postId,
        title: post.title,
        items: rows.slice(0, 20),
        page,
        hasMore: rows.length > 20,
      };
    });
  }
  async function note(actor: string | null, postId: string, input: unknown) {
    const user = requireActor(actor),
      value = z
        .strictObject({
          applicationId: z.uuid(),
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          note: z.string().trim().min(5).max(1000),
        })
        .parse(input);
    await enforceRequestLimit(db, user, "payment_review", 120);
    await db.transaction(async (tx) => {
      await ops.lock(tx, user, postId, true);
      const [current] = await load(tx, postId, value.applicationId);
      if (!current || current.fingerprint !== value.fingerprint)
        throw new AppError(
          "CONFLICT",
          "결제·참가 상태가 바뀌었어요. 최신 내역을 확인한 뒤 기록해주세요.",
        );
      await tx.insert(paymentReviews).values({ ...value, reviewedBy: user });
    });
    return { recorded: true };
  }
  return { overview, note };
}
