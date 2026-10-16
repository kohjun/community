import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as base from "../src/db/schema";
import { contentRestrictions, memberSafety } from "../src/db/safety-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { safetyService } from "../src/server/safety-service";
import { participationService } from "../src/server/participation-service";
import { eventLifecycleService } from "../src/server/event-lifecycle-service";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database;
const safety = safetyService(connection);
let host: string, participant: string;
const conflict = (error: unknown) => error instanceof AppError && error.code === "CONFLICT";
const guard = (error: unknown) => {
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
  return !!cause && typeof cause === "object" && "code" in cause && cause.code === "23514";
};
async function person(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(base.profiles).values({ id, nickname });
  return id;
}
async function event(startsIn: number, endsIn: number | null, paid = false) {
  const now = Date.now();
  const [post] = await db
    .insert(base.posts)
    .values({
      authorId: host,
      categorySlug: "party",
      kind: "모집",
      title: "탈퇴 책임 검증 행사",
      bodyMarkdown: "진행 상태와 결제 정리 여부를 검증하는 실제 서비스 회귀 행사입니다.",
    })
    .returning();
  await db.insert(base.eventSettings).values({
    postId: post!.id,
    amountKRW: paid ? 10000 : 0,
    capacity: 5,
    open: true,
    startsAt: new Date(now + startsIn),
    endsAt: endsIn === null ? null : new Date(now + endsIn),
  });
  const [application] = await db
    .insert(base.eventApplications)
    .values({
      postId: post!.id,
      userId: participant,
      attendeeName: "참가 회원",
      contact: "01012345678",
      amountKRW: paid ? 10000 : 0,
      status: paid ? "pending_payment" : "confirmed",
      confirmedAt: paid ? null : new Date(),
      refundConsentAt: paid ? new Date() : null,
      expiresAt: new Date(now + 1800000),
      eventStartsAt: new Date(now + startsIn),
    })
    .returning();
  if (paid)
    await db.insert(base.paymentOrders).values({
      applicationId: application!.id,
      provider: "fixture",
      amountKRW: 10000,
      state: "paid",
    });
  if (paid)
    await db
      .update(base.eventApplications)
      .set({ status: "confirmed", confirmedAt: new Date() })
      .where(eq(base.eventApplications.id, application!.id));
  return { post: post!, application: application! };
}
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(base.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade");
  host = await person("행사 주최자");
  participant = await person("참가 회원");
});
after(() => pg.close());

test("closing recruitment cannot release the future host from confirmed participants", async () => {
  const fixture = await event(86400000, 90000000);
  await participationService(connection).configure(host, fixture.post.id, {
    amountKRW: 0,
    capacity: 5,
    open: false,
  });
  await assert.rejects(safety.withdraw(host), conflict);
  assert.equal((await safety.account(host)).status, "active");
  assert.equal((await db.select().from(base.eventApplications))[0]!.status, "confirmed");
  await assert.rejects(db.insert(memberSafety).values({ userId: host, status: "closed" }), guard);
});

test("an ongoing event remains host responsibility until its end even when recruitment is closed", async () => {
  const fixture = await event(-3600000, 3600000);
  await db
    .update(base.eventSettings)
    .set({ open: false })
    .where(eq(base.eventSettings.postId, fixture.post.id));
  await assert.rejects(safety.withdraw(host), conflict);
});

test("a normally ended event preserves paid attendance while allowing its host to withdraw", async () => {
  const fixture = await event(-7200000, -3600000, true);
  await safety.withdraw(host);
  assert.equal((await safety.account(host)).status, "closed");
  assert.equal((await db.select().from(base.paymentOrders))[0]!.state, "paid");
  assert.equal((await db.select().from(base.eventApplications))[0]!.id, fixture.application.id);
});

test("a cancelled event blocks withdrawal until pending and actual paid refund obligations are both settled", async () => {
  const fixture = await event(86400000, 90000000, true);
  await eventLifecycleService(connection).change(host, fixture.post.id, {
    kind: "cancel",
    expectedRevision: 0,
    confirmed: true,
    reason: "주최자 사정으로 행사를 취소합니다.",
  });
  await assert.rejects(safety.withdraw(host), conflict);
  await db.insert(contentRestrictions).values({
    targetType: "post",
    targetId: fixture.post.id,
    reason: "운영 숨김으로 환불 책임이 사라지지 않아야 합니다.",
  });
  // A rejected request alone must not hide an unpaid provider obligation.
  await db.update(base.refundRequests).set({
    state: "rejected",
    processedBy: host,
    processedAt: new Date(),
    decisionNote: "외부 환불 확인이 아직 필요합니다.",
  });
  await assert.rejects(safety.withdraw(host), conflict);
  await db.update(base.paymentOrders).set({ state: "refunded", refundedAmountKRW: 8000 });
  await assert.rejects(safety.withdraw(host), conflict);
  await db.update(base.paymentOrders).set({ state: "refunded", refundedAmountKRW: 10000 });
  await safety.withdraw(host);
  assert.equal((await safety.account(host)).status, "closed");
});

