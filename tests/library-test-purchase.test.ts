import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import {
  libraryAccessRequests,
  libraryEntries,
  libraryPurchases,
  libraryPurchaseAudit,
  libraryVersions,
  libraryWebhookReceipts,
} from "../src/db/library-schema";
import { contentRestrictions, memberBlocks, memberSafety } from "../src/db/safety-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { libraryInputSchema, type LibraryDetail } from "../src/domain/library";
import { libraryTestPurchaseSchema } from "../src/domain/library-test-purchase";
import { AppError } from "../src/server/errors";
import { libraryMarketService } from "../src/server/library-market-service";
import { libraryService } from "../src/server/library-service";
import {
  localLibraryPurchaseEnabled,
  libraryTestPurchaseService,
} from "../src/server/library-test-purchase";

const validEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "development",
  LOCAL_DATABASE: "1",
  SLIPER_AUTH_MODE: "development",
  DATABASE_URL: "postgres://fixture@127.0.0.1:55432/sliper_dev",
};
const disabledEnvironments: Array<Partial<NodeJS.ProcessEnv>> = [
  { NODE_ENV: "production" },
  { NODE_ENV: "test" },
  { LOCAL_DATABASE: undefined },
  { LOCAL_DATABASE: "0" },
  { LOCAL_DATABASE: "true" },
  { SLIPER_AUTH_MODE: undefined },
  { SLIPER_AUTH_MODE: "supabase" },
  { DATABASE_URL: undefined },
  { DATABASE_URL: "not a URL" },
  { DATABASE_URL: "postgres://fixture@cloud.example:55432/sliper_dev" },
  { DATABASE_URL: "postgres://fixture@localhost:55432/sliper_dev" },
  { DATABASE_URL: "postgres://fixture@127.0.0.2:55432/sliper_dev" },
  { DATABASE_URL: "postgres://fixture@[::1]:55432/sliper_dev" },
  { DATABASE_URL: "postgres://fixture@127.0.0.1:5432/sliper_dev" },
  { DATABASE_URL: "postgres://fixture@127.0.0.1/sliper_dev" },
  { DATABASE_URL: "postgres://fixture@127.0.0.1:55432/another" },
  { DATABASE_URL: "postgres://fixture@127.0.0.1:55432/sliper_dev/" },
  { DATABASE_URL: "https://127.0.0.1:55432/sliper_dev" },
  { LIBRARY_PAYMENT_PROVIDER: "partner" },
  { LIBRARY_PAYMENT_WEBHOOK_SECRET: "fixture-only" },
  { LIBRARY_PAYMENT_PROVIDER: "partner", LIBRARY_PAYMENT_WEBHOOK_SECRET: "fixture-only" },
];
const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database,
  library = libraryService(connection),
  market = libraryMarketService(connection),
  simulator = libraryTestPurchaseService(connection, validEnv);
