import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as base from "../src/db/schema";
import * as analytics from "../src/db/analytics-schema";
import * as safety from "../src/db/safety-schema";
import { eventResults } from "../src/db/player-schema";
import { eventAdmissions } from "../src/db/event-operations-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { koreanDay, popularityWindow } from "../src/domain/community-time";
import { communityLocation, communityLocationUrl } from "../src/domain/community-location";
import { analyticsService } from "../src/server/analytics-service";
import { communityService } from "../src/server/community-service";
import { safetyService } from "../src/server/safety-service";
import { AppError } from "../src/server/errors";
import { mobileAdAllowedPath, VisibleAdClock } from "../src/lib/mobile-ad-policy";
const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database;
const metrics = analyticsService(connection),
  community = communityService(connection, () => now);
const now = new Date("2026-10-11T05:00:00Z");
let admin: string, owner: string, reader: string;
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
async function member(nickname: string, at = "2026-10-01T01:00:00Z", excluded = false) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db
    .insert(base.profiles)
    .values({ id, nickname, createdAt: new Date(at), analyticsExcluded: excluded });
  return id;
}
async function post(author = owner, kind: "이야기" | "모집" = "이야기", sample = false) {
  const [row] = await db
    .insert(base.posts)
    .values({
      authorId: author,
      categorySlug: "party",
      kind,
      sample,
      title: "예능 모임의 이야기",
      bodyMarkdown: "다 함께 만드는 게임의 진행 방법을 공유해요.",
    })
    .returning();
  return row!;
}
async function like(postId: string, userId: string, at: string) {
  await db.insert(base.postLikes).values({ postId, userId, createdAt: new Date(at) });
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
  await db
    .update(analytics.analyticsState)
    .set({ startedAt: new Date("2026-09-29T00:00:00Z"), cleanedDay: null });
  admin = await member("운영 관리자");
  owner = await member("행사 작성자");
  reader = await member("참가 회원");
  await db.insert(safety.staffRoles).values({ userId: admin, role: "admin" });
});
after(() => pg.close());
test("Korean today/week boundaries use Monday midnight including Sunday and UTC date rollover", () => {
  assert.equal(koreanDay(new Date("2026-10-11T15:00:00Z")), "2026-10-12");
  assert.equal(popularityWindow("today", now)?.start.toISOString(), "2026-10-10T15:00:00.000Z");
  assert.equal(popularityWindow("week", now)?.start.toISOString(), "2026-10-04T15:00:00.000Z");
  assert.equal(
    popularityWindow("week", new Date("2026-10-11T15:00:00Z"))?.start.toISOString(),
    "2026-10-11T15:00:00.000Z",
  );
  assert.equal(popularityWindow("all", now), null);
});
test("only active admins can read aggregate metrics; clients cannot supply unbounded periods", async () => {
  await assert.rejects(metrics.summary(null), code("UNAUTHENTICATED"));
  await assert.rejects(metrics.summary(reader), code("FORBIDDEN"));
  await db.insert(safety.staffRoles).values({ userId: reader, role: "moderator" });
  await assert.rejects(metrics.summary(reader), code("FORBIDDEN"));
  await assert.rejects(metrics.summary(admin, { days: 365 }));
  await db.insert(safety.memberSafety).values({ userId: admin, status: "closed" });
  await assert.rejects(metrics.summary(admin), code("FORBIDDEN"));
});
test("daily collection deduplicates, crosses Korean midnight, excludes test/staff and purges expired dates", async () => {
  const excluded = await member("테스트 계정", undefined, true);
  await metrics.collect(reader, now);
  await metrics.collect(reader, now);
  await metrics.collect(reader, new Date("2026-10-11T15:00:00Z"));
  await metrics.collect(admin, now);
  await metrics.collect(excluded, now);
  await metrics.collect(null, now);
  assert.equal((await db.select().from(analytics.analyticsActivityDays)).length, 2);
  await db.insert(analytics.analyticsActivityDays).values({ userId: reader, day: "2026-01-01" });
  await metrics.collect(reader, new Date("2026-10-12T15:00:00Z"));
  assert.equal((await db.select().from(analytics.analyticsActivityDays)).length, 3);
});
test("cohorts exclude incomplete observation, historical visits, operator/test/withdrawn members; DTO contains no IDs", async () => {
  await member("새 가입자", "2026-10-10T00:00:00Z");
  await member("샘플 가입자", undefined, true);
  const closed = await member("탈퇴 가입자");
  await db.insert(safety.memberSafety).values({ userId: closed, status: "closed" });
  const article = await post();
  await db
    .insert(base.bookmarks)
    .values({ userId: reader, postId: article.id, createdAt: new Date("2026-10-02T00:00:00Z") });
  await metrics.collect(reader, new Date("2026-10-02T00:00:00Z"));
  await metrics.collect(reader, new Date("2026-10-03T00:00:00Z"));
  const report = await metrics.summary(admin, { days: 28 }, now);
  assert.equal(report.counts.registrations, 3);
  assert.equal(report.counts.excluded, 3);
  assert.equal(report.counts.action_denominator, 2);
  assert.equal(report.counts.activated, 1);
  assert.equal(report.counts.return_denominator, 2);
  assert.equal(report.counts.returned, 1);
  assert.equal(report.counts.repeat_members, 1);
  for (const secret of [reader, admin, owner, "연락처", "bodyMarkdown"])
    assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(report.repeatCoverageComplete, false);
  await db.update(analytics.analyticsState).set({ startedAt: new Date("2026-10-02T00:00:00Z") });
  assert.equal((await metrics.summary(admin, { days: 28 }, now)).counts.return_denominator, 0);
  const weekly = await metrics.summary(admin, { days: 7 }, now);
  assert.equal(weekly.counts.action_denominator, 2);
  assert.equal(weekly.signupCohort.start, "2026-09-26T15:00:00.000Z");
  assert.equal(weekly.signupCohort.end, "2026-10-03T15:00:00.000Z");
});
test("formal completed attendance counts QR + manager once, excludes no-show and sample; refund does not erase attendance", async () => {
  const event = await post(owner, "모집");
  const completedAt = new Date("2026-10-02T05:00:00Z");
  await db.insert(base.eventSettings).values({
    postId: event.id,
    amountKRW: 0,
    capacity: 5,
    open: true,
    startsAt: new Date("2026-10-01T00:00:00Z"),
    endsAt: new Date("2026-10-02T00:00:00Z"),
  });
  const manual = await member("담당 확인 참가자"),
    absent = await member("미참석 참가자");
  const participants = [reader, manual, absent];
  for (const [index, userId] of participants.entries()) {
    const [app] = await db
      .insert(base.eventApplications)
      .values({
        postId: event.id,
        userId,
        attendeeName: "참가자",
        contact: "01012345678",
        amountKRW: 0,
        status: "confirmed",
        expiresAt: new Date("2026-10-01T03:00:00Z"),
        confirmedAt: completedAt,
        createdAt: new Date("2026-10-01T02:00:00Z"),
      })
      .returning();
    await db.insert(eventResults).values({
      applicationId: app!.id,
      postId: event.id,
      userId,
      recorderId: owner,
      presence: index === 2 ? "no_show" : "attended",
    });
    if (index === 0)
      await db
        .insert(eventAdmissions)
        .values({ applicationId: app!.id, postId: event.id, userId, checkedBy: owner });
  }
  await db
    .update(base.eventApplications)
    .set({ status: "refunded" })
    .where(eq(base.eventApplications.userId, reader));
  await db
    .update(base.eventSettings)
    .set({ open: false, completedAt, completedBy: owner })
    .where(eq(base.eventSettings.postId, event.id));
  await db.insert(base.eventRecords).values({
    postId: event.id,
    ownerId: owner,
    completedAt,
    publishedAt: new Date("2026-10-04T00:00:00Z"),
    status: "published",
    snapshot: {
      title: event.title,
      category: "party",
      location: "서울",
      startsAt: null,
      endsAt: null,
      hostPublicId: null,
      hostNickname: "진행자",
      template: null,
    },
  });
  const c = (await metrics.summary(admin, { days: 28 }, now)).counts;
  assert.equal(c.completed_events, 1);
  assert.equal(c.attended, 2);
  assert.equal(c.qr_attended, 1);
  assert.equal(c.manager_attended, 1);
  assert.equal(c.record_denominator, 1);
  assert.equal(c.published, 1);
  assert.equal(c.applications, 3);
  assert.equal(c.confirmations, 3);
  await db.update(base.posts).set({ sample: true }).where(eq(base.posts.id, event.id));
  const excluded = (await metrics.summary(admin, { days: 28 }, now)).counts;
  assert.equal(excluded.completed_events, 0);
  assert.equal(excluded.attended, 0);
  assert.equal(excluded.applications, 0);
});
test("withdrawal removes daily activity and cannot re-collect it", async () => {
  await metrics.collect(reader, now);
  await safetyService(connection).withdraw(reader);
  assert.equal((await db.select().from(analytics.analyticsActivityDays)).length, 0);
  assert.equal((await metrics.collect(reader, now)).collected, false);
});
test("period ranking counts likes within the fixed Korean window, not the post date or lifetime", async () => {
  const old = await post(),
    recent = await post(),
    empty = await post();
  await like(old.id, reader, "2026-10-10T14:59:59.999Z");
  await like(old.id, admin, "2026-10-09T00:00:00Z");
  await like(recent.id, reader, "2026-10-10T15:00:00Z");
  const rankingAt = now.toISOString();
  const daily = await community.feed(null, {
    sort: "popular",
    period: "today",
    rankingAt,
    page: 1,
    limit: 20,
  });
  assert.deepEqual(
    daily.posts.map((p) => p.id),
    [recent.id],
  );
  assert.equal(daily.posts[0]!.popularityScore, 1);
  const weekly = await community.feed(null, {
    sort: "popular",
    period: "week",
    rankingAt,
    page: 1,
  });
  assert.equal(weekly.posts[0]!.id, old.id);
  assert.equal(
    weekly.posts.some((p) => p.id === empty.id),
    false,
  );
  const all = await community.feed(null, { sort: "popular", period: "all", page: 1 });
  assert.equal(all.posts[0]!.id, old.id);
});
test("period pages and cursors preserve ranking time, visibility, blocking and anonymous identities", async () => {
  const ids: string[] = [];
  for (let i = 0; i < 23; i++) {
    const p = await post();
    ids.push(p.id);
    await like(p.id, reader, "2026-10-11T00:00:00Z");
  }
  const q = {
    sort: "popular" as const,
    period: "today" as const,
    rankingAt: now.toISOString(),
    limit: 20,
  };
  const first = await community.feed(reader, q);
  const second = await community.feed(reader, { ...q, cursor: first.nextCursor! });
  assert.equal(first.posts.length, 20);
  assert.equal(second.posts.length, 3);
  assert.equal(new Set([...first.posts, ...second.posts].map((p) => p.id)).size, 23);
  await assert.rejects(
    community.feed(reader, { ...q, period: "week", cursor: first.nextCursor! }),
    code("VALIDATION"),
  );
  await assert.rejects(
    community.feed(reader, { sort: "popular", period: "today", cursor: first.nextCursor! }),
    code("VALIDATION"),
  );
  const numbered = await community.feed(reader, { ...q, page: 2 });
  assert.deepEqual(
    numbered.posts.map((p) => p.id),
    second.posts.map((p) => p.id),
  );
  await db
    .insert(safety.contentRestrictions)
    .values({ targetType: "post", targetId: ids[0]!, reason: "운영 확인 중" });
  assert.equal((await community.feed(reader, { ...q, page: 1 })).pagination?.totalItems, 22);
  await db
    .insert(safety.memberBlocks)
    .values({ blockerId: reader, blockedId: owner, displayLabel: "작성자" });
  assert.equal((await community.feed(reader, { ...q, page: 1 })).pagination?.totalItems, 0);
  assert.equal(JSON.stringify(first.posts).includes(owner), false);
});
test("future anchors are rejected, test/closed likes and post-future likes cannot rank", async () => {
  const p = await post(),
    excluded = await member("제외 테스트", undefined, true);
  await like(p.id, excluded, "2026-10-11T00:00:00Z");
  await like(p.id, reader, "2026-10-11T06:00:00Z");
  const q = {
    sort: "popular" as const,
    period: "today" as const,
    rankingAt: now.toISOString(),
    page: 1,
  };
  assert.equal((await community.feed(null, q)).posts.length, 0);
  await assert.rejects(
    community.feed(null, { ...q, rankingAt: "2100-01-01T00:00:00Z" }),
    code("VALIDATION"),
  );
});
test("listing URLs round-trip periods and page without overwriting post/deep link state", () => {
  const query = {
    kind: "모집" as const,
    sort: "popular" as const,
    period: "week" as const,
    rankingAt: now.toISOString(),
  };
  const relative = communityLocationUrl("https://sliper.example/stories?post=one#feed", query, 2);
  const url = new URL(relative, "https://sliper.example");
  const parsed = communityLocation(url.searchParams, true, now.getTime());
  assert.equal(parsed.kind, "모집");
  assert.equal(parsed.period, "week");
  assert.equal(parsed.page, 2);
  assert.equal(parsed.rankingAt, now.toISOString());
  assert.equal(url.searchParams.get("post"), "one");
  assert.equal(url.hash, "#feed");
  assert.equal(communityLocation(new URLSearchParams("page=-2&period=invalid")).page, 1);
});
test("mobile ads wait 30 eligible seconds and exclude task routes/hidden-time gaps", () => {
  for (const path of [
    "/login",
    "/signup",
    "/management/events/one",
    "/events/one",
    "/rooms/one",
    "/archive/new",
    "/posts/one/edit",
    "/events/one/check-in",
  ])
    assert.equal(mobileAdAllowedPath(path), false, path);
  for (const path of ["/", "/stories", "/lightning", "/archive", "/records"])
    assert.equal(mobileAdAllowedPath(path), true);
  const clock = new VisibleAdClock();
  assert.equal(clock.tick(0, true), false);
  for (let i = 1; i <= 20; i++) assert.equal(clock.tick(i * 1000, true), false);
  clock.tick(20000, false);
  clock.tick(80000, true);
  for (let i = 1; i < 10; i++) assert.equal(clock.tick(80000 + i * 1000, true), false);
  assert.equal(clock.tick(90000, true), true);
});
