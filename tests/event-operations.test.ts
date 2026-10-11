import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as base from "../src/db/schema";
import * as opsSchema from "../src/db/event-operations-schema";
import { memberSafety, staffRoles } from "../src/db/safety-schema";
import { eventResults } from "../src/db/player-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { ticketCodeFromScan } from "../src/domain/event-operations";
import { eventOperationsService } from "../src/server/event-operations-service";
import { paymentReconciliationService } from "../src/server/payment-reconciliation-service";
import { participationService } from "../src/server/participation-service";
import { communityService } from "../src/server/community-service";
import { safetyService } from "../src/server/safety-service";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg, { schema: { ...base, ...opsSchema } }),
  connection = db as unknown as Database;
let now: Date,
  owner: string,
  alice: string,
  bob: string,
  staff: string,
  outsider: string,
  postId: string,
  applicationId: string;
const service = eventOperationsService(connection, () => now),
  payments = paymentReconciliationService(connection),
  community = communityService(connection);
const code = (value: string) => (error: unknown) =>
  error instanceof AppError && error.code === value;
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(base.profiles).values({ id, nickname });
  return id;
}
async function event(author = owner, amount = 0) {
  const [post] = await db
    .insert(base.posts)
    .values({
      authorId: author,
      kind: "모집",
      categorySlug: "party",
      title: "QR 체크인 행사",
      bodyMarkdown: "QR 입장 및 후기 검증을 위한 행사입니다.",
    })
    .returning();
  await db.insert(base.eventSettings).values({
    postId: post!.id,
    amountKRW: amount,
    capacity: 20,
    startsAt: new Date(now.getTime() - 30 * 60000),
    endsAt: new Date(now.getTime() + 3600000),
  });
  return post!.id;
}
async function app(user = alice, id = postId) {
  const [row] = await db
    .insert(base.eventApplications)
    .values({
      postId: id,
      userId: user,
      attendeeName: "신청 참가자",
      contact: "test@example.invalid",
      amountKRW: 0,
      status: "confirmed",
      confirmedAt: now,
      expiresAt: new Date(now.getTime() + 30 * 60000),
    })
    .returning();
  return row!.id;
}
async function paidFixture() {
  postId = await event(owner, 10000);
  const [application] = await db
    .insert(base.eventApplications)
    .values({
      postId,
      userId: alice,
      attendeeName: "신청 참가자",
      contact: "test@example.invalid",
      amountKRW: 10000,
      status: "pending_payment",
      expiresAt: new Date(now.getTime() + 1800000),
      refundConsentAt: now,
    })
    .returning();
  applicationId = application!.id;
  await db.insert(base.paymentOrders).values({
    applicationId,
    provider: "test-provider",
    amountKRW: 10000,
    state: "paid",
    paymentId: randomUUID(),
  });
  await db
    .update(base.eventApplications)
    .set({ status: "confirmed", confirmedAt: now })
    .where(eq(base.eventApplications.id, applicationId));
  await db.insert(base.roomManagers).values({ postId, userId: staff });
}
async function ticket() {
  return service.issue(alice, postId, { applicationId });
}
async function admit() {
  const issued = await ticket();
  return service.scan(owner, postId, { code: issued.code }, true);
}
const review = {
  title: "함께해서 즐거운 행사 후기",
  bodyMarkdown: "진행 방식이 재미있었고 다음 행사에서도 함께하고 싶어요.",
  rating: 5,
};
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(base.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade");
  now = new Date();
  owner = await member("주최자");
  alice = await member("참가자");
  bob = await member("다른 참가자");
  staff = await member("현장 담당자");
  outsider = await member("다른 회원");
  postId = await event();
  applicationId = await app();
  await db.insert(base.roomManagers).values({ postId, userId: staff });
});
after(() => pg.close());
test("QR links preserve only the ticket capability and reject another origin or event", () => {
  const value = "a".repeat(43),
    origin = "https://sliper.example";
  assert.equal(ticketCodeFromScan(value, postId, origin), value);
  assert.equal(
    ticketCodeFromScan(
      `${origin}/management/events/${postId}/check-in#ticket=${value}`,
      postId,
      origin,
    ),
    value,
  );
  assert.throws(() =>
    ticketCodeFromScan(
      `https://other.example/management/events/${postId}/check-in#ticket=${value}`,
      postId,
      origin,
    ),
  );
  assert.throws(() =>
    ticketCodeFromScan(
      `${origin}/management/events/${randomUUID()}/check-in#ticket=${value}`,
      postId,
      origin,
    ),
  );
});
test("ticket issuance verifies ownership and stores a hash rather than the QR code", async () => {
  await assert.rejects(service.issue(outsider, postId, { applicationId }), code("NOT_FOUND"));
  const issued = await ticket();
  assert.equal(issued.code.length, 43);
  const [stored] = await db.select().from(opsSchema.admissionTickets);
  assert.notEqual(stored?.codeHash, issued.code);
  assert.equal(stored?.codeHash.length, 64);
  assert.equal(JSON.stringify(issued).includes(alice), false);
  assert.equal(JSON.stringify(issued).includes(owner), false);
});
test("issuing another QR invalidates the old code", async () => {
  const old = await ticket(),
    current = await ticket();
  await assert.rejects(service.scan(owner, postId, { code: old.code }), code("NOT_FOUND"));
  assert.equal((await service.scan(owner, postId, { code: current.code })).canAdmit, true);
});
test("only event managers can inspect a QR, even when a platform admin knows the code", async () => {
  const issued = await ticket();
  await db.insert(staffRoles).values({ userId: outsider, role: "admin" });
  await assert.rejects(service.scan(outsider, postId, { code: issued.code }), code("FORBIDDEN"));
  assert.equal((await service.scan(staff, postId, { code: issued.code })).canAdmit, true);
  await assert.rejects(service.roster(bob, postId), code("FORBIDDEN"));
});
test("preview never admits a participant and concurrent approvals create one admission", async () => {
  const issued = await ticket();
  assert.equal((await service.scan(owner, postId, { code: issued.code })).checkedAt, null);
  assert.equal((await db.select().from(opsSchema.eventAdmissions)).length, 0);
  const result = await Promise.all([
    service.scan(owner, postId, { code: issued.code }, true),
    service.scan(staff, postId, { code: issued.code }, true),
  ]);
  assert.equal(result[0]?.checkedAt, result[1]?.checkedAt);
  assert.equal((await db.select().from(opsSchema.eventAdmissions)).length, 1);
  assert.equal((await service.roster(owner, postId)).checkedIn, 1);
  await assert.rejects(ticket(), code("CONFLICT"));
});
test("a code cannot admit a participant into another event", async () => {
  const issued = await ticket(),
    other = await event();
  await assert.rejects(service.scan(owner, other, { code: issued.code }, true), code("NOT_FOUND"));
});
test("the admission window starts two hours before the event and ends at its closing time", async () => {
  const issued = await ticket(),
    original = now;
  now = new Date(original.getTime() - 3 * 3600000);
  assert.equal((await service.scan(owner, postId, { code: issued.code })).canAdmit, false);
  await assert.rejects(service.scan(owner, postId, { code: issued.code }, true), code("CONFLICT"));
  now = new Date(original.getTime() + 3600001);
  await assert.rejects(service.scan(owner, postId, { code: issued.code }, true), code("CONFLICT"));
});
test("an event needs a precise start and end before issuing admission passes", async () => {
  postId = await event();
  await db
    .update(base.eventSettings)
    .set({ startsAt: null, endsAt: null })
    .where(eq(base.eventSettings.postId, postId));
  await assert.rejects(ticket(), code("CONFLICT"));
});
test("cancellation immediately invalidates an already-issued QR", async () => {
  const issued = await ticket();
  await db
    .update(base.eventApplications)
    .set({ status: "cancelled" })
    .where(eq(base.eventApplications.id, applicationId));
  await assert.rejects(service.scan(owner, postId, { code: issued.code }, true), code("CONFLICT"));
  assert.equal((await db.select().from(opsSchema.eventAdmissions)).length, 0);
});
test("pending refunds and suspended member accounts prevent admission", async () => {
  await paidFixture();
  const issued = await ticket();
  await db.insert(base.refundRequests).values({
    applicationId,
    postId,
    userId: alice,
    eventStartsAt: new Date(now.getTime() - 1800000),
    amountKRW: 10000,
    rate: 0,
    refundableKRW: 0,
    reason: "입장 전 환불 문의",
  });
  await assert.rejects(service.scan(owner, postId, { code: issued.code }, true), code("CONFLICT"));
  await db.delete(base.refundRequests);
  await db.insert(memberSafety).values({
    userId: alice,
    status: "suspended",
    suspendedUntil: new Date(now.getTime() + 3600000),
    reason: "테스트 이용 제한",
  });
  await assert.rejects(service.scan(owner, postId, { code: issued.code }, true), code("CONFLICT"));
});
test("a manager cannot approve their own admission", async () => {
  const own = await app(owner),
    issued = await service.issue(owner, postId, { applicationId: own });
  assert.equal((await service.scan(owner, postId, { code: issued.code })).canAdmit, false);
  await assert.rejects(service.scan(owner, postId, { code: issued.code }, true), code("FORBIDDEN"));
  assert.ok((await service.scan(staff, postId, { code: issued.code }, true)).checkedAt);
});
test("event completion records only QR admissions, once, and preserves an existing win", async () => {
  await admit();
  await assert.rejects(service.finalize(owner, postId), code("CONFLICT"));
  now = new Date(now.getTime() + 3600001);
  assert.equal((await service.finalize(owner, postId)).recorded, 1);
  assert.equal((await service.finalize(owner, postId)).recorded, 0);
  await db
    .update(eventResults)
    .set({ outcome: "won" })
    .where(eq(eventResults.applicationId, applicationId));
  await service.finalize(staff, postId);
  assert.equal((await db.select().from(eventResults))[0]?.outcome, "won");
  assert.equal((await db.select().from(base.eventSettings))[0]?.open, false);
});
test("verified reviews require both QR admission and an ended event and are unique per attendee", async () => {
  await assert.rejects(service.writeReview(alice, postId, review), code("CONFLICT"));
  await admit();
  now = new Date(now.getTime() + 3600001);
  await assert.rejects(service.writeReview(bob, postId, review), code("FORBIDDEN"));
  const result = await service.writeReview(alice, postId, review);
  assert.equal(result.reviews.length, 1);
  assert.equal(result.canReview, false);
  assert.equal(result.reviews[0]?.rating, 5);
  assert.equal(JSON.stringify(result.reviews).includes(alice), false);
  await assert.rejects(service.writeReview(alice, postId, review), code("CONFLICT"));
  const meta = (await db.select().from(opsSchema.verifiedEventReviews))[0]!;
  const projected = await community.getPost(meta.reviewPostId, null);
  assert.equal(projected.verifiedParticipation?.eventPostId, postId);
  assert.equal(projected.verifiedParticipation?.rating, 5);
});
test("verified reviews retain certification on edits and use existing report/moderation rules", async () => {
  await admit();
  now = new Date(now.getTime() + 3600001);
  const result = await service.writeReview(alice, postId, review),
    id = result.ownReviewPostId!;
  const projected = await community.getPost(id, alice);
  await assert.rejects(
    community.updatePost(alice, {
      postId: id,
      expectedUpdatedAt: projected.updatedAt,
      categorySlug: "party",
      kind: "이야기",
      title: review.title,
      bodyMarkdown: review.bodyMarkdown,
      isAnonymous: false,
      imageAssetIds: [],
    }),
    code("VALIDATION"),
  );
  await db.insert(staffRoles).values({ userId: owner, role: "admin" });
  const safety = safetyService(connection),
    report = await safety.report(bob, { targetType: "post", targetId: id, reason: "other" });
  await safety.resolve(owner, report.id, { action: "hide", reason: "인증 후기 숨김 처리 검사" });
  assert.equal((await service.reviews(null, postId)).reviews.length, 0);
});
test("payment reconciliation exposes only a manager-scoped work queue and immutable review notes", async () => {
  await paidFixture();
  await db.insert(base.refundRequests).values({
    applicationId,
    postId,
    userId: alice,
    eventStartsAt: new Date(now.getTime() - 1800000),
    amountKRW: 10000,
    rate: 0,
    refundableKRW: 0,
    reason: "환불 처리 검토",
  });
  await assert.rejects(payments.overview(bob, postId), code("FORBIDDEN"));
  const view = await payments.overview(owner, postId),
    item = view.items[0]!;
  assert.deepEqual(item.issues, ["refund_pending"]);
  assert.equal(item.pendingRefundKRW, 0);
  assert.equal(JSON.stringify(view).includes(alice), false);
  await payments.note(owner, postId, {
    applicationId,
    fingerprint: item.fingerprint,
    note: "외부 플랫폼의 취소 내역을 확인 중입니다.",
  });
  assert.equal((await payments.overview(staff, postId)).items[0]?.notes.length, 1);
  await db
    .update(base.refundRequests)
    .set({ state: "rejected", processedAt: now, processedBy: owner, decisionNote: "입장 확정" });
  await assert.rejects(
    payments.note(owner, postId, {
      applicationId,
      fingerprint: item.fingerprint,
      note: "오래된 상태에서 검토 기록 요청",
    }),
    code("CONFLICT"),
  );
});