let seller: string, buyer: string, other: string, entry: LibraryDetail;
const input = libraryInputSchema.parse({
  kind: "template",
  categorySlug: "knowledge",
  title: "로컬 테스트 구매용 유료 템플릿",
  summary: "테스트 구매의 금액과 권한 및 구매 기록을 검증하는 자료입니다.",
  scenario:
    "PRIVATE-TEST-SCENARIO 참가자들은 서로 협력하며 단서 카드를 활용해 단계별 미션을 해결합니다.",
  rules: "PRIVATE-TEST-RULE 각 팀은 같은 시간과 단서를 받아 순서대로 문제를 해결합니다.",
  hostGuide: "PRIVATE-TEST-HOST 진행자는 참가자의 안전을 확인하고 미션별 진행을 안내합니다.",
  materials: ["미션 카드"],
  rounds: [{ name: "협업 미션", seconds: 300 }],
  tags: ["협업"],
  minPlayers: 2,
  maxPlayers: 10,
  durationMinutes: 60,
  priceKRW: 2700,
  purchaseUrl: "https://example.com/buy",
  usageTerms: "구매한 버전을 개인 행사에서만 사용할 수 있습니다.",
  allowDerivatives: true,
  allowCommercialUse: false,
});
const purchaseInput = { version: 1, note: "테스트 구매 메모", consent: true };
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(schema.profiles).values({ id, nickname });
  return id;
}
async function access() {
  return (
    await db
      .select()
      .from(libraryAccessRequests)
      .where(
        and(eq(libraryAccessRequests.entryId, entry.id), eq(libraryAccessRequests.userId, buyer)),
      )
  )[0];
}
async function assertNoPurchases() {
  assert.equal((await db.select().from(libraryPurchases)).length, 0);
  assert.equal((await db.select().from(libraryPurchaseAudit)).length, 0);
  assert.equal((await db.select().from(libraryWebhookReceipts)).length, 0);
}
async function externalOrder() {
  return market.request(buyer, entry.id, {
    ...purchaseInput,
    externalReference: "EXTERNAL-ORDER-001",
  });
}
async function failingApproval(run: () => Promise<void>) {
  // Fail after request, pending grant and audit creation, during the paid transition.
  await pg.exec(`
    create function sliper.fail_test_purchase_approval() returns trigger as $$
    begin
      if NEW.status = 'approved' then
        raise exception 'forced-test-purchase-approval-failure';
      end if;
      return NEW;
    end;
    $$ language plpgsql;
    create trigger fail_test_purchase_approval before insert or update
      on sliper.library_access_requests for each row
      execute function sliper.fail_test_purchase_approval();
  `);
  try {
    await run();
  } finally {
    await pg.exec(`
      drop trigger fail_test_purchase_approval on sliper.library_access_requests;
      drop function sliper.fail_test_purchase_approval();
    `);
  }
}
function forcedApprovalFailure(error: unknown) {
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
  return cause instanceof Error && cause.message.includes("forced-test-purchase-approval-failure");
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
  seller = await member("자료 판매자");
  buyer = await member("테스트 구매자");
  other = await member("다른 회원");
  entry = await library.create(seller, input);
});
after(() => pg.close());

test("simulator requires all local development flags, the exact local database and no payment configuration", () => {
  assert.equal(localLibraryPurchaseEnabled(validEnv), true);
  assert.equal(
    localLibraryPurchaseEnabled({
      ...validEnv,
      DATABASE_URL: "postgresql://fixture@127.0.0.1:55432/sliper_dev",
    }),
    true,
  );
  for (const changed of disabledEnvironments)
    assert.equal(localLibraryPurchaseEnabled({ ...validEnv, ...changed }), false);
  const missingNodeEnvironment = Object.fromEntries(
    Object.entries(validEnv).filter(([key]) => key !== "NODE_ENV"),
  ) as NodeJS.ProcessEnv;
  assert.equal(localLibraryPurchaseEnabled(missingNodeEnvironment), false);
});

test("test purchase schema accepts only edition, bounded note and explicit consent", () => {
  assert.deepEqual(libraryTestPurchaseSchema.parse({ version: 1, consent: true }), {
    version: 1,
    note: "",
    consent: true,
  });
  assert.equal(
    libraryTestPurchaseSchema.parse({ ...purchaseInput, note: "  메모  " }).note,
    "메모",
  );
  for (const protectedField of [
    { priceKRW: 1 },
    { amountKRW: 1 },
    { buyerId: buyer },
    { sellerId: seller },
    { memberId: buyer },
    { userId: buyer },
    { externalReference: "CLIENT-REFERENCE" },
    { provider: "partner" },
    { paymentId: "CLIENT-PAYMENT" },
    { status: "paid" },
  ])
    assert.equal(
      libraryTestPurchaseSchema.safeParse({ ...purchaseInput, ...protectedField }).success,
      false,
    );
  for (const invalid of [
    { version: 1 },
    { version: 1, consent: false },
    { version: 1, consent: "true" },
    { ...purchaseInput, version: 0 },
    { ...purchaseInput, version: 1.5 },
    { ...purchaseInput, version: "1" },
    { ...purchaseInput, note: "가".repeat(501) },
  ])
    assert.equal(libraryTestPurchaseSchema.safeParse(invalid).success, false);
});

