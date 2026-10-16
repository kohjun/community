import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as base from "../src/db/schema";
import { eventAdmissions, verifiedEventReviews } from "../src/db/event-operations-schema";
import { eventResults } from "../src/db/player-schema";
import { staffRoles } from "../src/db/safety-schema";
import { libraryVersions, templateProvenance } from "../src/db/library-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { libraryInputSchema } from "../src/domain/library";
import { eventOperationsService } from "../src/server/event-operations-service";
import { eventAftercareService } from "../src/server/event-aftercare-service";
import { communityService } from "../src/server/community-service";
import { playerService } from "../src/server/player-service";
import { portfolioService } from "../src/server/portfolio-service";
import { recordService } from "../src/server/record-service";
import { libraryService } from "../src/server/library-service";
import { libraryEvidenceService } from "../src/server/library-evidence-service";
import { analyticsService } from "../src/server/analytics-service";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database;
const operations = eventOperationsService(connection),
  aftercare = eventAftercareService(connection),
  community = communityService(connection),
  records = recordService(connection),
  players = playerService(connection),
  portfolio = portfolioService(connection);
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
const review = {
  title: "참가 인증 후기",
  bodyMarkdown: "현장에서 직접 경험한 미션과 진행 방식을 자세히 남깁니다.",
  rating: 5,
};
let host: { id: string; publicId: string },
  alice: { id: string; publicId: string },
  bob: { id: string; publicId: string },
  admin: { id: string; publicId: string };
const ended = () => new Date(Date.now() - 60000);
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  const [row] = await db
    .insert(base.profiles)
    .values({ id, nickname })
    .returning({ id: base.profiles.id, publicId: base.profiles.publicId });
  return row!;
}
async function event(endsAt = ended()) {
  const [post] = await db
    .insert(base.posts)
    .values({
      authorId: host.id,
      kind: "모집",
      categorySlug: "party",
      title: "참가 확인 정책 검증 행사",
      bodyMarkdown: "행사 종료 이후 후기와 전적을 같은 정책으로 확인합니다.",
    })
    .returning();
  await db.insert(base.eventSettings).values({
    postId: post!.id,
    startsAt: new Date(endsAt.getTime() - 3600000),
    endsAt,
    amountKRW: 0,
    capacity: 20,
    open: true,
  });
  return post!.id;
}
async function application(postId: string, user = alice, qr = true) {
  const [row] = await db
    .insert(base.eventApplications)
    .values({
      postId,
      userId: user.id,
      attendeeName: "참가자",
      contact: "private-test-contact",
      amountKRW: 0,
      status: "confirmed",
      confirmedAt: new Date(),
      expiresAt: new Date(Date.now() + 1800000),
    })
    .returning();
  if (qr)
    await db.insert(eventAdmissions).values({
      applicationId: row!.id,
      postId,
      userId: user.id,
      checkedBy: user.id === host.id ? bob.id : host.id,
    });
  return row!.id;
}
async function legacyResult(
  postId: string,
  applicationId: string,
  user = alice,
  presence: "attended" | "no_show" = "no_show",
) {
  await db
    .insert(eventResults)
    .values({ postId, applicationId, userId: user.id, recorderId: host.id, presence });
}
async function restoreAttendance(postId: string, applicationId: string) {
  const roster = await players.recordRoster(host.id, postId),
    row = roster.attendees.find((item) => item.applicationId === applicationId)!;
  await players.recordResult(host.id, postId, {
    applicationId,
    expectedUpdatedAt: row.result!.updatedAt,
    presence: "attended",
    outcome: "participated",
    observedRole: null,
    reason: "참가 확인 근거를 다시 확인해 실제 참석으로 정정합니다.",
  });
}
async function publishRecord(postId: string) {
  await operations.finalize(host.id, postId);
  const draft = await records.detail(host.id, postId);
  const saved = await records.save(host.id, postId, {
    expectedUpdatedAt: draft.updatedAt,
    purpose: "참가자가 직접 몰입할 수 있는 체험 행사를 운영합니다.",
    execution: "함께 미션을 해결하고 실제 참가 경험을 자세히 기록했습니다.",
    highlights: "",
    improvements: "",
    bodyDocument: {
      version: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "현장의 기록과 실제 진행 내용을 충분히 남깁니다." }],
        },
      ],
    },
    relatedPostIds: [],
    libraryIds: [],
  });
  return records.publish(host.id, postId, { expectedUpdatedAt: saved.updatedAt, published: true });
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
  host = await member("주최자");
  alice = await member("QR 참가자");
  bob = await member("다른 참가자");
  admin = await member("관리자");
  await db.insert(staffRoles).values({ userId: admin.id, role: "admin" });
});
after(() => pg.close());

