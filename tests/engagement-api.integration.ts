import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { eq, inArray, sql } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import {
  profiles,
  posts,
  eventSettings,
  eventApplications,
  roomMessages,
  comments,
  notifications,
} from "../src/db/schema";
import { memberBlocks } from "../src/db/safety-schema";
import { engagementService } from "../src/server/engagement-service";
import { engagementWorker } from "../src/server/engagement-worker";
import { eventLifecycleService } from "../src/server/event-lifecycle-service";
import { createLocalTestSession, loadLocalTestAccount } from "../src/server/local-test-auth";
import type { ActionResult } from "../src/domain/contracts";
import type { UnifiedInboxPage, SubscriptionSettings } from "../src/domain/engagement";

const origin = "http://127.0.0.1:3000";
const url = new URL(process.env.DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  process.env.APP_ORIGIN !== origin ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.pathname !== "/sliper_dev"
)
  throw new Error("Engagement integration checks require the isolated local development database.");
const account = loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
if (!account)
  throw new Error("Set up the existing local test account before engagement HTTP checks.");
const cookie = "sliper_test_session=" + createLocalTestSession(account, "127.0.0.1:3000");
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  session = cookie,
  from = origin,
) {
  const response = await fetch(origin + path, {
    method,
    headers: { Origin: from, "Content-Type": "application/json", Cookie: session },
    body: body === undefined ? null : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  return { status: response.status, result: (await response.json()) as ActionResult<T> };
}
function data<T>(response: { status: number; result: ActionResult<T> }) {
  assert.equal(response.status, 200);
  assert.ok(response.result.ok, "Engagement API returned an error.");
  return response.result.data;
}

test("private subscription and inbox API reject anonymous actors, foreign origins and forged read receipts", async () => {
  for (const path of ["/inbox", "/subscriptions", "/hosts/" + randomUUID()])
    assert.equal(
      (await api("/api/engagement" + path, "GET", undefined, "sliper_test_session=invalid")).status,
      401,
    );
  assert.equal(
    (
      await api(
        "/api/engagement/subscriptions/categories",
        "PUT",
        { categories: [] },
        cookie,
        "https://untrusted.example.invalid",
      )
    ).status,
    403,
  );
  assert.equal((await api("/api/engagement/inbox/read", "POST", { id: randomUUID() })).status, 404);
  assert.equal((await api("/api/engagement/inbox?kind=invalid")).status, 400);
  assert.equal(
    (await api("/api/engagement/subscriptions/categories", "PUT", { categories: ["unknown"] }))
      .status,
    400,
  );
  const inbox = data(await api<UnifiedInboxPage>("/api/engagement/inbox"));
  const unread = data(await api<UnifiedInboxPage>("/api/engagement/inbox?unreadOnly=true&limit=6"));
  assert.ok(unread.items.length <= 6);
  assert.ok(unread.items.every((item) => item.readAt === null));
  assert.equal((await api("/api/engagement/inbox?unreadOnly=yes")).status, 400);
  const subscriptions = data(await api<SubscriptionSettings>("/api/engagement/subscriptions"));
  assert.equal(typeof inbox.unreadCount, "number");
  assert.ok(Array.isArray(inbox.items));
  assert.ok(Array.isArray(subscriptions.categories));
  assert.equal(
    JSON.stringify({ inbox, subscriptions }).includes(account.userId),
    false,
    "Authentication subjects stay private.",
  );
});

test("durable subscriptions, legacy read bridges and schedule-aware reminders are isolated and idempotent", async () => {
  const connection = createDatabase(url.toString(), 2),
    db = connection.db;
  const host = randomUUID(),
    member = randomUUID(),
    hostOnly = randomUUID();
  const actors = [host, member, hostOnly],
    fixturePosts: string[] = [];
  const service = engagementService(db);
  async function flushJobs() {
    // The embedded worker can hold fixture rows via SKIP LOCKED. Zero claimed jobs
    // does not mean delivery finished; wait for this fixture's durable jobs instead.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      await engagementWorker(db, () => new Date(Date.now() + 1000)).processJobs(100);
      const result = await db.execute(sql`select count(*)::int pending
        from sliper.engagement_jobs where completed_at is null
        and post_id in (${sql.join(
          fixturePosts.map((id) => sql`${id}::uuid`),
          sql`,`,
        )})`);
      assert.ok(Array.isArray(result));
      if ((result[0] as { pending: number }).pending === 0) return;
      await delay(50);
    }
    assert.fail("Fixture notification jobs did not finish within 10 seconds.");
  }
  async function recruit(anonymous = false) {
    return db.transaction(async (tx) => {
      const [post] = await tx
        .insert(posts)
        .values({
          authorId: host,
          categorySlug: "party",
          kind: "모집",
          title: "구독 검사용 행사 " + randomUUID(),
          bodyMarkdown: "알림과 참가 일정을 검증하는 임시 행사입니다.",
          isAnonymous: anonymous,
        })
        .returning();
      fixturePosts.push(post!.id);
      await tx.insert(eventSettings).values({
        postId: post!.id,
        amountKRW: 0,
        capacity: 5,
        open: true,
        startsAt: new Date(Date.now() + 48 * 3600000),
        endsAt: new Date(Date.now() + 50 * 3600000),
      });
      return post!;
    });
  }
  try {
    for (const actor of actors) {
      await db.execute(sql`insert into auth.users(id) values(${actor}::uuid)`);
      await db.insert(profiles).values({ id: actor, nickname: "검사" + actor.slice(0, 8) });
    }
    const [publicHost] = await db
      .select({ id: profiles.publicId })
      .from(profiles)
      .where(eq(profiles.id, host));
    const publicId = publicHost!.id;
    await service.updateCategories(member, { categories: ["party"] });
    await service.updateHost(member, publicId, { subscribed: true });
    await service.updateHost(hostOnly, publicId, { subscribed: true });
    await service.updateHost(member, publicId, { subscribed: true });
    assert.equal((await service.subscriptions(member)).hosts.length, 1);
    await assert.rejects(service.updateHost(host, publicId, { subscribed: true }));
    await assert.rejects(service.updateCategories(member, { categories: ["party", "party"] }));
    const post = await recruit();
    await flushJobs();
    let inbox = await service.inbox(member, { kind: "subscriptions" });
    assert.equal(
      inbox.items.filter((item) => item.url.includes(post.id)).length,
      1,
      "Category and host subscriptions coalesce.",
    );
    assert.equal(
      (await service.inbox(hostOnly, { kind: "subscriptions" })).items.filter((item) =>
        item.url.includes(post.id),
      ).length,
      1,
    );
    const anonymous = await recruit(true);
    await flushJobs();
    assert.equal(
      (await service.inbox(hostOnly, { kind: "subscriptions" })).items.some((item) =>
        item.url.includes(anonymous.id),
      ),
      false,
      "Anonymous authors never reveal their host subscription identity.",
    );
    assert.equal(
      (await service.inbox(member, { kind: "subscriptions" })).items.filter((item) =>
        item.url.includes(anonymous.id),
      ).length,
      1,
    );
    assert.equal(JSON.stringify(await service.inbox(member)).includes(host), false);
    const firstPage = await service.inbox(member, { kind: "subscriptions", limit: 1 });
    assert.equal(firstPage.items.length, 1);
    assert.ok(firstPage.nextCursor);
    assert.equal(
      (
        await service.inbox(member, {
          kind: "subscriptions",
          limit: 1,
          cursor: firstPage.nextCursor,
        })
      ).items.length,
      1,
    );
    await assert.rejects(service.inbox(member, { kind: "comments", cursor: firstPage.nextCursor }));
    const newestNotice = firstPage.items[0]!;
    await service.markRead(member, { id: newestNotice.id });
    const unreadPreview = await service.inbox(member, { unreadOnly: "true", limit: 1 });
    assert.equal(unreadPreview.items.length, 1);
    assert.equal(unreadPreview.items[0]!.readAt, null);
    assert.notEqual(
      unreadPreview.items[0]!.id,
      newestNotice.id,
      "Unread preview must skip a newer read notification.",
    );
    await assert.rejects(
      service.inbox(member, { unreadOnly: "true", cursor: firstPage.nextCursor }),
    );
    await db
      .insert(memberBlocks)
      .values({ blockerId: member, blockedId: host, displayLabel: "검사 호스트" });
    assert.equal(
      (await service.inbox(member, { kind: "subscriptions" })).items.length,
      0,
      "Blocked hosts disappear from items and unread counts.",
    );
    assert.equal((await service.inbox(member)).unreadCount, 0);
    await db.delete(memberBlocks).where(eq(memberBlocks.blockerId, member));

    const [delayed] = await db
      .insert(posts)
      .values({
        authorId: host,
        categorySlug: "party",
        kind: "모집",
        title: "행사 설정 지연 검사",
        bodyMarkdown: "처음 설정하기 전에도 작업을 안전하게 복구합니다.",
      })
      .returning();
    fixturePosts.push(delayed!.id);
    await flushJobs();
    assert.equal(
      (await service.inbox(member, { kind: "subscriptions" })).items.some((item) =>
        item.url.includes(delayed!.id),
      ),
      false,
    );
    await db.insert(eventSettings).values({
      postId: delayed!.id,
      amountKRW: 0,
      capacity: 5,
      open: true,
      startsAt: new Date(Date.now() + 48 * 3600000),
      endsAt: new Date(Date.now() + 50 * 3600000),
    });
    await flushJobs();
    assert.ok(
      (await service.inbox(member, { kind: "subscriptions" })).items.some((item) =>
        item.url.includes(delayed!.id),
      ),
      "First event configuration recovers the recruitment job.",
    );
    const foreignReceipt = inbox.items.find((item) => item.url.includes(post.id))!;
    assert.equal(
      (await api("/api/engagement/inbox/read", "POST", { id: foreignReceipt.id })).status,
      404,
      "Another account cannot mark a receipt.",
    );
    await service.updateCategories(member, { categories: [] });
    await service.updateHost(member, publicId, { subscribed: false });
    const unfollowed = await recruit();
    await flushJobs();
    assert.equal(
      (await service.inbox(member, { kind: "subscriptions" })).items.some((item) =>
        item.url.includes(unfollowed.id),
      ),
      false,
    );

    const [parent] = await db
      .insert(comments)
      .values({ postId: post.id, authorId: member, bodyMarkdown: "부모 댓글 검사" })
      .returning();
    const [comment] = await db
      .insert(comments)
      .values({
        postId: post.id,
        authorId: host,
        parentId: parent!.id,
        bodyMarkdown: "읽음 동기화 검사",
      })
      .returning();
    const [legacy] = await db
      .insert(notifications)
      .values({
        recipientId: member,
        postId: post.id,
        commentId: comment!.id,
        kind: "comment_reply",
      })
      .returning();
    await flushJobs();
    inbox = await service.inbox(member, { kind: "comments" });
    const commentNotice = inbox.items.find((item) => item.url.includes(post.id));
    assert.ok(commentNotice);
    await service.markRead(member, { id: commentNotice.id });
    const [read] = await db
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(eq(notifications.id, legacy!.id));
    assert.ok(read!.readAt, "Unified inbox reads synchronize legacy comment receipts.");

    const startsAt = new Date(Date.now() + 48 * 3600000),
      endsAt = new Date(startsAt.getTime() + 2 * 3600000);
    await db
      .update(eventSettings)
      .set({ startsAt, endsAt })
      .where(eq(eventSettings.postId, post.id));
    const [application] = await db
      .insert(eventApplications)
      .values({
        postId: post.id,
        userId: member,
        attendeeName: "참가자",
        contact: "fixture@example.invalid",
        amountKRW: 0,
        status: "confirmed",
        confirmedAt: new Date(),
        expiresAt: new Date(Date.now() + 1800000),
      })
      .returning();
    assert.ok(application);
    await db
      .insert(roomMessages)
      .values({ postId: post.id, authorId: host, body: "공지방 전달 검사" });
    await flushJobs();
    assert.ok(
      (await service.inbox(member, { kind: "participation" })).items.some(
        (item) => item.body === post.title,
      ),
    );
    assert.ok(
      (await service.inbox(member, { kind: "announcements" })).items.some((item) =>
        item.url.includes(post.id),
      ),
    );
    const reminderClock = new Date(startsAt.getTime() - 24 * 3600000 + 1000);
    const worker = engagementWorker(db, () => reminderClock);
    await worker.scanReminders(100);
    let reminders = (await service.inbox(member, { kind: "reminders" })).items.filter((item) =>
      item.url.includes(post.id),
    );
    assert.equal(reminders.length, 1);
    await worker.scanReminders(100);
    assert.equal(
      (await service.inbox(member, { kind: "reminders" })).items.filter((item) =>
        item.url.includes(post.id),
      ).length,
      1,
      "A worker retry does not duplicate reminders.",
    );

    await eventLifecycleService(db).change(host, post.id, {
      kind: "reschedule",
      expectedRevision: 0,
      confirmed: true,
      reason: "행사 일정 변경 테스트를 위해 다음 날로 조정합니다.",
      startsAt: new Date(startsAt.getTime() + 86400000).toISOString(),
      endsAt: new Date(endsAt.getTime() + 86400000).toISOString(),
    });
    await flushJobs();
    await worker.scanReminders(100);
    const notices = await service.inbox(member, { kind: "participation" });
    assert.ok(
      notices.items.length >= 2,
      "Schedule changes feed the same inbox. " +
        JSON.stringify(
          await db.execute(sql`select kind,completed_at,available_at,last_error,attempts
            from sliper.engagement_jobs where post_id=${post.id}::uuid`),
        ),
    );
    const latestClock = new Date(startsAt.getTime() + 86400000 - 2 * 3600000 + 1000);
    await engagementWorker(db, () => latestClock).scanReminders(100);
    reminders = (await service.inbox(member, { kind: "reminders" })).items.filter((item) =>
      item.url.includes(post.id),
    );
    assert.ok(reminders.length >= 1, "The latest schedule gets its own reminder.");
    const [late] = await db
      .insert(eventApplications)
      .values({
        postId: post.id,
        userId: hostOnly,
        attendeeName: "늦은 참가자",
        contact: "fixture@example.invalid",
        amountKRW: 0,
        status: "confirmed",
        confirmedAt: latestClock,
        expiresAt: new Date(latestClock.getTime() + 1800000),
      })
      .returning();
    assert.ok(late);
    await db.execute(
      sql`update sliper.room_members set created_at=${latestClock.toISOString()}::timestamptz where application_id=${late!.id}::uuid`,
    );
    await engagementWorker(db, () => latestClock).scanReminders(100);
    assert.equal(
      (await service.inbox(hostOnly, { kind: "reminders" })).items.length,
      0,
      "Late participants are not flooded with elapsed reminders.",
    );
    await eventLifecycleService(db).change(host, post.id, {
      kind: "cancel",
      expectedRevision: 1,
      confirmed: true,
      reason: "알림 취소 억제를 확인하는 임시 취소입니다.",
    });
    await flushJobs();
    const before = (await service.inbox(member, { kind: "reminders" })).items.length;
    await engagementWorker(db, () => new Date(latestClock.getTime() + 60000)).scanReminders(100);
    assert.equal(
      (await service.inbox(member, { kind: "reminders" })).items.length,
      before,
      "Canceled events create no further reminders.",
    );
    await service.markRead(member, {});
    assert.equal((await service.inbox(member)).unreadCount, 0);
  } finally {
    try {
      for (const postId of fixturePosts) {
        await db.execute(sql`delete from sliper.refund_requests where post_id=${postId}::uuid`);
        await db.execute(sql`delete from sliper.event_changes where post_id=${postId}::uuid`);
        await db.delete(eventApplications).where(eq(eventApplications.postId, postId));
      }
      if (fixturePosts.length) await db.delete(posts).where(inArray(posts.id, fixturePosts));
      await db.execute(
        sql`delete from auth.users where id in (${host}::uuid,${member}::uuid,${hostOnly}::uuid)`,
      );
    } finally {
      await connection.close();
    }
  }
});
