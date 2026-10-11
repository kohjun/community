import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/connection";
import { profiles } from "../db/schema";
import {
  libraryEntries,
  libraryVersions,
  libraryAccessRequests,
  libraryPurchases,
  libraryPurchaseAudit,
  libraryPurchaseDisputes,
  libraryWebhookReceipts,
} from "../db/library-schema";
import {
  purchaseRequestSchema,
  purchaseQuerySchema,
  purchaseDecisionSchema,
  disputeInputSchema,
  disputeResponseSchema,
  disputeResolutionSchema,
  disputeWithdrawSchema,
  purchaseWebhookSchema,
  type PurchaseSnapshot,
  type PurchaseSummary,
  type PurchaseDetail,
  type PurchasePage,
  type PurchaseDispute,
  type PurchaseStatus,
} from "../domain/library-market";
import { uuidSchema } from "../domain/validation";
import { requireRecordMember } from "./record-policy";
import { safetyService } from "./safety-service";
import { libraryService } from "./library-service";
import { preciseTimestamp } from "./pagination";
import { enforceRequestLimit } from "./request-limits";
import { AppError } from "./errors";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Purchase = typeof libraryPurchases.$inferSelect;
const connection = (tx: Tx) => tx as unknown as Database;
const advance = () =>
  sql`greatest(clock_timestamp(),${libraryPurchases.updatedAt}+interval '1 microsecond')`;
const advanceDispute = () =>
  sql`greatest(clock_timestamp(),${libraryPurchaseDisputes.updatedAt}+interval '1 microsecond')`;
