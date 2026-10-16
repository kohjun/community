import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { profiles, posts, categories } from "../src/db/schema";
import {
  memberSafety,
  moderationAudit,
  safetyReports,
  staffRoles,
  supportTickets,
} from "../src/db/safety-schema";
import { libraryPurchaseAudit, libraryPurchaseDisputes } from "../src/db/library-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { libraryInputSchema } from "../src/domain/library";
import { operationsQuerySchema, operationsTriageSchema } from "../src/domain/operations";
import { operationsService } from "../src/server/operations-service";
import { safetyService } from "../src/server/safety-service";
import { libraryService } from "../src/server/library-service";
import { libraryMarketService } from "../src/server/library-market-service";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database,
  operations = operationsService(connection),
  safety = safetyService(connection),
  library = libraryService(connection),
  market = libraryMarketService(connection);
let owner: string, buyer: string, admin: string, moderator: string;
const code = (expected: string) => (e: unknown) => e instanceof AppError && e.code === expected;
const databaseCode = (expected: string) => (error: unknown) => {
  const c = error && typeof error === "object" && "cause" in error ? error.cause : error;
  return !!c && typeof c === "object" && "code" in c && c.code === expected;
};
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(profiles).values({ id, nickname });
  return id;
}
async function report(assignedTo?: string) {
  const [post] = await db
    .insert(posts)
    .values({
      authorId: owner,
      categorySlug: "party",
      title: "원본 신고 콘텐츠",
      bodyMarkdown: "PRIVATE-REPORT-CONTENT 보호할 원문",
      kind: "이야기",
    })
    .returning({ id: posts.id });
  const [row] = await db
    .insert(safetyReports)
    .values({
      reporterId: buyer,
      targetType: "post",
      targetId: post!.id,
      reason: "other",
      detail: "PRIVATE-REPORT-DETAIL 원본 신고 설명",
      snapshot: "원본 신고 콘텐츠\nPRIVATE-EVIDENCE 보존할 증거",
      ...(assignedTo ? { assignedTo } : {}),
    })
    .returning();
  return row!;
}
async function ticket() {
  const [row] = await db
    .insert(supportTickets)
    .values({
      userId: buyer,
      category: "refund",
      subject: "원본 문의 제목",
      body: "PRIVATE-SUPPORT-BODY 외부 플랫폼 환불 확인 문의입니다.",
    })
    .returning();
  return row!;
}
async function dispute() {
  const entry = await library.create(
    owner,
    libraryInputSchema.parse({
      kind: "template",
      categorySlug: "knowledge",
      title: "분쟁 테스트 자료",
      summary: "원본 자료 거래 분쟁을 통합 운영 큐에서 확인하는 테스트입니다.",
      scenario:
        "PRIVATE-PAID-SCENARIO 참가자들이 각자 역할을 맡아 협력하며 주어진 미션을 해결하는 시나리오입니다.",
      rules: "PRIVATE-PAID-RULE 규칙을 지키며 정해진 시간 동안 게임을 진행합니다.",
      hostGuide: "PRIVATE-PAID-HOST 운영자가 단계별 안내를 진행하고 마무리 발언을 합니다.",
      materials: ["PRIVATE-MATERIAL"],
      rounds: [{ name: "미션", seconds: 300 }],
      tags: ["협업"],
      minPlayers: 2,
      maxPlayers: 10,
      durationMinutes: 60,
      priceKRW: 1000,
      purchaseUrl: "https://example.com/buy",
      usageTerms: "개인 행사에서 사용할 수 있습니다.",
      allowDerivatives: true,
      allowCommercialUse: false,
    }),
  );
  const purchase = await market.request(buyer, entry.id, {
    version: 1,
    externalReference: `ORDER-${randomUUID()}`,
    note: "PRIVATE-PURCHASE-NOTE",
    consent: true,
  });
  const result = await market.openDispute(buyer, purchase.id, {
    kind: "delivery",
    body: "PRIVATE-DISPUTE-BODY 구매 자료 이용에 대해 확인이 필요합니다.",
  });
  return { purchaseId: purchase.id, id: result.disputes[0]!.id };
}
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;");
  owner = await member("원본 작성자");
  buyer = await member("접수자");
  admin = await member("운영 책임자");
  moderator = await member("운영 담당자");
  await db.insert(staffRoles).values([
    { userId: admin, role: "admin" },
    { userId: moderator, role: "moderator" },
  ]);
});
after(() => pg.close());
test("strict operational inputs reject status/owner forgery, invalid revisions and unrelated deadline edits", () => {
  assert.equal(
    operationsQuerySchema.safeParse({
      kind: "all",
      stage: "reviewing",
      assignment: "mine",
      page: 1,
    }).success,
    true,
  );
  assert.equal(operationsQuerySchema.safeParse({ status: "resolved" }).success, false);
  assert.equal(
    operationsTriageSchema.safeParse({ action: "claim", expectedRevision: 1, status: "dismissed" })
      .success,
    false,
  );
  assert.equal(
    operationsTriageSchema.safeParse({ action: "claim", expectedRevision: 0 }).success,
    false,
  );
  assert.equal(
    operationsTriageSchema.safeParse({ action: "set_due", expectedRevision: 1 }).success,
    false,
  );
  assert.equal(
    operationsTriageSchema.safeParse({ action: "claim", expectedRevision: 1, dueAt: null }).success,
    false,
  );
  assert.equal(
    operationsTriageSchema.safeParse({
      action: "set_due",
      expectedRevision: 1,
      dueAt: "2026-12-10T12:00:00",
    }).success,
    false,
  );
});
test("operations read access requires active staff and GETs preserve source state and revision", async () => {
  const row = await report();
  await ticket();
  const d = await dispute();
  await assert.rejects(operations.list(null), code("UNAUTHENTICATED"));
  await assert.rejects(operations.list(buyer), code("FORBIDDEN"));
  const first = await operations.list(admin, { stage: "all" });
  assert.equal(first.total, 3);
  assert.deepEqual(first.counts, { pending: 3, reviewing: 0, completed: 0 });
  assert.equal(first.role, "admin");
  assert.equal(
    first.items.every((item) => item.revision === 1 && item.stage === "pending"),
    true,
  );
  assert.equal(JSON.stringify(first).includes(admin), false);
  assert.equal(JSON.stringify(first).includes(buyer), false);
  assert.equal(JSON.stringify(first).includes("PRIVATE-PAID-SCENARIO"), false);
  assert.equal(JSON.stringify(first).includes("PRIVATE-PURCHASE-NOTE"), false);
  assert.equal(
    (await safety.reportDetail(admin, row.id)).snapshot?.includes("PRIVATE-EVIDENCE"),
    true,
  );
  assert.equal(
    (await operations.detail(admin, "dispute", d.id)).href,
    `/archive/purchases/${d.purchaseId}#dispute-${d.id}`,
  );
  const second = await operations.list(admin, { stage: "all" });
  assert.deepEqual(second.counts, first.counts);
  assert.equal((await db.select().from(safetyReports))[0]!.revision, 1);
  assert.equal((await db.select().from(moderationAudit)).length, 0);
  await db.insert(memberSafety).values({
    userId: moderator,
    status: "suspended",
    suspendedUntil: new Date(Date.now() + 86400000),
  });
  await assert.rejects(operations.list(moderator), code("FORBIDDEN"));
  await assert.rejects(safety.requireStaff(moderator), code("FORBIDDEN"));
  assert.equal(await safety.role(moderator), null);
});
test("claim, review, deadline and release update only triage metadata and append immutable audit evidence", async () => {
  const source = await report();
  let row = await operations.triage(moderator, "report", source.id, {
    action: "claim",
    expectedRevision: 1,
  });
  assert.equal(row.revision, 2);
  assert.equal(row.assignee?.isMine, true);
  assert.equal(row.stage, "pending");
  await assert.rejects(
    operations.triage(admin, "report", source.id, { action: "claim", expectedRevision: 1 }),
    code("CONFLICT"),
  );
  row = await operations.triage(moderator, "report", source.id, {
    action: "start_review",
    expectedRevision: row.revision,
  });
  assert.equal(row.revision, 3);
  assert.equal(row.stage, "reviewing");
  assert.ok(row.reviewStartedAt);
  const started = row.reviewStartedAt,
    dueAt = new Date(Date.now() + 86400000).toISOString();
  row = await operations.triage(moderator, "report", source.id, {
    action: "set_due",
    expectedRevision: row.revision,
    dueAt,
  });
  assert.equal(new Date(row.dueAt!).toISOString(), dueAt);
  await assert.rejects(
    operations.triage(moderator, "report", source.id, {
      action: "set_due",
      expectedRevision: row.revision,
      dueAt: "2000-01-01T00:00:00Z",
    }),
    code("VALIDATION"),
  );
  row = await operations.triage(admin, "report", source.id, {
    action: "release",
    expectedRevision: row.revision,
  });
  assert.equal(row.assignee, null);
  assert.equal(row.reviewStartedAt, started);
  assert.equal(row.stage, "reviewing");
  const [after] = await db.select().from(safetyReports).where(eq(safetyReports.id, source.id));
  assert.equal(after?.snapshot, source.snapshot);
  assert.equal(after?.detail, source.detail);
  assert.equal(after?.status, "open");
  assert.equal(after?.resolution, "");
  assert.equal(after?.resolvedAt, null);
  assert.equal(after?.revision, 5);
  const audit = await db.select().from(moderationAudit);
  assert.deepEqual(
    audit.map((a) => a.action),
    ["ops_claim", "ops_start_review", "ops_set_due", "ops_release"],
  );
});
test("non-assigned moderators cannot alter another operator's case and admins can release inactive assignments", async () => {
  const source = await report(admin);
  let row = await operations.detail(moderator, "report", source.id);
  assert.equal(row.canTriage, false);
  await assert.rejects(
    operations.triage(moderator, "report", source.id, {
      action: "start_review",
      expectedRevision: 1,
    }),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    operations.triage(moderator, "report", source.id, { action: "release", expectedRevision: 1 }),
    code("FORBIDDEN"),
  );
  const second = await report(moderator);
  await db.insert(memberSafety).values({ userId: moderator, status: "closed" });
  row = await operations.detail(admin, "report", second.id);
  assert.equal(row.assignee?.active, false);
  row = await operations.triage(admin, "report", second.id, {
    action: "release",
    expectedRevision: row.revision,
  });
  assert.equal(row.assignee, null);
  await assert.rejects(
    db.update(safetyReports).set({ assignedTo: moderator }).where(eq(safetyReports.id, second.id)),
    databaseCode("23514"),
  );
});
test("legacy report resolution and support replies immediately move the unified queue to completed with latest response", async () => {
  const r = await report(),
    t = await ticket();
  await operations.triage(admin, "report", r.id, { action: "claim", expectedRevision: 1 });
  await safety.resolve(admin, r.id, {
    action: "dismiss",
    reason: "원본 증거를 확인해 신고 검토를 완료했습니다.",
  });
  await safety.reply(admin, t.id, {
    body: "외부 플랫폼의 처리 내역을 확인한 후 안내드렸습니다.",
    close: false,
  });
  const completed = await operations.list(admin, { stage: "completed" });
  assert.equal(completed.total, 2);
  assert.equal(completed.items.find((item) => item.id === r.id)?.sourceStatus, "dismissed");
  assert.equal(completed.items.find((item) => item.id === t.id)?.sourceStatus, "answered");
  assert.match(completed.items.find((item) => item.id === t.id)!.lastResponse!.body, /처리 내역/);
  await assert.rejects(
    operations.triage(admin, "report", r.id, { action: "release", expectedRevision: 2 }),
    code("CONFLICT"),
  );
  await assert.rejects(
    operations.triage(admin, "support", t.id, { action: "claim", expectedRevision: 2 }),
    code("CONFLICT"),
  );
  assert.equal((await operations.detail(admin, "report", r.id)).revision, 3);
  assert.equal((await operations.detail(admin, "support", t.id)).revision, 2);
  assert.equal((await safety.ticketDetail(admin, t.id)).replies.length, 1);
});
test("transaction parties are excluded from their own dispute queue and cannot triage or self-resolve even as staff", async () => {
  const d = await dispute();
  await db.insert(staffRoles).values([
    { userId: buyer, role: "moderator" },
    { userId: owner, role: "moderator" },
  ]);
  assert.equal((await operations.list(buyer, { kind: "dispute", stage: "all" })).total, 0);
  assert.equal((await operations.list(owner, { kind: "dispute", stage: "all" })).total, 0);
  assert.equal((await operations.list(admin, { kind: "dispute", stage: "all" })).total, 1);
  await assert.rejects(operations.detail(buyer, "dispute", d.id), code("FORBIDDEN"));
  await assert.rejects(
    operations.triage(owner, "dispute", d.id, { action: "claim", expectedRevision: 1 }),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    db
      .update(libraryPurchaseDisputes)
      .set({ assignedTo: buyer })
      .where(eq(libraryPurchaseDisputes.id, d.id)),
    databaseCode("23514"),
  );
  const detail = await market.detail(buyer, d.purchaseId);
  await assert.rejects(
    market.resolve(buyer, d.purchaseId, d.id, {
      expectedUpdatedAt: detail.disputes[0]!.updatedAt,
      outcome: "no_action",
      note: "본인 거래 분쟁 처리 시도",
      paymentChecked: false,
    }),
    code("FORBIDDEN"),
  );
});
test("dispute triage invalidates stale seller/resolution forms, retains private financial evidence and audits both systems", async () => {
  const d = await dispute(),
    before = await market.detail(admin, d.purchaseId),
    old = before.disputes[0]!.updatedAt;
  const claimed = await operations.triage(moderator, "dispute", d.id, {
    action: "claim",
    expectedRevision: 1,
  });
  assert.equal(claimed.revision, 2);
  await assert.rejects(
    market.respond(owner, d.purchaseId, d.id, {
      expectedUpdatedAt: old,
      body: "이용 안내를 다시 전달드리겠습니다.",
    }),
    code("CONFLICT"),
  );
  let latest = await market.detail(owner, d.purchaseId);
  await market.respond(owner, d.purchaseId, d.id, {
    expectedUpdatedAt: latest.disputes[0]!.updatedAt,
    body: "구매한 자료와 이용 안내를 확인했습니다.",
  });
  assert.equal((await operations.detail(admin, "dispute", d.id)).revision, 3);
  latest = await market.detail(admin, d.purchaseId);
  await market.resolve(admin, d.purchaseId, d.id, {
    expectedUpdatedAt: latest.disputes[0]!.updatedAt,
    outcome: "no_action",
    note: "원본 거래와 응답 내역을 검토해 추가 조치 없이 마무리했습니다.",
    paymentChecked: false,
  });
  const done = await operations.detail(admin, "dispute", d.id);
  assert.equal(done.stage, "completed");
  assert.equal(done.sourceStatus, "resolved");
  assert.equal(done.revision, 4);
  assert.ok(done.lastResponse?.at);
  assert.deepEqual(done.allowedActions, []);
  assert.equal(
    (await db.select().from(libraryPurchaseAudit)).some((a) => a.action === "operations_claim"),
    true,
  );
  assert.equal(
    (await db.select().from(moderationAudit)).some(
      (a) => a.targetType === "dispute" && a.action === "ops_claim",
    ),
    true,
  );
});
test("20-row pages and kind/stage/assignee filters operate on current originals without adding queue rows", async () => {
  for (let i = 0; i < 22; i++) await report(i < 2 ? moderator : undefined);
  const t = await ticket();
  await operations.triage(admin, "support", t.id, { action: "claim", expectedRevision: 1 });
  await operations.triage(admin, "support", t.id, { action: "start_review", expectedRevision: 2 });
  const first = await operations.list(admin, { kind: "report", stage: "pending", page: 1 }),
    second = await operations.list(admin, { kind: "report", stage: "pending", page: 2 });
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 2);
  assert.equal(first.total, 22);
  assert.equal(first.pageCount, 2);
  assert.equal(new Set([...first.items, ...second.items].map((row) => row.id)).size, 22);
  assert.equal((await operations.list(moderator, { kind: "report", assignment: "mine" })).total, 2);
  assert.equal(
    (await operations.list(admin, { kind: "report", assignment: "unassigned" })).total,
    20,
  );
  assert.equal((await operations.list(admin, { stage: "reviewing" })).items[0]?.kind, "support");
  assert.equal((await db.select().from(safetyReports)).length, 22);
  assert.equal((await db.select().from(supportTickets)).length, 1);
});