test("disabled service rejects before creating orders or entitlements", async () => {
  for (const changed of disabledEnvironments)
    await assert.rejects(
      libraryTestPurchaseService(connection, { ...validEnv, ...changed }).purchase(
        buyer,
        entry.id,
        purchaseInput,
      ),
      code("NOT_FOUND"),
    );
  await assertNoPurchases();
  assert.equal(await access(), undefined);
});

test("local test purchase records the exact edition and server price, approves access and uses audited local payment", async () => {
  const locked = await library.detail(buyer, entry.id);
  assert.equal(locked.payload, null);
  assert.equal(locked.canHost, false);
  const paid = await simulator.purchase(buyer, entry.id, purchaseInput);
  assert.equal(paid.status, "paid");
  assert.equal(paid.provider, "local-test");
  assert.equal(paid.amountKRW, 2700);
  assert.equal(paid.snapshot.versionNumber, 1);
  assert.equal(paid.snapshot.priceKRW, 2700);
  assert.equal(paid.snapshot.usageTerms, input.usageTerms);
  assert.equal(paid.snapshot.allowDerivatives, true);
  assert.equal(paid.snapshot.allowCommercialUse, false);
  assert.equal(paid.note, purchaseInput.note);
  assert.match(paid.externalReference, /^SLIPER-TEST-[a-f0-9-]{36}$/);
  assert.equal(paid.paymentId, `TEST-PAYMENT-${paid.id}`);
  assert.deepEqual(paid.audit.map((row) => row.action).sort(), ["requested", "webhook_paid"]);
  assert.match(paid.audit.find((row) => row.action === "webhook_paid")!.note, /실제 결제 없이/);
  assert.equal(JSON.stringify(paid).includes("PRIVATE-TEST"), false);
  const [stored] = await db.select().from(libraryPurchases);
  const [version] = await db
    .select()
    .from(libraryVersions)
    .where(eq(libraryVersions.entryId, entry.id));
  assert.equal(stored!.buyerId, buyer);
  assert.equal(stored!.sellerId, seller);
  assert.equal(stored!.versionId, version!.id);
  const [receipt] = await db.select().from(libraryWebhookReceipts);
  assert.equal(receipt!.purchaseId, paid.id);
  assert.equal(receipt!.provider, "local-test");
  assert.equal(receipt!.eventId, `TEST-PAID-${paid.id}`);
  assert.equal(receipt!.status, "paid");
  const unlocked = await library.detail(buyer, entry.id);
  assert.deepEqual(unlocked.payload, entry.payload);
  assert.equal(unlocked.canHost, true);
  assert.equal(unlocked.canDerive, true);
  assert.equal(unlocked.myAccess!.status, "approved");
  assert.equal(unlocked.myAccess!.amountKRW, paid.amountKRW);
  assert.equal(unlocked.myAccess!.externalReference, paid.externalReference);
  assert.equal((await library.detail(other, entry.id)).payload, null);
  await assert.rejects(market.detail(other, paid.id), code("NOT_FOUND"));
});

test("repeated test purchase returns the same paid order without another audit, receipt or grant change", async () => {
  const first = await simulator.purchase(buyer, entry.id, purchaseInput),
    firstGrant = await access();
  for (let i = 0; i < 3; i++) {
    const repeated = await simulator.purchase(buyer, entry.id, {
      ...purchaseInput,
      note: "반복 클릭",
    });
    assert.deepEqual(repeated, first);
  }
  assert.equal((await db.select().from(libraryPurchases)).length, 1);
  assert.equal((await db.select().from(libraryPurchaseAudit)).length, 2);
  assert.equal((await db.select().from(libraryWebhookReceipts)).length, 1);
  assert.deepEqual(await access(), firstGrant);
});

