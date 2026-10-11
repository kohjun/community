import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as base from "../src/db/schema";
import * as recordSchema from "../src/db/records-schema";
import * as player from "../src/db/player-schema";
import { memberBlocks, memberSafety, contentRestrictions } from "../src/db/safety-schema";
import { eventAdmissions } from "../src/db/event-operations-schema";
import { eventLifecycleService } from "../src/server/event-lifecycle-service";
import { libraryEntries } from "../src/db/library-schema";
import { inboxItems } from "../src/db/engagement-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { eventCreditService, acceptedCreditViews } from "../src/server/event-credit-service";
import { portfolioService } from "../src/server/portfolio-service";
import { playerService } from "../src/server/player-service";
import { eventOperationsService } from "../src/server/event-operations-service";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg, { schema: { ...base, ...recordSchema, ...player } }),
  database = db as unknown as Database;
const credits = eventCreditService(database),
  portfolio = portfolioService(database),
  players = playerService(database),
  operations = eventOperationsService(database);
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
let host: { id: string; publicId: string },
  alice: { id: string; publicId: string },
  bob: { id: string; publicId: string },
  other: { id: string; publicId: string },
  postId: string;
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  const [row] = await db
    .insert(base.profiles)
    .values({ id, nickname, bio: "연락처 없는 소개", phoneNumber: "01012345678", region: "서울" })
    .returning({ publicId: base.profiles.publicId });
  return { id, publicId: row!.publicId };
}
async function event(
  options: { published?: boolean; formal?: boolean; sample?: boolean; host?: typeof host } = {},
) {
  const owner = options.host ?? host,
    id = randomUUID();
  await db.insert(base.posts).values({
    id,
    authorId: owner.id,
    kind: "모집",
    categorySlug: "party",
    title: "연결된 완료 행사",
    bodyMarkdown: "완료된 행사 기록 테스트",
    sample: options.sample ?? false,
  });
  await db.insert(base.eventSettings).values({
    postId: id,
    startsAt: new Date("2020-01-01T01:00:00Z"),
    endsAt: new Date("2020-01-01T03:00:00Z"),
    amountKRW: 0,
    capacity: 100,
    open: true,
    completedAt: options.formal === false ? null : new Date("2020-01-01T04:00:00Z"),
    completedBy: options.formal === false ? null : owner.id,
  });
  await db.insert(base.eventRecords).values({
    postId: id,
    ownerId: owner.id,
    status: options.published === false ? "draft" : "published",
    completedAt: new Date("2020-01-01T04:00:00Z"),
    snapshot: {
      title: "연결된 완료 행사",
      category: "party",
      location: "서울",
      startsAt: "2020-01-01T01:00:00Z",
      endsAt: "2020-01-01T03:00:00Z",
      hostPublicId: owner.publicId,
      hostNickname: "진행자",
      template: null,
    },
  });
  return id;
}
async function attendance(user: typeof alice, qr = false, eventId = postId, owner = host) {
  const id = randomUUID();
  await db.insert(base.eventApplications).values({
    id,
    postId: eventId,
    userId: user.id,
    attendeeName: "참가자",
    contact: "private-contact",
    amountKRW: 0,
    status: "confirmed",
    confirmedAt: new Date("2020-01-01T00:10:00Z"),
    expiresAt: new Date("2020-01-01T04:00:00Z"),
  });
  if (qr)
    await db
      .insert(eventAdmissions)
      .values({ applicationId: id, postId: eventId, userId: user.id, checkedBy: owner.id });
  await players.recordResult(owner.id, eventId, {
    applicationId: id,
    presence: "attended",
    outcome: "participated",
    observedRole: "brain",
  });
  return id;
}
async function invite(role: "MC" | "기획자" = "MC", user = alice, eventId = postId) {
  const list = await credits.create(host.id, eventId, {
    memberPublicId: user.publicId,
    role,
    note: "현장 진행 확인",
  });
  return list.items.find((item) => item.publicId === user.publicId && item.role === role)!;
}
async function accept(credit: Awaited<ReturnType<typeof invite>>, user = alice) {
  await credits.decide(user.id, credit.id, {
    expectedUpdatedAt: credit.updatedAt,
    decision: "accept",
  });
}
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(base.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;");
  host = await member("진행자");
  alice = await member("첫 참가자");
  bob = await member("다른 참가자");
  other = await member("외부 회원");
  postId = await event();
});
after(() => pg.close());
test("credit creation requires a completed event, manager confirmation, a nonself active member", async () => {
  await assert.rejects(credits.me(null), code("UNAUTHENTICATED"));
  await assert.rejects(
    credits.create(other.id, postId, { memberPublicId: alice.publicId, role: "MC" }),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    credits.create(host.id, postId, { memberPublicId: host.publicId, role: "MC" }),
    code("FORBIDDEN"),
  );
  const pending = await invite();
  assert.equal(pending.status, "pending");
  assert.equal((await acceptedCreditViews(database, other.id, postId)).length, 0);
  assert.equal((await credits.me(alice.id)).items[0]?.id, pending.id);
  assert.equal((await db.select().from(inboxItems))[0]?.kind, "credits");
  assert.equal(JSON.stringify(await credits.me(alice.id)).includes(alice.id), false);
  await assert.rejects(
    credits.create(host.id, postId, { memberPublicId: alice.publicId, role: "MC" }),
    code("CONFLICT"),
  );
  const unofficial = await event({ formal: false });
  await assert.rejects(
    credits.create(host.id, unofficial, { memberPublicId: alice.publicId, role: "MC" }),
    code("NOT_FOUND"),
  );
  await db.insert(memberSafety).values({ userId: bob.id, status: "closed" });
  await assert.rejects(
    credits.create(host.id, postId, { memberPublicId: bob.publicId, role: "MC" }),
    code("FORBIDDEN"),
  );
});
test("draft invitations can be accepted without exposing the recap or pending credits to other members", async () => {
  const draft = await event({ published: false }),
    credit = await invite("MC", alice, draft);
  await assert.rejects(credits.event(other.id, draft), code("NOT_FOUND"));
  await accept(credit);
  assert.equal(
    (await credits.me(alice.id)).items.find((item) => item.id === credit.id)?.status,
    "accepted",
  );
  assert.equal((await acceptedCreditViews(database, alice.id, draft)).length, 0);
  await db
    .update(base.eventRecords)
    .set({ status: "published" })
    .where(eq(base.eventRecords.postId, draft));
  assert.equal((await acceptedCreditViews(database, other.id, draft)).length, 1);
});
test("credit consent, rejection, correction, withdrawal and manager updates preserve optimistic state", async () => {
  const credit = await invite();
  await assert.rejects(
    credits.decide(other.id, credit.id, {
      expectedUpdatedAt: credit.updatedAt,
      decision: "accept",
    }),
    code("FORBIDDEN"),
  );
  await accept(credit);
  await assert.rejects(
    credits.update(host.id, credit.id, {
      expectedUpdatedAt: credit.updatedAt,
      role: "MC",
      note: "변경",
    }),
    code("CONFLICT"),
  );
  const accepted = (await credits.me(alice.id)).items[0]!;
  await assert.rejects(
    credits.decide(alice.id, credit.id, {
      expectedUpdatedAt: accepted.updatedAt,
      decision: "correction",
    }),
    code("VALIDATION"),
  );
  await credits.decide(alice.id, credit.id, {
    expectedUpdatedAt: accepted.updatedAt,
    decision: "correction",
    note: "역할 설명을 수정해주세요",
  });
  assert.equal((await acceptedCreditViews(database, other.id, postId)).length, 0);
  const correction = (await credits.me(alice.id)).items[0]!;
  await credits.update(host.id, credit.id, {
    expectedUpdatedAt: correction.updatedAt,
    role: "기획자",
    note: "공동 기획 확인",
  });
  const pending = (await credits.me(alice.id)).items[0]!;
  await accept(pending);
  const final = (await credits.me(alice.id)).items[0]!;
  await credits.decide(alice.id, credit.id, {
    expectedUpdatedAt: final.updatedAt,
    decision: "withdraw",
  });
  assert.equal((await acceptedCreditViews(database, other.id, postId)).length, 0);
});
test("two accepted roles in one event count as one contributed event and accepted consent is separate from portfolio opt-in", async () => {
  await accept(await invite("MC"));
  await accept(await invite("기획자"));
  const own = await portfolio.self(alice.id);
  assert.equal(own.summary.contributed, 1);
  assert.equal(own.items[0]?.kind, "event");
  assert.equal((await acceptedCreditViews(database, other.id, postId)).length, 2);
  await assert.rejects(portfolio.view(other.id, alice.publicId), code("NOT_FOUND"));
  await portfolio.updatePreference(alice.id, { visible: true, featuredEventIds: [postId] });
  const shared = await portfolio.view(other.id, alice.publicId);
  assert.equal(shared.summary.contributed, 1);
  assert.equal(shared.featured.length, 1);
  assert.equal(shared.items[0]?.kind === "event" ? shared.items[0].roles.length : 0, 2);
  assert.equal(JSON.stringify(shared).includes(alice.id), false);
  assert.equal(JSON.stringify(shared).includes("01012345678"), false);
});
test("portfolio separates QR and manager attendance; history requires opt-in and stale result corrections remove derived counts", async () => {
  const qr = await attendance(alice, true);
  await attendance(bob);
  let first = await portfolio.self(alice.id, { tab: "participation" });
  assert.equal(first.summary.qrAttended, 1);
  assert.equal(first.summary.managerAttended, 0);
  assert.equal((await portfolio.self(bob.id)).summary.managerAttended, 1);
  await portfolio.updatePreference(alice.id, { visible: true, featuredEventIds: [postId] });
  const hidden = await portfolio.view(other.id, alice.publicId, { tab: "participation" });
  assert.equal(hidden.items.length, 0);
  assert.equal(hidden.featured.length, 0);
  await players.updatePreference(alice.id, {
    preferredRole: "brain",
    matchingVisible: false,
    historyPublic: true,
  });
  const visible = await portfolio.view(other.id, alice.publicId, { tab: "participation" });
  assert.equal(visible.items.length, 1);
  const roster = await players.recordRoster(host.id, postId),
    version = roster.attendees.find((item) => item.applicationId === qr)!.result!.updatedAt;
  await players.recordResult(host.id, postId, {
    applicationId: qr,
    presence: "attended",
    outcome: "won",
    observedRole: "brain",
    reason: "우승 확인",
    expectedUpdatedAt: version,
  });
  await assert.rejects(
    players.recordResult(host.id, postId, {
      applicationId: qr,
      presence: "attended",
      outcome: "participated",
      observedRole: "brain",
      reason: "이전 화면 변경",
      expectedUpdatedAt: version,
    }),
    code("CONFLICT"),
  );
  first = await portfolio.self(alice.id);
  assert.equal(first.summary.wins, 1);
  await assert.rejects(
    players.recordResult(host.id, postId, {
      applicationId: qr,
      presence: "no_show",
      outcome: "participated",
      observedRole: null,
      reason: "QR 참가 삭제",
      expectedUpdatedAt: version,
    }),
    code("CONFLICT"),
  );
  const revisions = await db
    .select()
    .from(recordSchema.eventResultRevisions)
    .where(eq(recordSchema.eventResultRevisions.applicationId, qr));
  assert.equal(revisions.length, 2);
});
test("hosting uses the frozen registered host and real attendance; event ratings do not become contributor ratings", async () => {
  await attendance(alice, true);
  await attendance(bob);
  await operations.writeReview(alice.id, postId, {
    title: "진행이 좋았어요",
    bodyMarkdown: "현장 진행과 게임 구성에 대한 검증된 참가 후기입니다.",
    rating: 4,
  });
  const own = await portfolio.self(host.id);
  assert.equal(own.summary.hosted, 1);
  assert.equal(own.summary.hostAttendeeCount, 2);
  assert.equal(own.summary.hostReviewCount, 1);
  assert.equal(own.summary.hostAverageRating, 4);
  await accept(await invite());
  const contribution = await portfolio.self(alice.id);
  assert.equal(contribution.summary.hostReviewCount, 0);
  assert.equal(contribution.summary.hostAverageRating, null);
  const empty = await event();
  assert.equal((await portfolio.self(host.id)).summary.hosted, 1);
  await assert.rejects(
    portfolio.updatePreference(host.id, { visible: true, featuredEventIds: [empty] }),
    code("VALIDATION"),
  );
});
test("cancelled, sample, moderated, blocked, closed and unofficial sources cannot enter formal portfolio counts", async () => {
  await attendance(alice);
  await portfolio.updatePreference(alice.id, { visible: true, featuredEventIds: [] });
  await db
    .insert(contentRestrictions)
    .values({ targetType: "record", targetId: postId, hidden: true, reason: "검토" });
  assert.equal((await portfolio.self(alice.id)).summary.participated, 0);
  await db.delete(contentRestrictions);
  await db
    .insert(memberBlocks)
    .values({ blockerId: host.id, blockedId: alice.id, displayLabel: "차단" });
  assert.equal((await portfolio.self(alice.id)).summary.participated, 0);
  await db.delete(memberBlocks);
  const cancelled = await event({ formal: false });
  await db
    .update(base.eventSettings)
    .set({ startsAt: new Date("2099-01-01T01:00:00Z"), endsAt: new Date("2099-01-01T03:00:00Z") })
    .where(eq(base.eventSettings.postId, cancelled));
  await eventLifecycleService(database).change(host.id, cancelled, {
    kind: "cancel",
    reason: "행사 취소 확인",
    expectedRevision: 0,
    confirmed: true,
  });
  await db
    .insert(contentRestrictions)
    .values({ targetType: "record", targetId: postId, hidden: true, reason: "검토" });
  assert.equal((await portfolio.self(alice.id)).summary.participated, 0);
  const sample = await event({ sample: true });
  await attendance(alice, false, sample);
  const unofficial = await event({ formal: false });
  await attendance(alice, false, unofficial);
  assert.equal((await portfolio.self(alice.id)).summary.participated, 0);
  await db.insert(memberSafety).values({ userId: alice.id, status: "closed" });
  await assert.rejects(portfolio.self(alice.id), code("FORBIDDEN"));
});
test("library portfolios expose summaries only and keep paid guide content out of responses", async () => {
  await db.insert(libraryEntries).values({
    ownerId: alice.id,
    kind: "rulebook",
    categorySlug: "party",
    title: "유료 운영 자료",
    summary: "누구나 진행할 수 있는 게임을 소개합니다.",
    scenario: "SECRET PAID SCENARIO 충분히 긴 비공개 내용",
    rules: "SECRET RULES 비공개 규칙",
    hostGuide: "SECRET GUIDE 비공개 진행자 가이드",
    materials: [],
    rounds: [{ name: "한 라운드", seconds: 60 }],
    tags: [],
    minPlayers: 2,
    maxPlayers: 10,
    durationMinutes: 60,
    priceKRW: 1000,
    purchaseUrl: "https://example.com/purchase",
  });
  const own = await portfolio.self(alice.id, { tab: "library" });
  assert.equal(own.summary.createdRulebooks, 1);
  assert.equal(own.items.length, 1);
  assert.equal(JSON.stringify(own).includes("SECRET"), false);
});
test("featured selection is bounded and pagination deduplicates events rather than credit roles", async () => {
  for (let index = 0; index < 22; index++) {
    const id = await event();
    await accept(await invite("MC", alice, id));
    await accept(await invite("기획자", alice, id));
  }
  const one = await portfolio.self(alice.id, { tab: "creation", page: 1 }),
    two = await portfolio.self(alice.id, { tab: "creation", page: 2 });
  assert.equal(one.items.length, 20);
  assert.equal(one.hasMore, true);
  assert.equal(two.items.length, 2);
  assert.equal(two.hasMore, false);
  assert.equal(
    new Set(
      [...one.items, ...two.items].map((item) => (item.kind === "event" ? item.postId : item.id)),
    ).size,
    22,
  );
  await assert.rejects(
    portfolio.updatePreference(alice.id, { visible: true, featuredEventIds: [postId, postId] }),
  );
  await assert.rejects(
    portfolio.updatePreference(alice.id, { visible: true, featuredEventIds: [randomUUID()] }),
    code("VALIDATION"),
  );
  await assert.rejects(portfolio.self(null), code("UNAUTHENTICATED"));
});

test("completion and accepted credits survive recap withdrawal and post-attendance financial changes", async () => {
  const applicationId = await attendance(alice, true);
  const credit = await invite();
  await accept(credit);
  await db
    .update(base.eventApplications)
    .set({ status: "cancelled" })
    .where(eq(base.eventApplications.id, applicationId));
  await db
    .update(base.eventRecords)
    .set({ status: "withdrawn" })
    .where(eq(base.eventRecords.postId, postId));
  const own = await portfolio.self(alice.id);
  assert.equal(own.summary.participated, 1);
  assert.equal(own.summary.contributed, 1);
  await portfolio.updatePreference(alice.id, { visible: true, featuredEventIds: [postId] });
  const shared = await portfolio.view(other.id, alice.publicId);
  assert.equal(shared.summary.contributed, 1);
  assert.equal(shared.items[0]?.kind === "event" ? shared.items[0].recordPublished : true, false);
});