test("staff role revocation blocks triage and source actions; database rejects missing, conflicted or inactive dispute adjudicators", async () => {
  const r = await report(moderator),
    d = await dispute();
  await db.delete(staffRoles).where(eq(staffRoles.userId, moderator));
  await assert.rejects(operations.list(moderator), code("FORBIDDEN"));
  await assert.rejects(
    operations.triage(moderator, "report", r.id, { action: "release", expectedRevision: 1 }),
    code("FORBIDDEN"),
  );
  await assert.rejects(safety.reportDetail(moderator, r.id), code("FORBIDDEN"));
  const detail = await operations.detail(admin, "report", r.id),
    queue = await operations.list(admin, { kind: "report", stage: "all" }),
    queued = queue.items.find((item) => item.id === r.id);
  assert.equal(detail.assignee?.active, false);
  assert.equal(queued?.assignee?.active, false);
  assert.equal(queued?.assignee?.publicId, detail.assignee?.publicId);
  assert.equal(queued?.stage, "pending");
  assert.equal(
    (await operations.list(admin, { kind: "report", assignment: "unassigned" })).total,
    0,
  );
  const [retained] = await db.select().from(safetyReports).where(eq(safetyReports.id, r.id));
  assert.equal(retained?.assignedTo, moderator);
  assert.equal(retained?.snapshot, r.snapshot);
  assert.equal(retained?.revision, r.revision);

  const resolve = (actor: string | null) =>
    db
      .update(libraryPurchaseDisputes)
      .set({
        status: "resolved",
        outcome: "no_action",
        resolutionNote: "원본을 검토한 최종 응답입니다.",
        resolvedBy: actor,
        resolvedAt: new Date(),
      })
      .where(eq(libraryPurchaseDisputes.id, d.id));
  await assert.rejects(resolve(null), databaseCode("23514"));
  await assert.rejects(resolve(moderator), databaseCode("23514"));
  await db.insert(staffRoles).values({ userId: buyer, role: "moderator" });
  await assert.rejects(resolve(buyer), databaseCode("23514"));
  await db.insert(memberSafety).values({ userId: admin, status: "closed" });
  await assert.rejects(resolve(admin), databaseCode("23514"));
  assert.equal(
    (await db.select().from(libraryPurchaseDisputes).where(eq(libraryPurchaseDisputes.id, d.id)))[0]
      ?.status,
    "open",
  );
});