test("late verified payments enter the reconciliation queue and never grant a QR pass", async () => {
  postId = await event(owner, 10000);
  const [application] = await db
    .insert(base.eventApplications)
    .values({
      postId,
      userId: alice,
      attendeeName: "결제 확인 참가자",
      contact: "test@example.invalid",
      amountKRW: 10000,
      status: "pending_payment",
      expiresAt: new Date(now.getTime() - 1000),
      refundConsentAt: now,
    })
    .returning();
  applicationId = application!.id;
  const [order] = await db
    .insert(base.paymentOrders)
    .values({ applicationId, provider: "test-provider", amountKRW: 10000 })
    .returning();
  const participation = participationService(connection);
  await participation.payment("test-provider", {
    eventId: randomUUID(),
    orderId: order!.id,
    paymentId: "test-payment",
    amountKRW: 10000,
    currency: "KRW",
    status: "paid",
  });
  const queue = await payments.overview(owner, postId),
    item = queue.items[0]!;
  assert.deepEqual(item.issues, ["paid_unconfirmed"]);
  assert.equal(item.applicationStatus, "review");
  await assert.rejects(ticket(), code("CONFLICT"));
  await payments.note(owner, postId, {
    applicationId,
    fingerprint: item.fingerprint,
    note: "늦은 결제 건으로 외부 환불을 확인 중입니다.",
  });
  await participation.payment("test-provider", {
    eventId: randomUUID(),
    orderId: order!.id,
    paymentId: "test-payment",
    amountKRW: 10000,
    currency: "KRW",
    status: "refunded",
    refundAmountKRW: 10000,
  });
  assert.equal((await payments.overview(owner, postId)).items.length, 0);
  await assert.rejects(
    payments.note(owner, postId, {
      applicationId,
      fingerprint: item.fingerprint,
      note: "이미 변경된 결제에 대한 기록",
    }),
    code("CONFLICT"),
  );
});