test("stale edition is rejected and the current edition's conditions are frozen in the test purchase", async () => {
  const saved = await library.saveDraft(seller, entry.id, {
    content: { ...input, title: "개정된 테스트 구매 자료", usageTerms: "개정 이용 조건입니다." },
    expectedUpdatedAt: entry.updatedAt,
  });
  entry = await library.publish(seller, entry.id, {
    expectedUpdatedAt: saved.updatedAt,
    changeSummary: "이름과 이용 조건 개정",
    publicContentConsent: true,
  });
  await assert.rejects(simulator.purchase(buyer, entry.id, purchaseInput), code("CONFLICT"));
  await assertNoPurchases();
  const paid = await simulator.purchase(buyer, entry.id, { ...purchaseInput, version: 2 });
  assert.equal(paid.snapshot.versionNumber, 2);
  assert.equal(paid.snapshot.title, entry.title);
  assert.equal(paid.snapshot.usageTerms, entry.usageTerms);
  assert.equal(paid.amountKRW, entry.priceKRW);
});

test("pending external order is preserved and cannot be completed by the simulator", async () => {
  const pending = await externalOrder(),
    originalGrant = await access();
  await assert.rejects(simulator.purchase(buyer, entry.id, purchaseInput), code("CONFLICT"));
  assert.deepEqual(await market.detail(buyer, pending.id), pending);
  assert.deepEqual(await access(), originalGrant);
  assert.equal((await db.select().from(libraryPurchases)).length, 1);
  assert.equal((await db.select().from(libraryPurchaseAudit)).length, 1);
  assert.equal((await db.select().from(libraryWebhookReceipts)).length, 0);
});

for (const paymentKind of ["external-provider", "manual-approval"] as const)
  test(`paid ${paymentKind} order cannot be replaced with a local test payment`, async () => {
    const pending = await externalOrder();
    if (paymentKind === "external-provider")
      await market.webhook("partner", {
        eventId: "EXTERNAL-PAID-001",
        purchaseId: pending.id,
        paymentId: "EXTERNAL-PAYMENT-001",
        type: "paid",
        amountKRW: input.priceKRW,
        currency: "KRW",
      });
    else
      await market.decide(seller, pending.id, {
        action: "approve",
        expectedUpdatedAt: pending.updatedAt,
        note: "외부 결제 내역을 확인했습니다.",
        paymentChecked: true,
      });
    const paid = await market.detail(buyer, pending.id),
      originalGrant = await access(),
      originalReceipts = await db.select().from(libraryWebhookReceipts);
    await assert.rejects(simulator.purchase(buyer, entry.id, purchaseInput), code("CONFLICT"));
    assert.deepEqual(await market.detail(buyer, pending.id), paid);
    assert.deepEqual(await access(), originalGrant);
    assert.deepEqual(await db.select().from(libraryWebhookReceipts), originalReceipts);
    assert.equal((await db.select().from(libraryPurchases)).length, 1);
    assert.equal((await db.select().from(libraryPurchaseAudit)).length, 2);
  });

for (const status of ["pending", "approved"] as const)
  test(`legacy ${status} approval is retained without creating a test order`, async () => {
    await db.insert(libraryAccessRequests).values({
      entryId: entry.id,
      userId: buyer,
      externalReference: "LEGACY-REFERENCE-001",
      amountKRW: input.priceKRW,
      note: "보존할 기존 요청",
      decisionNote: "기존 처리 메모",
      status,
    });
    const originalGrant = await access();
    await assert.rejects(simulator.purchase(buyer, entry.id, purchaseInput), code("CONFLICT"));
    assert.deepEqual(await access(), originalGrant);
    await assertNoPurchases();
  });

test("guest, unknown or closed members, self purchases and wrong versions create no purchase records", async () => {
  await assert.rejects(simulator.purchase(null, entry.id, purchaseInput), code("UNAUTHENTICATED"));
  await assert.rejects(
    simulator.purchase(randomUUID(), entry.id, purchaseInput),
    code("FORBIDDEN"),
  );
  await assert.rejects(simulator.purchase(seller, entry.id, purchaseInput), code("VALIDATION"));
  await assert.rejects(
    simulator.purchase(buyer, entry.id, { ...purchaseInput, version: 2 }),
    code("CONFLICT"),
  );
  await db.insert(memberSafety).values({ userId: buyer, status: "closed", reason: "탈퇴" });
  await assert.rejects(simulator.purchase(buyer, entry.id, purchaseInput), code("FORBIDDEN"));
  await assertNoPurchases();
  assert.equal(await access(), undefined);
});

