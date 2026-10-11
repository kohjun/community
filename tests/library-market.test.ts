import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq, and } from "drizzle-orm";
import * as schema from "../src/db/schema";
import {
  libraryEntries,
  libraryVersions,
  libraryAccessRequests,
  libraryPurchases,
  libraryWebhookReceipts,
  libraryPurchaseAudit,
  libraryPurchaseDisputes,
} from "../src/db/library-schema";
import {
  contentRestrictions,
  memberBlocks,
  memberSafety,
  staffRoles,
} from "../src/db/safety-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { libraryInputSchema, type LibraryDetail } from "../src/domain/library";
import {
  purchaseRequestSchema,
  purchaseDecisionSchema,
  purchaseWebhookSchema,
  disputeResolutionSchema,
  type PurchaseDetail,
} from "../src/domain/library-market";
import { libraryService } from "../src/server/library-service";
import { libraryMarketService } from "../src/server/library-market-service";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database;
const library = libraryService(connection),
  market = libraryMarketService(connection);
let seller: string, buyer: string, other: string, staff: string, entry: LibraryDetail;
const input = libraryInputSchema.parse({
  kind: "template",
  categorySlug: "knowledge",
  title: "구매 버전이 보존되는 게임 템플릿",
  summary: "외부 결제와 자료 이용 조건을 연결하는 테스트용 템플릿입니다.",
  scenario:
    "PRIVATE-MARKET-SCENARIO 참가자들이 서로 협력하며 주어진 단서를 통해 미션을 해결합니다.",
  rules: "PRIVATE-MARKET-RULE 각 팀이 공평한 시간 안에 동일한 단서를 찾아 문제를 해결합니다.",
  hostGuide: "PRIVATE-MARKET-HOST 진행자는 참가자의 안전을 확인하고 단계별 미션을 안내합니다.",
  materials: ["미션 카드"],
  rounds: [{ name: "미션", seconds: 300 }],
  tags: ["협업"],
  minPlayers: 2,
  maxPlayers: 10,
  durationMinutes: 60,
  priceKRW: 1000,
  purchaseUrl: "https://example.com/buy",
  usageTerms: "개인 행사에만 사용할 수 있습니다.",
  allowDerivatives: true,
  allowCommercialUse: false,
});
const code = (c: string) => (e: unknown) => e instanceof AppError && e.code === c;
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(schema.profiles).values({ id, nickname });
  return id;
}
async function order(ref = `ORDER-${randomUUID()}`) {
  return market.request(buyer, entry.id, {
    version: 1,
    externalReference: ref,
    note: "PRIVATE-ORDER-NOTE",
    consent: true,
  });
}
function event(
  p: PurchaseDetail,
  type: "paid" | "refunded" = "paid",
  eventId = randomUUID(),
  paymentId = "payment-one",
) {
  return { eventId, purchaseId: p.id, paymentId, type, amountKRW: 1000, currency: "KRW" as const };
}
async function decision(
  p: PurchaseDetail,
  action: "approve" | "reject" | "revoke" | "refund",
  user = seller,
) {
  return market.decide(user, p.id, {
    action,
    expectedUpdatedAt: p.updatedAt,
    note: "외부 플랫폼 내역 확인",
    paymentChecked: true,
  });
}
async function access() {
  return (
    await db
      .select()
      .from(libraryAccessRequests)
      .where(
        and(eq(libraryAccessRequests.entryId, entry.id), eq(libraryAccessRequests.userId, buyer)),
      )
  )[0]!;
}
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade");
  seller = await member("판매 작성자");
  buyer = await member("구매 회원");
  other = await member("다른 회원");
  staff = await member("분쟁 담당자");
  await db.insert(staffRoles).values({ userId: staff, role: "moderator" });
  entry = await library.create(seller, input);
});
after(() => pg.close());
test("strict purchase schemas reject protected identity, amount, arbitrary status and unconfirmed payment/refund", () => {
  const request = { version: 1, externalReference: "ORDER-001", consent: true };
  assert.equal(purchaseRequestSchema.safeParse({ ...request, amountKRW: 1 }).success, false);
  assert.equal(purchaseRequestSchema.safeParse({ ...request, buyerId: buyer }).success, false);
  assert.equal(purchaseRequestSchema.safeParse({ ...request, status: "paid" }).success, false);
  const d = {
    action: "approve",
    expectedUpdatedAt: new Date().toISOString(),
    note: "승인 확인",
    paymentChecked: false,
  };
  assert.equal(purchaseDecisionSchema.safeParse(d).success, false);
  assert.equal(purchaseDecisionSchema.safeParse({ ...d, action: "refund" }).success, false);
  assert.equal(
    disputeResolutionSchema.safeParse({ ...d, action: undefined, outcome: "refund_confirmed" })
      .success,
    false,
  );
  assert.equal(
    purchaseWebhookSchema.safeParse({
      ...event({ id: randomUUID() } as PurchaseDetail),
      currency: "USD",
    }).success,
    false,
  );
});
test("purchase is bound to an immutable exact edition and metadata-only snapshot, with private role-scoped history", async () => {
  const p = await order();
  assert.equal(p.status, "pending");
  assert.equal(p.snapshot.versionNumber, 1);
  assert.equal(p.snapshot.priceKRW, 1000);
  assert.equal(p.snapshot.usageTerms, input.usageTerms);
  assert.equal(p.snapshot.allowCommercialUse, false);
  assert.match(p.updatedAt, /\.\d{6}Z$/);
  assert.equal(p.isBuyer, true);
  assert.equal(p.canDecide, false);
  assert.equal((await market.detail(seller, p.id)).canDecide, true);
  assert.equal((await market.detail(staff, p.id)).canReviewDisputes, true);
  assert.equal(JSON.stringify(p).includes("PRIVATE-MARKET"), false);
  assert.equal(JSON.stringify(p).includes(buyer), false);
  await assert.rejects(market.detail(other, p.id), code("NOT_FOUND"));
  await assert.rejects(market.detail(null, p.id), code("UNAUTHENTICATED"));
  const saved = await library.saveDraft(seller, entry.id, {
    content: {
      ...input,
      title: "개정된 이름과 이용 조건",
      usageTerms: "개정 이용 조건입니다.",
    },
    expectedUpdatedAt: entry.updatedAt,
  });
  await library.publish(seller, entry.id, {
    expectedUpdatedAt: saved.updatedAt,
    changeSummary: "가격과 이용 조건 개정",
    publicContentConsent: true,
  });
  const preserved = await market.detail(buyer, p.id);
  assert.equal(preserved.snapshot.title, input.title);
  assert.equal(preserved.snapshot.priceKRW, 1000);
  assert.equal(preserved.snapshot.usageTerms, input.usageTerms);
  assert.equal((await access()).status, "pending");
});
test("requests enforce current paid source, active members and legacy entitlement without overwriting", async () => {
  await assert.rejects(
    market.request(seller, entry.id, { version: 1, externalReference: "SELF-001", consent: true }),
    code("VALIDATION"),
  );
  await assert.rejects(
    market.request(buyer, entry.id, {
      version: 2,
      externalReference: "BAD-VERSION",
      consent: true,
    }),
    code("CONFLICT"),
  );
  await db.insert(libraryAccessRequests).values({
    entryId: entry.id,
    userId: buyer,
    externalReference: "LEGACY-PAID",
    amountKRW: 1000,
    status: "approved",
  });
  await assert.rejects(order(), code("CONFLICT"));
  assert.equal((await access()).externalReference, "LEGACY-PAID");
  await db
    .update(libraryAccessRequests)
    .set({ status: "revoked" })
    .where(eq(libraryAccessRequests.entryId, entry.id));
  const p = await order();
  assert.equal((await access()).externalReference, p.externalReference);
  await assert.rejects(order(), code("CONFLICT"));
  await db.insert(memberSafety).values({ userId: other, status: "closed", reason: "탈퇴" });
  await assert.rejects(market.list(other), code("FORBIDDEN"));
});
test("manual decisions require seller role and microsecond revision, update entitlement with append-only audit", async () => {
  const p = await order();
  await assert.rejects(decision(p, "approve", buyer), code("FORBIDDEN"));
  await assert.rejects(decision(p, "approve", staff), code("FORBIDDEN"));
  const paid = await decision(p, "approve");
  assert.equal(paid.status, "paid");
  assert.equal((await access()).status, "approved");
  assert.notEqual(paid.updatedAt, p.updatedAt);
  await assert.rejects(decision(p, "reject"), code("CONFLICT"));
  const revoked = await decision(paid, "revoke");
  assert.equal((await access()).status, "revoked");
  const refunded = await decision(revoked, "refund");
  assert.equal(refunded.status, "refunded");
  assert.deepEqual(refunded.audit.map((a) => a.action).sort(), [
    "approve",
    "refund",
    "requested",
    "revoke",
  ]);
  await assert.rejects(decision(refunded, "approve"), code("CONFLICT"));
});
test("signed semantic receipt retries are idempotent, conflicting IDs or wrong amounts/providers cannot change grants", async () => {
  const p = await order(),
    payload = event(p);
  const result = await market.webhook("partner", payload);
  assert.equal(result.duplicate, false);
  assert.equal(result.status, "paid");
  const paid = await market.detail(buyer, p.id),
    retry = await market.webhook("partner", { ...payload });
  assert.equal(retry.duplicate, true);
  assert.equal((await market.detail(buyer, p.id)).updatedAt, paid.updatedAt);
  await assert.rejects(market.webhook("partner", { ...payload, amountKRW: 900 }), code("CONFLICT"));
  await assert.rejects(
    market.webhook("partner", { ...payload, eventId: randomUUID(), amountKRW: 999 }),
    code("VALIDATION"),
  );
  await assert.rejects(
    market.webhook("other", { ...payload, eventId: randomUUID() }),
    code("CONFLICT"),
  );
  await assert.rejects(
    market.webhook("partner", { ...payload, eventId: randomUUID(), paymentId: "other-payment" }),
    code("CONFLICT"),
  );
  assert.equal((await access()).status, "approved");
  assert.equal((await db.select().from(libraryWebhookReceipts)).length, 1);
  assert.equal((await market.detail(buyer, p.id)).audit.length, 2);
});
test("refund-before-payment is terminal and late paid notifications cannot reactivate refunded or rejected orders", async () => {
  const p = await order();
  await market.webhook("partner", event(p, "refunded"));
  assert.equal((await market.detail(buyer, p.id)).status, "refunded");
  assert.equal((await access()).status, "revoked");
  assert.equal((await market.webhook("partner", event(p))).status, "refunded");
  const next = await order();
  const rejected = await decision(next, "reject");
  assert.equal(
    (await market.webhook("partner", event(rejected, "paid", randomUUID(), "payment-two"))).status,
    "rejected",
  );
  assert.equal((await market.detail(buyer, next.id)).status, "rejected");
});
test("old refunds preserve newer purchase grants and a provider payment cannot be mapped to a second order", async () => {
  const old = await order();
  await market.webhook("partner", event(old));
  const revoked = await decision(await market.detail(buyer, old.id), "revoke");
  const newer = await order();
  await assert.rejects(market.webhook("partner", event(newer)), code("CONFLICT"));
  await market.webhook("partner", event(newer, "paid", randomUUID(), "payment-new"));
  await market.webhook("partner", event(revoked, "refunded"));
  assert.equal((await access()).externalReference, newer.externalReference);
  assert.equal((await access()).status, "approved");
  assert.equal((await market.detail(buyer, old.id)).status, "refunded");
  assert.equal((await market.detail(buyer, newer.id)).status, "paid");
  await assert.rejects(
    market.request(buyer, entry.id, {
      version: 1,
      externalReference: old.externalReference,
      consent: true,
    }),
    code("CONFLICT"),
  );
});
test("financial evidence survives hidden and blocked content without restoring access or leaking source bodies", async () => {
  const p = await order();
  await decision(p, "approve");
  await db
    .insert(contentRestrictions)
    .values({ targetType: "library", targetId: entry.id, hidden: true, reason: "운영 숨김" });
  await db
    .insert(memberBlocks)
    .values({ blockerId: seller, blockedId: buyer, displayLabel: "차단된 회원" });
  assert.equal((await market.detail(buyer, p.id)).status, "paid");
  assert.equal((await market.list(seller, { scope: "selling" })).total, 1);
  await assert.rejects(library.detail(buyer, entry.id), code("NOT_FOUND"));
  await assert.rejects(
    market.request(other, entry.id, { version: 1, externalReference: "HIDDEN-001", consent: true }),
    code("NOT_FOUND"),
  );
  assert.equal(JSON.stringify(await market.detail(buyer, p.id)).includes("PRIVATE-MARKET"), false);
});
test("disputes are buyer-only, respond once, resolve by active staff with optimistic revisions and external refund confirmation", async () => {
  const p = await order();
  await decision(p, "approve");
  await assert.rejects(
    market.openDispute(seller, p.id, { kind: "terms", body: "이용 조건 관련 문의를 접수합니다." }),
    code("FORBIDDEN"),
  );
  let opened = await market.openDispute(buyer, p.id, {
      kind: "terms",
      body: "구매 당시 이용 조건에 대한 확인을 부탁드립니다.",
    }),
    d = opened.disputes[0]!;
  assert.equal(d.canWithdraw, true);
  assert.equal((await market.detail(seller, p.id)).disputes[0]!.canRespond, true);
  await assert.rejects(
    market.openDispute(buyer, p.id, {
      kind: "terms",
      body: "중복 문의 내용입니다. 확인을 부탁드립니다.",
    }),
    code("CONFLICT"),
  );
  await assert.rejects(
    market.respond(buyer, p.id, d.id, {
      expectedUpdatedAt: d.updatedAt,
      body: "구매자가 보낸 잘못된 답변",
    }),
    code("FORBIDDEN"),
  );
  opened = await market.respond(seller, p.id, d.id, {
    expectedUpdatedAt: d.updatedAt,
    body: "구매 버전에 명시된 개인 행사 범위로 사용할 수 있어요.",
  });
  await assert.rejects(
    market.respond(seller, p.id, d.id, {
      expectedUpdatedAt: d.updatedAt,
      body: "중복 답변을 전송합니다.",
    }),
    code("CONFLICT"),
  );
  d = opened.disputes[0]!;
  // Staff membership cannot let either trading party resolve their own case.
  await db.insert(staffRoles).values([
    { userId: seller, role: "moderator" },
    { userId: buyer, role: "moderator" },
  ]);
  assert.equal((await market.detail(seller, p.id)).disputes[0]!.canResolve, false);
  assert.equal((await market.detail(buyer, p.id)).disputes[0]!.canResolve, false);
  await assert.rejects(
    market.resolve(buyer, p.id, d.id, {
      expectedUpdatedAt: d.updatedAt,
      outcome: "no_action",
      note: "구매자가 스스로 판단한 해결",
      paymentChecked: false,
    }),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    market.resolve(seller, p.id, d.id, {
      expectedUpdatedAt: d.updatedAt,
      outcome: "no_action",
      note: "작성자가 스스로 판단한 해결",
      paymentChecked: false,
    }),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    market.resolve(staff, p.id, d.id, {
      expectedUpdatedAt: d.updatedAt,
      outcome: "refund_confirmed",
      note: "외부 환불 완료 확인",
      paymentChecked: false,
    }),
  );
  const resolutionNote =
    "외부 플랫폼에서 전액 환불 확인: " +
    "가".repeat(500 - "외부 플랫폼에서 전액 환불 확인: ".length);
  assert.equal(
    disputeResolutionSchema.safeParse({
      expectedUpdatedAt: d.updatedAt,
      outcome: "refund_confirmed",
      note: resolutionNote + "가",
      paymentChecked: true,
    }).success,
    false,
  );
  const resolved = await market.resolve(staff, p.id, d.id, {
    expectedUpdatedAt: d.updatedAt,
    outcome: "refund_confirmed",
    note: resolutionNote,
    paymentChecked: true,
  });
  assert.equal(resolved.status, "refunded");
  assert.equal(resolved.disputes[0]!.status, "resolved");
  assert.equal(resolved.disputes[0]!.resolutionNote, resolutionNote);
  assert.equal((await access()).decisionNote, resolutionNote);
  assert.equal((await access()).status, "revoked");
  await assert.rejects(
    market.resolve(staff, p.id, d.id, {
      expectedUpdatedAt: d.updatedAt,
      outcome: "no_action",
      note: "중복 해결 시도입니다.",
      paymentChecked: false,
    }),
    code("CONFLICT"),
  );
});
test("buyer can withdraw a dispute; closed staff cannot resolve and staff queue has no unrelated purchase data", async () => {
  const p = await order(),
    opened = await market.openDispute(buyer, p.id, {
      kind: "payment",
      body: "결제 처리 지연으로 문의를 접수합니다.",
    }),
    d = opened.disputes[0]!;
  await assert.rejects(market.list(buyer, { scope: "disputes" }), code("FORBIDDEN"));
  const queue = await market.list(staff, { scope: "disputes" });
  assert.equal(queue.total, 1);
  assert.equal(queue.canReviewDisputes, true);
  await db.insert(memberSafety).values({ userId: staff, status: "closed", reason: "탈퇴" });
  await assert.rejects(
    market.resolve(staff, p.id, d.id, {
      expectedUpdatedAt: d.updatedAt,
      outcome: "no_action",
      note: "처리 완료 안내입니다.",
      paymentChecked: false,
    }),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    market.withdraw(seller, p.id, d.id, { expectedUpdatedAt: d.updatedAt }),
    code("FORBIDDEN"),
  );
  const closed = await market.withdraw(buyer, p.id, d.id, { expectedUpdatedAt: d.updatedAt });
  assert.equal(closed.disputes[0]!.status, "withdrawn");
  assert.equal(closed.status, "pending");
  assert.equal((await access()).status, "pending");
});
test("failed payment grant mutation rolls back purchase, audit and receipt atomically", async () => {
  const p = await order();
  await db
    .update(libraryAccessRequests)
    .set({ externalReference: "NEWER-LEGACY-REFERENCE", status: "approved" })
    .where(eq(libraryAccessRequests.entryId, entry.id));
  await assert.rejects(market.webhook("partner", event(p)), code("CONFLICT"));
  assert.equal((await market.detail(buyer, p.id)).status, "pending");
  assert.equal((await db.select().from(libraryWebhookReceipts)).length, 0);
  assert.equal((await db.select().from(libraryPurchaseAudit)).length, 1);
  assert.equal((await access()).status, "approved");
});
test("legacy request and decision routes cannot bypass market audit or reactivate a terminal market reference", async () => {
  const p = await order();
  const [profile] = await db
    .select({ publicId: schema.profiles.publicId })
    .from(schema.profiles)
    .where(eq(schema.profiles.id, buyer));
  await assert.rejects(
    library.requestAccess(buyer, entry.id, { externalReference: "LEGACY-BYPASS", consent: true }),
    code("CONFLICT"),
  );
  await assert.rejects(
    library.decideAccess(seller, entry.id, {
      userPublicId: profile!.publicId,
      decision: "approve",
      paymentChecked: true,
      note: "승인 우회 시도",
    }),
    code("CONFLICT"),
  );
  assert.equal((await library.accessRequests(seller, entry.id)).items.length, 0);
  const rejected = await decision(p, "reject");
  await assert.rejects(
    library.requestAccess(buyer, entry.id, {
      externalReference: rejected.externalReference,
      consent: true,
    }),
    code("CONFLICT"),
  );
  assert.equal((await market.detail(buyer, p.id)).status, "rejected");
  assert.equal((await market.detail(buyer, p.id)).audit.length, 2);
});
test("market lists use role filters and stable 20-row pages without exposing other members' purchases", async () => {
  const first = await order();
  for (let i = 0; i < 20; i++) {
    const customer = await member(`구매자 ${i}`);
    await market.request(customer, entry.id, {
      version: 1,
      externalReference: `PAGE-${i}-ORDER`,
      consent: true,
    });
  }
  const a = await market.list(seller, { scope: "selling" }),
    b = await market.list(seller, { scope: "selling", page: 2 });
  assert.equal(a.total, 21);
  assert.equal(a.items.length, 20);
  assert.equal(b.items.length, 1);
  assert.equal(a.pageCount, 2);
  assert.equal(new Set([...a.items, ...b.items].map((p) => p.id)).size, 21);
  assert.equal((await market.list(buyer)).items[0]!.id, first.id);
  assert.equal((await market.list(other)).total, 0);
});
test("database stores private financial tables with RLS and preserves immutable snapshots, references and audit", async () => {
  const p = await order();
  await assert.rejects(
    db.update(libraryPurchases).set({ amountKRW: 1 }).where(eq(libraryPurchases.id, p.id)),
  );
  await assert.rejects(
    db
      .update(libraryPurchases)
      .set({ externalReference: "CHANGED-REF" })
      .where(eq(libraryPurchases.id, p.id)),
  );
  await assert.rejects(
    db
      .update(libraryPurchases)
      .set({ snapshot: { ...p.snapshot, usageTerms: "변경" } })
      .where(eq(libraryPurchases.id, p.id)),
  );
  await assert.rejects(
    db
      .update(libraryPurchaseAudit)
      .set({ note: "감사 기록 변경" })
      .where(eq(libraryPurchaseAudit.purchaseId, p.id)),
  );
  const rls = await pg.query<{ tablename: string; rowsecurity: boolean }>(
    "select tablename,rowsecurity from pg_tables where schemaname='sliper' and tablename in ('library_purchases','library_purchase_audit','library_webhook_receipts','library_purchase_disputes')",
  );
  assert.equal(rls.rows.length, 4);
  assert.ok(rls.rows.every((r) => r.rowsecurity));
  const versions = await db
    .select()
    .from(libraryVersions)
    .where(eq(libraryVersions.entryId, entry.id));
  assert.equal(versions.length, 1);
  assert.equal((await db.select().from(libraryPurchaseDisputes)).length, 0);
  assert.equal((await db.select().from(libraryEntries)).length, 1);
});