test("blocking an event host prevents writing a review without creating a hidden post", async () => {
  await admit();
  now = new Date(now.getTime() + 3600001);
  await safetyService(connection).block(alice, { targetType: "post", targetId: postId });
  await assert.rejects(service.writeReview(alice, postId, review), code("NOT_FOUND"));
  assert.equal((await db.select().from(opsSchema.verifiedEventReviews)).length, 0);
  assert.equal((await db.select().from(base.posts)).length, 1);
});

test("database constraints reject an admission assigned to another applicant", async () => {
  await assert.rejects(
    db.insert(opsSchema.eventAdmissions).values({
      applicationId,
      postId,
      userId: bob,
      checkedBy: owner,
    }),
    (error: unknown) =>
      String((error as { cause?: unknown }).cause).includes("admission_application_identity_fk"),
  );
  assert.equal((await db.select().from(opsSchema.eventAdmissions)).length, 0);
});

test("database constraints bind a certified review to the attendee that actually checked in", async () => {
  await admit();
  const [post] = await db
    .insert(base.posts)
    .values({
      authorId: bob,
      categorySlug: "party",
      kind: "후기",
      title: review.title,
      bodyMarkdown: review.bodyMarkdown,
    })
    .returning();
  await assert.rejects(
    db.insert(opsSchema.verifiedEventReviews).values({
      reviewPostId: post!.id,
      eventPostId: postId,
      applicationId,
      userId: bob,
      hostId: owner,
      eventTitle: "QR 체크인 행사",
      rating: 5,
    }),
    (error: unknown) =>
      String((error as { cause?: unknown }).cause).includes(
        "verified_review_admission_identity_fk",
      ),
  );
  assert.equal((await db.select().from(opsSchema.verifiedEventReviews)).length, 0);
});

test("a new refund request with the same amount never reuses review notes for an older request", async () => {
  await paidFixture();
  const request = {
    applicationId,
    postId,
    userId: alice,
    eventStartsAt: now,
    amountKRW: 10000,
    rate: 0,
    refundableKRW: 0,
    reason: "환불 재검토 요청",
  };
  await db.insert(base.refundRequests).values(request);
  const first = (await payments.overview(owner, postId)).items[0]!;
  await payments.note(owner, postId, {
    applicationId,
    fingerprint: first.fingerprint,
    note: "첫 번째 환불 요청을 확인했습니다.",
  });
  await db.update(base.refundRequests).set({
    state: "rejected",
    processedAt: now,
    processedBy: owner,
    decisionNote: "기존 요청 종료",
  });
  await db.insert(base.refundRequests).values(request);
  const current = (await payments.overview(owner, postId)).items[0]!;
  assert.notEqual(current.fingerprint, first.fingerprint);
  assert.equal(current.notes.length, 0);
  await assert.rejects(
    payments.note(owner, postId, {
      applicationId,
      fingerprint: first.fingerprint,
      note: "이전 요청 화면에서 등록한 검토 메모",
    }),
    code("CONFLICT"),
  );
});