test("free, draft and deleted sources cannot create test purchases", async () => {
  const free = await library.create(seller, { ...input, priceKRW: 0, purchaseUrl: null });
  await assert.rejects(simulator.purchase(buyer, free.id, purchaseInput), code("VALIDATION"));
  for (const status of ["draft", "deleted"]) {
    await db.update(libraryEntries).set({ status }).where(eq(libraryEntries.id, entry.id));
    await assert.rejects(simulator.purchase(buyer, entry.id, purchaseInput), code("NOT_FOUND"));
  }
  await assertNoPurchases();
  assert.equal(await access(), undefined);
});

test("hidden and mutually blocked sources cannot create purchase records or unlock content", async () => {
  await db.insert(contentRestrictions).values({
    targetType: "library",
    targetId: entry.id,
    hidden: true,
    reason: "운영 숨김",
  });
  await assert.rejects(simulator.purchase(buyer, entry.id, purchaseInput), code("NOT_FOUND"));
  await db.delete(contentRestrictions).where(eq(contentRestrictions.targetId, entry.id));
  for (const [blockerId, blockedId] of [
    [seller, buyer],
    [buyer, seller],
  ]) {
    await db
      .insert(memberBlocks)
      .values({ blockerId: blockerId!, blockedId: blockedId!, displayLabel: "차단된 회원" });
    await assert.rejects(simulator.purchase(buyer, entry.id, purchaseInput), code("NOT_FOUND"));
    await db.delete(memberBlocks);
  }
  await assertNoPurchases();
  assert.equal(await access(), undefined);
  assert.equal((await library.detail(buyer, entry.id)).payload, null);
});

test("unconfirmed consent and client-controlled purchase values fail without writes", async () => {
  for (const invalid of [
    { version: 1, consent: false },
    { version: 1 },
    { ...purchaseInput, amountKRW: 1 },
    { ...purchaseInput, buyerId: other },
    { ...purchaseInput, externalReference: "CLIENT-REFERENCE" },
    { ...purchaseInput, status: "paid" },
  ])
    await assert.rejects(simulator.purchase(buyer, entry.id, invalid));
  await assertNoPurchases();
  assert.equal(await access(), undefined);
});

test("failed approval rolls back the order, pending grant, audit and payment receipt together", async () => {
  await failingApproval(async () => {
    await assert.rejects(simulator.purchase(buyer, entry.id, purchaseInput), forcedApprovalFailure);
    await assertNoPurchases();
    assert.equal(await access(), undefined);
    assert.equal((await library.detail(buyer, entry.id)).payload, null);
  });
  assert.equal((await simulator.purchase(buyer, entry.id, purchaseInput)).status, "paid");
  assert.equal((await db.select().from(libraryPurchases)).length, 1);
  assert.equal((await db.select().from(libraryPurchaseAudit)).length, 2);
  assert.equal((await db.select().from(libraryWebhookReceipts)).length, 1);
});

test("failed test payment restores the legacy grant replaced during order creation", async () => {
  await db.insert(libraryAccessRequests).values({
    entryId: entry.id,
    userId: buyer,
    externalReference: "LEGACY-REVOKED-001",
    amountKRW: input.priceKRW,
    note: "보존할 기존 메모",
    decisionNote: "기존 회수 사유",
    status: "revoked",
  });
  const originalGrant = await access();
  await failingApproval(async () => {
    await assert.rejects(simulator.purchase(buyer, entry.id, purchaseInput), forcedApprovalFailure);
    assert.deepEqual(await access(), originalGrant);
    await assertNoPurchases();
    assert.equal((await library.detail(buyer, entry.id)).payload, null);
  });
});
