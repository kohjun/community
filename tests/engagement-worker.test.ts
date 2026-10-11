import assert from "node:assert/strict";
import { test } from "node:test";
import { reminderDedupe, reminderStage } from "../src/server/engagement-worker";
import { pushPreferencesSchema } from "../src/domain/push";
import { safePushPath } from "../src/server/push-validation";

const starts = new Date("2026-11-10T03:00:00+09:00");
const early = new Date(starts.getTime() - 48 * 3600000);
const hoursBefore = (hours: number) => new Date(starts.getTime() - hours * 3600000);

test("reminders use the event instant across Korean calendar dates", () => {
  assert.equal(reminderStage(starts, early, hoursBefore(25)), null);
  assert.equal(reminderStage(starts, early, hoursBefore(24)), "24h");
  assert.equal(reminderStage(starts, early, hoursBefore(8)), "24h");
  assert.equal(reminderStage(starts, early, hoursBefore(2)), "2h");
  assert.equal(reminderStage(starts, early, hoursBefore(0.1)), "2h");
  assert.equal(reminderStage(starts, early, starts), null);
  assert.equal(reminderStage(starts, early, hoursBefore(-1)), null);
});
test("late joins never replay a passed reminder and worker recovery selects only the latest stage", () => {
  assert.equal(reminderStage(starts, hoursBefore(5), hoursBefore(4)), null);
  assert.equal(reminderStage(starts, hoursBefore(5), hoursBefore(2)), "2h");
  assert.equal(reminderStage(starts, hoursBefore(1.9), hoursBefore(1)), null);
  assert.equal(reminderStage(starts, hoursBefore(2), hoursBefore(2)), "2h");
});
test("rescheduled or revised events produce distinct reminder keys and repeated scans remain identical", () => {
  const id = "d4943e8c-1ca0-4fbe-bf79-f7a9e188b58a";
  const key = reminderDedupe(id, starts, 0, "24h");
  assert.equal(reminderDedupe(id, new Date(starts), 0, "24h"), key);
  assert.notEqual(reminderDedupe(id, starts, 1, "24h"), key);
  assert.notEqual(reminderDedupe(id, new Date(starts.getTime() + 3600000), 0, "24h"), key);
  assert.notEqual(reminderDedupe(id, starts, 0, "2h"), key);
});
test("old push clients can omit new preferences without assigning their saved settings", () => {
  assert.deepEqual(
    pushPreferencesSchema.parse({ comments: true, announcements: false, participation: true }),
    { comments: true, announcements: false, participation: true },
  );
  assert.equal(
    pushPreferencesSchema.safeParse({
      comments: true,
      announcements: true,
      participation: true,
      reminders: "yes",
    }).success,
    false,
  );
});
test("unified inbox push links remain local and reject open redirects", () => {
  assert.equal(safePushPath("/notifications"), true);
  for (const value of [
    "//evil.example/notifications",
    "https://evil.example/notifications",
    "/notifications?next=https://evil.example",
    "/notifications\\x",
  ])
    assert.equal(safePushPath(value), false);
});

test("a malformed fanout source is isolated, retried with backoff and cannot block a valid comment", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const { randomUUID } = await import("node:crypto");
  const { eq } = await import("drizzle-orm");
  const { categories, notifications } = await import("../src/db/schema");
  const { engagementJobs, inboxItems } = await import("../src/db/engagement-schema");
  const { CATEGORIES } = await import("../src/domain/categories");
  const { communityService } = await import("../src/server/community-service");
  const pg = new PGlite(),
    raw = drizzle(pg),
    db = raw as unknown as import("../src/db/connection").Database;
  try {
    await pg.exec(
      "create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated;",
    );
    await migrate(raw, { migrationsFolder: "./drizzle" });
    await raw.insert(categories).values([...CATEGORIES]);
    const owner = randomUUID(),
      writer = randomUUID();
    for (const [id, nickname] of [
      [owner, "테스트 주최자"],
      [writer, "테스트 댓글 작성자"],
    ]) {
      await pg.query("insert into auth.users values($1)", [id]);
      await pg.query(
        "insert into sliper.profiles(id,nickname,phone_number,profile_completed_at,onboarding_consent_at) values($1,$2,'01012345678',now(),now())",
        [id, nickname],
      );
    }
    const community = communityService(db);
    const post = await community.createPost(owner, {
      categorySlug: "party",
      kind: "이야기",
      title: "격리 검증 글",
      bodyMarkdown: "본문",
      isAnonymous: false,
      imageAssetIds: [],
    });
    await community.createComment(writer, { postId: post.id, bodyMarkdown: "실제 댓글" });
    const [source] = await raw.select().from(notifications);
    assert.ok(source);
    let now = new Date();
    const [poison] = await raw
      .insert(engagementJobs)
      .values({
        kind: "comment",
        sourceKey: "malformed:" + randomUUID(),
        postId: post.id,
        sourceId: source.commentId,
        payload: { recipientId: "invalid" },
        createdAt: new Date(now.getTime() - 3600000),
        availableAt: new Date(now.getTime() - 3600000),
      })
      .returning();
    const worker = (await import("../src/server/engagement-worker")).engagementWorker(
      db,
      () => now,
    );
    const first = await worker.processJobs();
    assert.equal(first.inboxCreated, 1);
    assert.equal((await raw.select().from(inboxItems)).length, 1);
    let [failed] = await raw.select().from(engagementJobs).where(eq(engagementJobs.id, poison!.id));
    assert.equal(failed!.attempts, 1);
    assert.equal(failed!.lastError, "SOURCE_PROCESSING_FAILED");
    assert.equal(failed!.completedAt, null);
    assert.ok(failed!.availableAt.getTime() > now.getTime());
    assert.equal((await worker.processJobs()).jobsProcessed, 0);
    for (let i = 1; i < 6; i++) {
      now = new Date(failed!.availableAt);
      await worker.processJobs();
      [failed] = await raw.select().from(engagementJobs).where(eq(engagementJobs.id, poison!.id));
    }
    assert.equal(failed!.attempts, 6);
    assert.equal(failed!.lastError, "SOURCE_RETRIES_EXHAUSTED");
    assert.ok(failed!.completedAt);
    assert.equal((await raw.select().from(inboxItems)).length, 1);
  } finally {
    await pg.close();
  }
});