test("a cancelled free event and an unconfigured closed draft create no remaining host responsibility", async () => {
  const fixture = await event(86400000, 90000000);
  await eventLifecycleService(connection).change(host, fixture.post.id, {
    kind: "cancel",
    expectedRevision: 0,
    confirmed: true,
    reason: "무료 행사의 일정을 취소합니다.",
  });
  const [draft] = await db
    .insert(base.posts)
    .values({
      authorId: host,
      categorySlug: "party",
      kind: "모집",
      title: "일정 미설정 작성 초안",
      bodyMarkdown: "아직 신청자가 없고 일정이 지정되지 않은 닫힌 작성 초안입니다.",
    })
    .returning();
  await db
    .insert(base.eventSettings)
    .values({ postId: draft!.id, amountKRW: 0, capacity: 5, open: false });
  await safety.withdraw(host);
  assert.equal((await safety.account(host)).status, "closed");
});

test("deferred database guards prevent new or rescheduled responsibilities after account closure", async () => {
  const fixture = await event(-7200000, -3600000);
  await db
    .delete(base.eventApplications)
    .where(eq(base.eventApplications.id, fixture.application.id));
  await safety.withdraw(host);
  await assert.rejects(
    db
      .update(base.eventSettings)
      .set({ startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 90000000) })
      .where(eq(base.eventSettings.postId, fixture.post.id)),
    guard,
  );
  assert.equal((await db.select().from(base.eventSettings))[0]!.endsAt! < new Date(), true);
  const [post] = await db
    .insert(base.posts)
    .values({
      authorId: host,
      categorySlug: "party",
      kind: "모집",
      title: "종료 후 생성 경쟁",
      bodyMarkdown: "탈퇴가 먼저 완료된 경우의 행사 설정 저장을 검증합니다.",
    })
    .returning();
  await assert.rejects(
    db.insert(base.eventSettings).values({
      postId: post!.id,
      amountKRW: 0,
      capacity: 5,
      startsAt: new Date(Date.now() + 86400000),
    }),
    guard,
  );
  assert.equal((await db.select().from(base.eventSettings)).length, 1);
});

test("deleting an empty future recruitment releases responsibility while confirmed events remain protected", async () => {
  const fixture = await event(86400000, 90000000);
  await assert.rejects(
    db.update(base.posts).set({ status: "deleted" }).where(eq(base.posts.id, fixture.post.id)),
  );
  await assert.rejects(safety.withdraw(host), conflict);
  await db
    .update(base.eventApplications)
    .set({ status: "cancelled" })
    .where(eq(base.eventApplications.id, fixture.application.id));
  await db.update(base.posts).set({ status: "deleted" }).where(eq(base.posts.id, fixture.post.id));
  await safety.withdraw(host);
  assert.equal((await safety.account(host)).status, "closed");
});

test("cancelled external-platform receipts retain responsibility until the verified full refund", async () => {
  const [post] = await db
    .insert(base.posts)
    .values({
      authorId: host,
      categorySlug: "party",
      kind: "모집",
      applicationUrl: "https://example.invalid/registration",
      title: "외부 결제 환불 책임",
      bodyMarkdown: "외부 플랫폼 영수증의 환불 완료까지 주최 책임을 보존합니다.",
    })
    .returning();
  await db.insert(base.eventSettings).values({
    postId: post!.id,
    amountKRW: 10000,
    capacity: 5,
    open: false,
    startsAt: new Date(Date.now() + 86400000),
    endsAt: new Date(Date.now() + 90000000),
  });
  const [application] = await db
    .insert(base.eventApplications)
    .values({
      postId: post!.id,
      userId: participant,
      source: "external",
      externalReference: "fixture-external",
      attendeeName: "참가 회원",
      contact: "01012345678",
      amountKRW: 10000,
      status: "pending_approval",
      expiresAt: null,
    })
    .returning();
  await db.insert(base.externalReceipts).values({
    applicationId: application!.id,
    postId: post!.id,
    reference: "fixture-external",
    amountKRW: 10000,
    provider: "fixture",
    verification: "manual",
    verifiedBy: host,
    state: "paid",
  });
  await db
    .update(base.eventApplications)
    .set({ status: "confirmed", confirmedAt: new Date() })
    .where(eq(base.eventApplications.id, application!.id));
  await eventLifecycleService(connection).change(host, post!.id, {
    kind: "cancel",
    expectedRevision: 0,
    confirmed: true,
    reason: "외부 참가비를 전액 환불하는 행사 취소입니다.",
  });
  await assert.rejects(safety.withdraw(host), conflict);
  await db.update(base.refundRequests).set({
    state: "rejected",
    processedBy: host,
    processedAt: new Date(),
    decisionNote: "실제 외부 환불 확인 대기",
  });
  await assert.rejects(safety.withdraw(host), conflict);
  await db.update(base.externalReceipts).set({ state: "refunded", refundedAmountKRW: 10000 });
  await safety.withdraw(host);
  assert.equal((await safety.account(host)).status, "closed");
});

test("an empty recruitment converted into a story does not retain phantom host responsibility", async () => {
  const fixture = await event(86400000, 90000000);
  await db
    .delete(base.eventApplications)
    .where(eq(base.eventApplications.id, fixture.application.id));
  await db.update(base.posts).set({ kind: "이야기" }).where(eq(base.posts.id, fixture.post.id));
  await safety.withdraw(host);
  assert.equal((await safety.account(host)).status, "closed");
});