test("historical no-show corrections deny review reads and writes; restoring attendance re-enables one review before formal completion", async () => {
  const postId = await event(),
    applicationId = await application(postId);
  await legacyResult(postId, applicationId);
  assert.equal((await operations.reviews(alice.id, postId)).canReview, false);
  assert.equal((await aftercare.list(alice.id, { scope: "participation", view: "all" })).total, 0);
  await assert.rejects(operations.writeReview(alice.id, postId, review), code("FORBIDDEN"));
  assert.equal((await db.select().from(verifiedEventReviews)).length, 0);
  assert.equal((await db.select().from(base.posts)).length, 1);
  await restoreAttendance(postId, applicationId);
  assert.equal((await db.select().from(base.eventRecords)).length, 0);
  assert.equal((await operations.reviews(alice.id, postId)).canReview, true);
  const tasks = await aftercare.list(alice.id, { scope: "participation" });
  assert.equal(tasks.total, 1);
  assert.equal(tasks.items[0]!.stage, "review");
  const created = await operations.writeReview(alice.id, postId, review);
  assert.equal(created.reviews.length, 1);
  assert.equal(created.canReview, false);
  assert.equal((await db.select().from(base.eventRecords)).length, 0);
  await assert.rejects(operations.writeReview(alice.id, postId, review), code("CONFLICT"));
  assert.equal((await db.select().from(verifiedEventReviews)).length, 1);
});

test("a no-show correction removes existing certification from event, post, record, portfolio, library and metrics without deleting the review", async () => {
  const content = libraryInputSchema.parse({
    kind: "template",
    categorySlug: "party",
    title: "유료 운영 자료",
    summary: "현장 운영 사례를 확인할 수 있는 유료 자료입니다.",
    scenario: "참가자들이 서로 협력해 주어진 미션을 해결하는 체험 게임 시나리오입니다.",
    rules: "정해진 순서를 지키고 팀원과 함께 미션을 해결합니다.",
    hostGuide: "진행자는 시간을 안내하고 참가자의 진행을 공정하게 확인합니다.",
    materials: [],
    rounds: [{ name: "전체 진행", seconds: 3600 }],
    tags: [],
    minPlayers: 2,
    maxPlayers: 20,
    durationMinutes: 60,
    priceKRW: 1000,
    purchaseUrl: "https://example.invalid/buy",
  });
  const entry = await libraryService(connection).create(host.id, content),
    [version] = await db
      .select()
      .from(libraryVersions)
      .where(eq(libraryVersions.entryId, entry.id));
  const postId = await event(),
    applicationId = await application(postId),
    otherApplicationId = await application(postId, bob, false);
  await legacyResult(postId, otherApplicationId, bob, "attended");
  await db.insert(templateProvenance).values({
    postId,
    entryId: entry.id,
    versionId: version!.id,
    snapshot: {
      ...content,
      category: content.categorySlug,
      author: "주최자",
      authorPublicId: host.publicId,
      sourceId: entry.id,
      versionId: version!.id,
      versionNumber: 1,
    },
  });
  const created = await operations.writeReview(alice.id, postId, review),
    reviewId = created.ownReviewPostId!;
  await publishRecord(postId);
  async function proof(expected: number) {
    const eventView = await operations.reviews(alice.id, postId),
      post = await community.getPost(reviewId, alice.id),
      record = await records.detail(host.id, postId),
      career = await portfolio.self(host.id),
      evidence = await libraryEvidenceService(connection).list(bob.id, entry.id),
      metrics = await analyticsService(connection).summary(
        admin.id,
        { days: 7 },
        new Date(Date.now() + 1000),
      );
    assert.equal(eventView.reviews.length, expected);
    assert.equal(!!post.verifiedParticipation, expected === 1);
    assert.equal(record.reviews.length, expected);
    assert.equal(record.reviewCount, expected);
    assert.equal(record.averageRating, expected ? 5 : null);
    assert.equal(career.summary.hostReviewCount, expected);
    assert.equal(career.summary.hostAverageRating, expected ? 5 : null);
    assert.equal(evidence.items[0]!.reviewCount, expected);
    assert.equal(evidence.items[0]!.averageRating, expected ? 5 : null);
    assert.equal((await libraryService(connection).detail(bob.id, entry.id)).payload, null);
    assert.equal(metrics.counts.verified_reviews, expected);
    assert.equal(post.title, review.title);
    assert.equal((await db.select().from(verifiedEventReviews)).length, 1);
  }
  await proof(1);
  // Old persisted corrections are authoritative even if a QR row still remains.
  await db
    .update(eventResults)
    .set({ presence: "no_show", reason: "이전 데이터의 미참석 정정 상태 확인" })
    .where(eq(eventResults.applicationId, applicationId));
  await proof(0);
  await restoreAttendance(postId, applicationId);
  await proof(1);
  await assert.rejects(operations.writeReview(alice.id, postId, review), code("CONFLICT"));
});