function conflict(error: unknown): never {
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
  if (cause && typeof cause === "object" && "code" in cause && cause.code === "23505")
    throw new AppError("CONFLICT", "이미 등록된 주문·결제 또는 처리 중인 요청이에요.");
  throw error;
}
export function libraryMarketService(db: Database) {
  async function member(actor: string | null) {
    const user = await requireRecordMember(db, actor);
    return { user, staff: !!(await safetyService(db).role(user)) };
  }
  function authorize(purchase: Purchase, user: string, staff: boolean) {
    if (purchase.buyerId !== user && purchase.sellerId !== user && !staff)
      throw new AppError("NOT_FOUND", "구매 내역을 찾을 수 없어요.");
  }
  // Consistent lock order: source entry, purchase, dispute. Hidden sources still retain private financial evidence.
  async function locked(tx: Tx, id: string) {
    const [key] = await tx
      .select({ entryId: libraryPurchases.entryId })
      .from(libraryPurchases)
      .where(eq(libraryPurchases.id, uuidSchema.parse(id)));
    if (!key) throw new AppError("NOT_FOUND", "구매 내역을 찾을 수 없어요.");
    await tx
      .select({ id: libraryEntries.id })
      .from(libraryEntries)
      .where(eq(libraryEntries.id, key.entryId))
      .for("update");
    const [row] = await tx
      .select({ purchase: libraryPurchases, at: preciseTimestamp(libraryPurchases.updatedAt) })
      .from(libraryPurchases)
      .where(eq(libraryPurchases.id, id))
      .for("update");
    if (!row) throw new AppError("NOT_FOUND", "구매 내역을 찾을 수 없어요.");
    return row;
  }
  function rows(tx: Tx, condition?: ReturnType<typeof and>) {
    return tx
      .select({
        purchase: libraryPurchases,
        at: preciseTimestamp(libraryPurchases.updatedAt),
        buyer: sql<string>`coalesce((select nickname from sliper.profiles b where b.id=${libraryPurchases.buyerId}), '탈퇴한 회원')`,
        seller: sql<string>`coalesce((select nickname from sliper.profiles s where s.id=${libraryPurchases.sellerId}), '탈퇴한 회원')`,
        openDisputes: sql<number>`(select count(*)::int from sliper.library_purchase_disputes d where d.purchase_id=sliper.library_purchases.id and d.status='open')`,
      })
      .from(libraryPurchases)
      .where(condition);
  }
  type Row = Awaited<ReturnType<typeof rows>>[number];
  function summary(row: Row, user: string): PurchaseSummary {
    const p = row.purchase;
    return {
      id: p.id,
      entryId: p.entryId,
      snapshot: p.snapshot,
      externalReference: p.externalReference,
      note: p.note,
      amountKRW: p.amountKRW,
      status: p.status as PurchaseStatus,
      buyer: row.buyer,
      seller: row.seller,
      isBuyer: p.buyerId === user,
      isSeller: p.sellerId === user,
      createdAt: p.createdAt.toISOString(),
      updatedAt: row.at,
      openDisputes: Number(row.openDisputes),
    };
  }
  async function audit(tx: Tx, p: Purchase, actor: string | null, action: string, note: string) {
    await tx
      .insert(libraryPurchaseAudit)
      .values({ purchaseId: p.id, actorId: actor, action, note });
  }
  async function grant(tx: Tx, p: Purchase, status: PurchaseStatus, note: string) {
    if (!p.buyerId) return;
    const [prior] = await tx
      .select()
      .from(libraryAccessRequests)
      .where(
        and(
          eq(libraryAccessRequests.entryId, p.entryId),
          eq(libraryAccessRequests.userId, p.buyerId),
        ),
      )
      .for("update");
    // An old order must never revoke or replace a newer purchase's entitlement.
    if (prior && prior.externalReference !== p.externalReference) {
      if (status === "paid" || status === "pending")
        throw new AppError("CONFLICT", "다른 구매 내역의 열람 권한이 있어요. 먼저 확인해주세요.");
      return;
    }
    const accessStatus =
      status === "paid"
        ? "approved"
        : status === "pending"
          ? "pending"
          : status === "rejected"
            ? "rejected"
            : "revoked";
    await tx
      .insert(libraryAccessRequests)
      .values({
        entryId: p.entryId,
        userId: p.buyerId,
        externalReference: p.externalReference,
        amountKRW: p.amountKRW,
        note: p.note,
        decisionNote: note,
        status: accessStatus,
      })
      .onConflictDoUpdate({
        target: [libraryAccessRequests.entryId, libraryAccessRequests.userId],
        set: {
          status: accessStatus,
          decisionNote: note,
          updatedAt: sql`greatest(clock_timestamp(),${libraryAccessRequests.updatedAt}+interval '1 microsecond')`,
        },
      });
  }
  async function transition(
    tx: Tx,
    p: Purchase,
    status: PurchaseStatus,
    actor: string | null,
    action: string,
    note: string,
    payment?: { provider: string; paymentId: string },
  ) {
    await tx
      .update(libraryPurchases)
      .set({ status, updatedAt: advance(), ...(payment ?? {}) })
      .where(eq(libraryPurchases.id, p.id));
    await grant(tx, p, status, note);
    await audit(tx, p, actor, action, note);
  }
  async function detail(actor: string | null, id: string): Promise<PurchaseDetail> {
    const { user, staff } = await member(actor);
    uuidSchema.parse(id);
    return db.transaction(async (tx) => {
      const [row] = await rows(tx, eq(libraryPurchases.id, id));
      if (!row) throw new AppError("NOT_FOUND", "구매 내역을 찾을 수 없어요.");
      const p = row.purchase;
      authorize(p, user, staff);
      const history = await tx
        .select({
          id: libraryPurchaseAudit.id,
          action: libraryPurchaseAudit.action,
          note: libraryPurchaseAudit.note,
          actor: profiles.nickname,
          createdAt: libraryPurchaseAudit.createdAt,
        })
        .from(libraryPurchaseAudit)
        .leftJoin(profiles, eq(profiles.id, libraryPurchaseAudit.actorId))
        .where(eq(libraryPurchaseAudit.purchaseId, id))
        .orderBy(desc(libraryPurchaseAudit.createdAt), desc(libraryPurchaseAudit.id))
        .limit(50);
      const disputes = await tx
        .select({
          row: libraryPurchaseDisputes,
          at: preciseTimestamp(libraryPurchaseDisputes.updatedAt),
        })
        .from(libraryPurchaseDisputes)
        .where(eq(libraryPurchaseDisputes.purchaseId, id))
        .orderBy(desc(libraryPurchaseDisputes.createdAt), desc(libraryPurchaseDisputes.id))
        .limit(20);
      return {
        ...summary(row, user),
        provider: p.provider,
        paymentId: p.paymentId,
        audit: history.map((a) => ({
          ...a,
          actor: a.actor ?? "외부 플랫폼",
          createdAt: a.createdAt.toISOString(),
        })),
        disputes: disputes.map((d) => ({
          id: d.row.id,
          kind: d.row.kind as PurchaseDispute["kind"],
          body: d.row.body,
          sellerResponse: d.row.sellerResponse,
          status: d.row.status as PurchaseDispute["status"],
          outcome: d.row.outcome as PurchaseDispute["outcome"],
          resolutionNote: d.row.resolutionNote,
          createdAt: d.row.createdAt.toISOString(),
          updatedAt: d.at,
          canRespond: p.sellerId === user && d.row.status === "open" && !d.row.sellerResponse,
          canResolve: staff && p.buyerId !== user && p.sellerId !== user && d.row.status === "open",
          canWithdraw: d.row.requesterId === user && d.row.status === "open",
        })),
        canDecide: p.sellerId === user && p.status !== "refunded",
        canOpenDispute: p.buyerId === user && !Number(row.openDisputes),
        canReviewDisputes: staff,
      };
    });
  }
  async function list(actor: string | null, input: unknown = {}): Promise<PurchasePage> {
    const { user, staff } = await member(actor),
      q = purchaseQuerySchema.parse(input);
    if (q.scope === "disputes" && !staff)
      throw new AppError("FORBIDDEN", "운영자만 분쟁 접수 목록을 볼 수 있어요.");
    return db.transaction(async (tx) => {
      const condition =
        q.scope === "buying"
          ? eq(libraryPurchases.buyerId, user)
          : q.scope === "selling"
            ? eq(libraryPurchases.sellerId, user)
            : sql`exists(select 1 from sliper.library_purchase_disputes d where d.purchase_id=sliper.library_purchases.id and d.status='open')`;
      const found = await rows(tx, condition)
        .orderBy(desc(libraryPurchases.createdAt), desc(libraryPurchases.id))
        .limit(20)
        .offset((q.page - 1) * 20);
      const [count] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(libraryPurchases)
        .where(condition);
      const total = Number(count?.total ?? 0);
      return {
        items: found.map((r) => summary(r, user)),
        total,
        page: q.page,
        pageCount: Math.max(1, Math.ceil(total / 20)),
        canReviewDisputes: staff,
      };
    });
  }
  async function request(actor: string | null, id: string, input: unknown) {
    const { user } = await member(actor),
      v = purchaseRequestSchema.parse(input);
    uuidSchema.parse(id);
    await enforceRequestLimit(db, user, "library_order", 10);
    let purchaseId: string;
    try {
      purchaseId = await db.transaction(async (tx) => {
        const source = await libraryService(connection(tx)).detail(user, id);
        if (source.status !== "published" || source.isMine || source.priceKRW <= 0)
          throw new AppError("VALIDATION", "발행된 유료 자료의 구매 내역만 제출할 수 있어요.");
        if (source.publishedVersion !== v.version)
          throw new AppError("CONFLICT", "최신 버전의 이용 조건을 확인해주세요.");
        const [entry] = await tx
          .select({ owner: libraryEntries.ownerId })
          .from(libraryEntries)
          .where(eq(libraryEntries.id, id))
          .for("update");
        const [version] = await tx
          .select()
          .from(libraryVersions)
          .where(and(eq(libraryVersions.entryId, id), eq(libraryVersions.number, v.version)));
        if (!entry?.owner || !version)
          throw new AppError("NOT_FOUND", "자료 버전을 찾을 수 없어요.");
        const [access] = await tx
          .select()
          .from(libraryAccessRequests)
          .where(
            and(eq(libraryAccessRequests.entryId, id), eq(libraryAccessRequests.userId, user)),
          );
        if (access && (access.status === "pending" || access.status === "approved"))
          throw new AppError("CONFLICT", "이미 요청 중이거나 구매한 자료예요.");
        const [active] = await tx
          .select({ id: libraryPurchases.id })
          .from(libraryPurchases)
          .where(
            and(
              eq(libraryPurchases.entryId, id),
              eq(libraryPurchases.buyerId, user),
              sql`${libraryPurchases.status} in ('pending','paid')`,
            ),
          );
        if (active) throw new AppError("CONFLICT", "이미 처리 중이거나 결제 완료한 주문이에요.");
        const c = version.content;
        if (c.priceKRW <= 0 || !c.purchaseUrl)
          throw new AppError("CONFLICT", "유료 배포 정보를 다시 확인해주세요.");
        const snapshot: PurchaseSnapshot = {
          title: c.title,
          versionNumber: version.number,
          priceKRW: c.priceKRW,
          usageTerms: c.usageTerms,
          allowDerivatives: c.allowDerivatives,
          allowCommercialUse: c.allowCommercialUse,
          purchaseUrl: c.purchaseUrl,
        };
        const [p] = await tx
          .insert(libraryPurchases)
          .values({
            entryId: id,
            versionId: version.id,
            buyerId: user,
            sellerId: entry.owner,
            snapshot,
            externalReference: v.externalReference,
            note: v.note,
            amountKRW: c.priceKRW,
          })
          .returning();
        // A closed legacy row may be replaced for a genuinely new order; active rows were rejected above.
        if (access)
          await tx
            .delete(libraryAccessRequests)
            .where(
              and(eq(libraryAccessRequests.entryId, id), eq(libraryAccessRequests.userId, user)),
            );
        await grant(tx, p!, "pending", "");
        await audit(
          tx,
          p!,
          user,
          "requested",
          "외부 구매 내역과 이용 조건을 확인하고 승인 요청을 제출했어요.",
        );
        return p!.id;
      });
    } catch (e) {
      conflict(e);
    }
    return detail(user, purchaseId);
  }
  async function decide(actor: string | null, id: string, input: unknown) {
    const { user } = await member(actor),
      v = purchaseDecisionSchema.parse(input);
    await db.transaction(async (tx) => {
      const { purchase: p, at } = await locked(tx, id);
      if (p.sellerId !== user)
        throw new AppError("FORBIDDEN", "판매자만 구매 내역을 처리할 수 있어요.");
      if (at !== v.expectedUpdatedAt)
        throw new AppError("CONFLICT", "구매 상태가 변경되었어요. 다시 확인해주세요.");
      const allowed =
        v.action === "approve" || v.action === "reject"
          ? p.status === "pending"
          : v.action === "revoke"
            ? p.status === "paid"
            : p.status !== "refunded";
      if (!allowed) throw new AppError("CONFLICT", "현재 구매 상태에서는 처리할 수 없어요.");
      const status =
        v.action === "approve"
          ? "paid"
          : v.action === "reject"
            ? "rejected"
            : v.action === "revoke"
              ? "revoked"
              : "refunded";
      await transition(tx, p, status, user, v.action, v.note);
    });
    return detail(user, id);
  }
  async function openDispute(actor: string | null, id: string, input: unknown) {
    const { user } = await member(actor),
      v = disputeInputSchema.parse(input);
    await enforceRequestLimit(db, user, "library_dispute", 5);
    try {
      await db.transaction(async (tx) => {
        const { purchase: p } = await locked(tx, id);
        if (p.buyerId !== user)
          throw new AppError("FORBIDDEN", "구매자만 해당 주문에 문의를 접수할 수 있어요.");
        const [open] = await tx
          .select({ id: libraryPurchaseDisputes.id })
          .from(libraryPurchaseDisputes)
          .where(
            and(
              eq(libraryPurchaseDisputes.purchaseId, id),
              eq(libraryPurchaseDisputes.status, "open"),
            ),
          );
        if (open) throw new AppError("CONFLICT", "처리 중인 문의가 있어요.");
        await tx
          .insert(libraryPurchaseDisputes)
          .values({ purchaseId: id, requesterId: user, kind: v.kind, body: v.body });
        await audit(tx, p, user, "dispute_opened", "구매 관련 문의가 접수되었어요.");
      });
    } catch (e) {
      conflict(e);
    }
    return detail(user, id);
  }
  async function dispute(tx: Tx, purchaseId: string, disputeId: string, expected: string) {
    const [d] = await tx
      .select({
        row: libraryPurchaseDisputes,
        at: preciseTimestamp(libraryPurchaseDisputes.updatedAt),
      })
      .from(libraryPurchaseDisputes)
      .where(
        and(
          eq(libraryPurchaseDisputes.id, uuidSchema.parse(disputeId)),
          eq(libraryPurchaseDisputes.purchaseId, purchaseId),
        ),
      )
      .for("update");
    if (!d) throw new AppError("NOT_FOUND", "문의 내역을 찾을 수 없어요.");
    if (d.at !== expected || d.row.status !== "open")
      throw new AppError("CONFLICT", "이미 처리되거나 변경된 문의예요.");
    return d.row;
  }
  async function respond(actor: string | null, id: string, disputeId: string, input: unknown) {
    const { user } = await member(actor),
      v = disputeResponseSchema.parse(input);
    await db.transaction(async (tx) => {
      const { purchase: p } = await locked(tx, id);
      if (p.sellerId !== user) throw new AppError("FORBIDDEN", "판매자만 문의에 답변할 수 있어요.");
      const d = await dispute(tx, id, disputeId, v.expectedUpdatedAt);
      if (d.sellerResponse) throw new AppError("CONFLICT", "이미 답변한 문의예요.");
      await tx
        .update(libraryPurchaseDisputes)
        .set({ sellerResponse: v.body, updatedAt: advanceDispute() })
        .where(eq(libraryPurchaseDisputes.id, disputeId));
      await audit(tx, p, user, "dispute_response", "판매자가 구매 문의에 답변했어요.");
    });
    return detail(user, id);
  }
  async function resolve(actor: string | null, id: string, disputeId: string, input: unknown) {
    const { user } = await member(actor),
      v = disputeResolutionSchema.parse(input);
    await safetyService(db).requireStaff(user);
    await db.transaction(async (tx) => {
      const { purchase: p } = await locked(tx, id);
      if (p.buyerId === user || p.sellerId === user)
        throw new AppError("FORBIDDEN", "본인 거래의 분쟁은 다른 운영자가 처리해야 해요.");
      await dispute(tx, id, disputeId, v.expectedUpdatedAt);
      if (v.outcome === "refund_confirmed" && p.status !== "refunded")
        await transition(tx, p, "refunded", user, "dispute_refund", v.note);
      else if (v.outcome === "revoke" && (p.status === "paid" || p.status === "pending"))
        await transition(tx, p, "revoked", user, "dispute_revoke", v.note);
      await tx
        .update(libraryPurchaseDisputes)
        .set({
          status: "resolved",
          outcome: v.outcome,
          resolutionNote: v.note,
          resolvedBy: user,
          resolvedAt: sql`clock_timestamp()`,
          updatedAt: advanceDispute(),
        })
        .where(eq(libraryPurchaseDisputes.id, disputeId));
      await audit(tx, p, user, "dispute_resolved", v.note);
    });
    return detail(user, id);
  }
  async function withdraw(actor: string | null, id: string, disputeId: string, input: unknown) {
    const { user } = await member(actor),
      v = disputeWithdrawSchema.parse(input);
    await db.transaction(async (tx) => {
      const { purchase: p } = await locked(tx, id);
      const d = await dispute(tx, id, disputeId, v.expectedUpdatedAt);
      if (d.requesterId !== user)
        throw new AppError("FORBIDDEN", "접수자만 문의를 철회할 수 있어요.");
      await tx
        .update(libraryPurchaseDisputes)
        .set({
          status: "withdrawn",
          resolvedBy: user,
          resolvedAt: sql`clock_timestamp()`,
          updatedAt: advanceDispute(),
        })
        .where(eq(libraryPurchaseDisputes.id, disputeId));
      await audit(tx, p, user, "dispute_withdrawn", "구매자가 문의를 철회했어요.");
    });
    return detail(user, id);
  }
  async function webhook(providerInput: string, input: unknown) {
    const provider = z
        .string()
        .trim()
        .min(1)
        .max(40)
        .regex(/^[a-zA-Z0-9_-]+$/)
        .parse(providerInput),
      v = purchaseWebhookSchema.parse(input);
    const payloadHash = createHash("sha256")
      .update(
        JSON.stringify([
          provider,
          v.eventId,
          v.purchaseId,
          v.paymentId,
          v.type,
          v.amountKRW,
          v.currency,
        ]),
      )
      .digest("hex");
    try {
      return await db.transaction(async (tx) => {
        const { purchase: p } = await locked(tx, v.purchaseId);
        const [receipt] = await tx
          .select()
          .from(libraryWebhookReceipts)
          .where(
            and(
              eq(libraryWebhookReceipts.provider, provider),
              eq(libraryWebhookReceipts.eventId, v.eventId),
            ),
          );
        if (receipt) {
          if (receipt.payloadHash !== payloadHash)
            throw new AppError("CONFLICT", "같은 이벤트 ID에 다른 결제 정보가 전달되었어요.");
          return {
            duplicate: true,
            status: receipt.status as PurchaseStatus,
            purchaseId: receipt.purchaseId,
          };
        }
        if (v.amountKRW !== p.amountKRW)
          throw new AppError("VALIDATION", "주문 금액과 외부 결제 금액이 다릅니다.");
        if ((p.provider && p.provider !== provider) || (p.paymentId && p.paymentId !== v.paymentId))
          throw new AppError("CONFLICT", "주문에 연결된 결제 정보와 다릅니다.");
        const [mapped] = await tx
          .select({ id: libraryPurchases.id })
          .from(libraryPurchases)
          .where(
            and(
              eq(libraryPurchases.provider, provider),
              eq(libraryPurchases.paymentId, v.paymentId),
            ),
          );
        if (mapped && mapped.id !== p.id)
          throw new AppError("CONFLICT", "이미 다른 주문에 연결된 결제예요.");
        const ignored = v.type === "paid" && p.status !== "pending" && p.status !== "paid";
        const status: PurchaseStatus =
          v.type === "refunded" ? "refunded" : ignored ? (p.status as PurchaseStatus) : "paid";
        if (p.status !== status || !p.paymentId)
          await transition(
            tx,
            p,
            status,
            null,
            ignored ? "webhook_ignored_paid" : `webhook_${v.type}`,
            ignored
              ? "종료된 구매의 결제 알림을 기록했으며 열람 권한은 복원하지 않았어요."
              : provider === "local-test"
                ? "실제 결제 없이 로컬 테스트 구매를 승인했어요."
                : v.type === "paid"
                  ? "외부 플랫폼에서 결제 완료를 확인했어요."
                  : "외부 플랫폼에서 전액 환불 완료를 확인했어요.",
            { provider, paymentId: v.paymentId },
          );
        if (ignored && p.paymentId)
          await audit(
            tx,
            p,
            null,
            "webhook_ignored_paid",
            "종료된 구매의 늦은 결제 알림을 기록했으며 열람 권한은 복원하지 않았어요.",
          );
        await tx
          .insert(libraryWebhookReceipts)
          .values({ provider, eventId: v.eventId, payloadHash, purchaseId: p.id, status });
        return { duplicate: false, status, purchaseId: p.id };
      });
    } catch (e) {
      conflict(e);
    }
  }
  return { request, list, detail, decide, openDispute, respond, resolve, withdraw, webhook };
}