test("post-attendance refunds preserve existing reviews and attendance while forbidding a new review", async () => {
  const postId = await event(),
    applicationId = await application(postId),
    otherApplicationId = await application(postId, bob);
  const created = await operations.writeReview(alice.id, postId, review);
  await publishRecord(postId);
  await db
    .update(base.eventApplications)
    .set({ status: "refunded" })
    .where(eq(base.eventApplications.id, applicationId));
  await db
    .update(base.eventApplications)
    .set({ status: "refunded" })
    .where(eq(base.eventApplications.id, otherApplicationId));
  const existing = await operations.reviews(alice.id, postId),
    notWritten = await operations.reviews(bob.id, postId);
  assert.equal(existing.reviews.length, 1);
  assert.equal(existing.canReview, false);
  assert.equal(notWritten.canReview, false);
  assert.equal(
    !!(await community.getPost(created.ownReviewPostId!, alice.id)).verifiedParticipation,
    true,
  );
  const tasks = await aftercare.list(bob.id, { scope: "participation", view: "all" });
  assert.equal(tasks.items.length, 1);
  assert.equal(tasks.items[0]!.pending, false);
  assert.equal((await aftercare.list(bob.id, { scope: "participation" })).total, 0);
  await assert.rejects(operations.writeReview(bob.id, postId, review), code("FORBIDDEN"));
  const record = await records.detail(host.id, postId);
  assert.equal(record.attended, 2);
  assert.equal(record.reviewCount, 1);
  assert.equal((await portfolio.self(host.id)).summary.hostReviewCount, 1);
});

test("hosts, manual-only attendance and events that have not ended never gain review controls or certification", async () => {
  const postId = await event();
  await application(postId, host);
  const manual = await application(postId, bob, false);
  await legacyResult(postId, manual, bob, "attended");
  assert.equal((await operations.reviews(host.id, postId)).canReview, false);
  assert.equal((await operations.reviews(bob.id, postId)).canReview, false);
  await assert.rejects(operations.writeReview(host.id, postId, review), code("FORBIDDEN"));
  await assert.rejects(operations.writeReview(bob.id, postId, review), code("FORBIDDEN"));
  assert.equal((await aftercare.list(bob.id, { scope: "participation" })).total, 0);
  assert.equal(
    (await aftercare.list(bob.id, { scope: "participation", view: "all" })).items.length,
    1,
  );
  const future = await event(new Date(Date.now() + 3600000));
  await application(future);
  assert.equal((await operations.reviews(alice.id, future)).canReview, false);
  await assert.rejects(operations.writeReview(alice.id, future, review), code("CONFLICT"));
  assert.equal((await aftercare.list(alice.id, { scope: "participation" })).total, 0);
  assert.equal((await db.select().from(verifiedEventReviews)).length, 0);
});
