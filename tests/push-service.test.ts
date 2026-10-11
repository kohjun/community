import assert from "node:assert/strict";
import { createECDH, createHash, randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq, sql } from "drizzle-orm";
import webpush from "web-push";
import type { Database } from "../src/db/connection";
import { categories, eventApplications, notifications } from "../src/db/schema";
import { pushDeliveries, pushSubscriptions } from "../src/db/push-schema";
import { CATEGORIES } from "../src/domain/categories";
import { DEFAULT_PUSH_PREFERENCES } from "../src/domain/push";
import { pushService } from "../src/server/push-service";
import { pushDispatcher, pushFailure, type PushSender } from "../src/server/push-dispatcher";
import { parsePushConfiguration, isLocalPushDevelopment } from "../src/server/push-configuration";
import {
  validPushEndpoint,
  validateSubscriptionKeys,
  safePushPath,
} from "../src/server/push-validation";
import { communityService } from "../src/server/community-service";
import { participationService } from "../src/server/participation-service";
import { AppError } from "../src/server/errors";

const pg = new PGlite();
const raw = drizzle(pg),
  db = raw as unknown as Database;
const config = { subject: "mailto:push@example.invalid", ...webpush.generateVAPIDKeys() };
const service = pushService(db, config),
  community = communityService(db),
  participation = participationService(db);
const code = (value: string) => (e: unknown) => e instanceof AppError && e.code === value;
let owner: string, attendee: string;
function subscription(endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`) {
  const ec = createECDH("prime256v1");
  ec.generateKeys();
  return {
    endpoint,
    expirationTime: null,
    keys: {
      p256dh: ec.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
}
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values ($1)", [id]);
  await pg.query(
    "insert into sliper.profiles (id,nickname,phone_number,profile_completed_at,onboarding_consent_at) values ($1,$2,'01012345678',statement_timestamp(),statement_timestamp())",
    [id, nickname],
  );
  return id;
}
async function queueTest(user = owner) {
  const input = subscription();
  await service.subscribe(user, input);
  await service.test(user, { endpoint: input.endpoint });
  return input;
}
async function event() {
  const post = await community.createPost(owner, {
    categorySlug: "party",
    kind: "모집",
    title: "푸시 행사",
    location: "서울 테스트 장소",
    eventDate: "내일 오후 2시",
    eventFee: "무료",
    bodyMarkdown: "행사 안내",
    isAnonymous: false,
    imageAssetIds: [],
  });
  await participation.configure(owner, post.id, { amountKRW: 0, capacity: 10, open: true });
  return post;
}
before(async () => {
  await pg.exec(
    "create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated;",
  );
  await migrate(raw, { migrationsFolder: "./drizzle" });
  await raw.insert(categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;");
  owner = await member("개최자");
  attendee = await member("참가자");
});
after(() => pg.close());

test("push endpoint and encryption checks reject SSRF targets and malformed public keys", () => {
  for (const host of [
    "fcm.googleapis.com",
    "updates.push.services.mozilla.com",
    "web.push.apple.com",
    "wns.notify.windows.com",
  ])
    assert.equal(validPushEndpoint(`https://${host}/subscription`), true);
  for (const url of [
    "http://fcm.googleapis.com/a",
    "https://127.0.0.1/x",
    "https://[::1]/x",
    "https://fcm.googleapis.com.evil.example/x",
    "https://example.com/x",
    "https://user:pass@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    "https://fcm.googleapis.com/x#secret",
    "https://fcm.googleapis.com/\\evil",
  ])
    assert.equal(validPushEndpoint(url), false, url);
  const input = subscription();
  validateSubscriptionKeys(input.keys.p256dh, input.keys.auth);
  assert.throws(() => validateSubscriptionKeys("A".repeat(87), "A".repeat(22)), code("VALIDATION"));
  assert.equal(safePushPath("/?post=" + randomUUID()), true);
  assert.equal(safePushPath("/rooms/" + randomUUID()), true);
  for (const path of [
    "//example.com",
    "/\\example.com",
    "/api/push/settings",
    "/mypage?redirect=https://example.com",
  ])
    assert.equal(safePushPath(path), false);
});
test("VAPID keys must match and local credential fallback is disabled for production", () => {
  assert.deepEqual(parsePushConfiguration(config), config);
  assert.equal(
    parsePushConfiguration({ ...config, publicKey: webpush.generateVAPIDKeys().publicKey }),
    null,
  );
  assert.equal(parsePushConfiguration({ ...config, subject: "http://localhost" }), null);
  const env = {
    NODE_ENV: "development" as const,
    LOCAL_DATABASE: "1",
    SLIPER_AUTH_MODE: "development",
    DATABASE_URL: "postgres://local@127.0.0.1:55432/sliper_dev",
  };
  assert.equal(isLocalPushDevelopment(env), true);
  assert.equal(isLocalPushDevelopment({ ...env, NODE_ENV: "production" }), false);
  assert.equal(
    isLocalPushDevelopment({ ...env, DATABASE_URL: "postgres://local@example.com/db" }),
    false,
  );
});
test("push registration is authenticated, private, idempotent and cannot steal another user's endpoint", async () => {
  const input = subscription();
  await assert.rejects(service.subscribe(null, input), code("UNAUTHENTICATED"));
  await assert.rejects(service.settings(null), code("UNAUTHENTICATED"));
  await assert.rejects(
    service.subscribe(owner, { ...input, endpoint: "https://127.0.0.1/private" }),
    code("VALIDATION"),
  );
  await service.subscribe(owner, input);
  await service.subscribe(owner, input);
  const view = await service.settings(
    owner,
    createHash("sha256").update(input.endpoint).digest("hex"),
  );
  assert.equal(view.currentDevice, true);
  assert.equal(view.subscriptions, 1);
  assert.deepEqual(view.preferences, DEFAULT_PUSH_PREFERENCES);
  for (const secret of [input.endpoint, input.keys.auth, input.keys.p256dh, config.privateKey])
    assert.equal(JSON.stringify(view).includes(secret), false);
  await assert.rejects(service.subscribe(attendee, input), code("CONFLICT"));
  await service.unsubscribe(attendee, { endpoint: input.endpoint });
  assert.equal((await service.settings(owner)).subscriptions, 1);
  await service.unsubscribe(owner, { endpoint: input.endpoint });
  assert.equal((await service.settings(owner)).subscriptions, 0);
});
test("device limit preserves valid subscriptions and cleans obsolete keys before reconnecting", async () => {
  for (let i = 0; i < 10; i++) await service.subscribe(owner, subscription());
  await assert.rejects(service.subscribe(owner, subscription()), code("CONFLICT"));
  await raw
    .update(pushSubscriptions)
    .set({ vapidPublicKey: webpush.generateVAPIDKeys().publicKey })
    .where(eq(pushSubscriptions.userId, owner));
  await service.subscribe(owner, subscription());
  assert.equal((await service.settings(owner)).subscriptions, 1);
});
test("real comment mutation queues only opted-in recipients and rolls back with the source transaction", async () => {
  await service.subscribe(owner, subscription());
  await service.subscribe(attendee, subscription());
  const post = await community.createPost(owner, {
    categorySlug: "party",
    kind: "이야기",
    title: "댓글 푸시",
    bodyMarkdown: "본문",
    isAnonymous: true,
    imageAssetIds: [],
  });
  await community.createComment(attendee, { postId: post.id, bodyMarkdown: "비공개 댓글 내용" });
  const jobs = await raw.select().from(pushDeliveries);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.recipientId, owner);
  assert.equal(jobs[0]!.url, "/?post=" + post.id);
  assert.equal(jobs[0]!.body.includes("비공개 댓글 내용"), false);
  const seen: string[] = [];
  await pushDispatcher(db, config, async (_, job) => {
    seen.push(job.id);
  }).drain();
  assert.equal(seen.length, 1);
  await service.update(owner, { ...DEFAULT_PUSH_PREFERENCES, comments: false });
  await community.createComment(attendee, { postId: post.id, bodyMarkdown: "옵트아웃 뒤 댓글" });
  assert.equal((await raw.select().from(pushDeliveries)).length, 1);
  const notificationCount = (await raw.select().from(notifications)).length;
  // An outbox enqueue error propagates inside createComment's transaction.
  await pg.exec(`CREATE FUNCTION sliper.test_reject_push() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rejection'; END $$;
    CREATE TRIGGER test_reject_push BEFORE INSERT ON sliper.push_deliveries FOR EACH ROW EXECUTE FUNCTION sliper.test_reject_push();`);
  await service.update(owner, DEFAULT_PUSH_PREFERENCES);
  try {
    await assert.rejects(
      community.createComment(attendee, { postId: post.id, bodyMarkdown: "rollback 확인" }),
    );
    assert.equal((await raw.select().from(notifications)).length, notificationCount);
  } finally {
    await pg.exec(
      "DROP TRIGGER test_reject_push ON sliper.push_deliveries; DROP FUNCTION sliper.test_reject_push();",
    );
  }
});
test("room announcements use current membership and revoked access is rechecked before delivery", async () => {
  await service.subscribe(owner, subscription());
  await service.subscribe(attendee, subscription());
  const post = await event();
  const application = (await participation.apply(attendee, post.id, { consent: true }, null))
    .application!;
  await pushDispatcher(db, config, async () => {}).drain();
  await assert.rejects(
    participation.send(attendee, post.id, { body: "일반 참가자 발행" }),
    code("FORBIDDEN"),
  );
  await participation.send(owner, post.id, { body: "공지 본문을 잠금 화면에 노출하지 않아요" });
  const queued = (await raw.select().from(pushDeliveries)).filter(
    (job) => job.kind === "announcement",
  );
  assert.equal(queued.length, 1);
  assert.equal(queued[0]!.recipientId, attendee);
  assert.equal(queued[0]!.url, "/rooms/" + post.id);
  assert.equal(queued[0]!.body.includes("잠금 화면"), false);
  await participation.cancel(attendee, application.id);
  let sends = 0;
  await pushDispatcher(db, config, async () => {
    sends++;
  }).drain();
  assert.equal(sends, 0);
  assert.equal(
    (await raw.select().from(pushDeliveries).where(eq(pushDeliveries.kind, "announcement")))[0]!
      .status,
    "cancelled",
  );
  assert.equal((await raw.select().from(eventApplications))[0]!.status, "cancelled");
});
test("transient failures retry durably, success is not repeated and opt-out cancels pending work", async () => {
  await queueTest();
  let attempts = 0;
  const sender: PushSender = async () => {
    attempts++;
    if (attempts === 1) throw { statusCode: 503 };
  };
  const dispatcher = pushDispatcher(db, config, sender);
  await dispatcher.drain();
  let [job] = await raw.select().from(pushDeliveries);
  assert.equal(job!.status, "pending");
  assert.equal(job!.attempts, 1);
  assert.equal(job!.lastErrorCode, "HTTP_503");
  assert.equal((await dispatcher.drain()).processed, 0);
  await raw.update(pushDeliveries).set({ availableAt: sql`now()-interval '1 second'` });
  await dispatcher.drain();
  [job] = await raw.select().from(pushDeliveries);
  assert.equal(job!.status, "sent");
  assert.ok(job!.sentAt);
  assert.equal(job!.lockToken, null);
  await dispatcher.drain();
  assert.equal(attempts, 2);
  await assert.rejects(
    service.test(owner, { endpoint: (await raw.select().from(pushSubscriptions))[0]!.endpoint }),
    code("RATE_LIMITED"),
  );
});
test("gone endpoints are removed, expired jobs are suppressed and abandoned leases recover", async () => {
  await queueTest();
  await pushDispatcher(db, config, async () => {
    throw { statusCode: 410 };
  }).drain();
  assert.equal((await raw.select().from(pushSubscriptions)).length, 0);
  assert.equal((await raw.select().from(pushDeliveries)).length, 0);
  await queueTest();
  await raw.update(pushDeliveries).set({
    status: "processing",
    lockedAt: sql`now()-interval '3 minutes'`,
    lockToken: randomUUID(),
    attempts: 1,
  });
  let sends = 0;
  await pushDispatcher(db, config, async () => {
    sends++;
  }).drain();
  assert.equal(sends, 1);
  assert.equal((await raw.select().from(pushDeliveries))[0]!.attempts, 2);
  await service.subscribe(attendee, subscription());
  const endpoint = (
    await raw.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, attendee))
  )[0]!.endpoint;
  await service.test(attendee, { endpoint });
  await raw
    .update(pushDeliveries)
    .set({ createdAt: sql`now()-interval '2 minutes'`, expiresAt: sql`now()-interval '1 minute'` })
    .where(eq(pushDeliveries.recipientId, attendee));
  await pushDispatcher(db, config, async () => {
    sends++;
  }).drain();
  assert.equal(sends, 1);
  assert.equal(
    (await raw.select().from(pushDeliveries).where(eq(pushDeliveries.recipientId, attendee)))[0]!
      .status,
    "cancelled",
  );
});
test("retry classification respects provider throttling and stops permanent or exhausted failures", () => {
  assert.equal(
    pushFailure({ statusCode: 429, headers: { "retry-after": "120" } }, 1).delaySeconds,
    120,
  );
  assert.equal(pushFailure({ statusCode: 500 }, 6).retry, false);
  assert.equal(pushFailure({ statusCode: 401 }, 1).retry, false);
  assert.equal(pushFailure({ statusCode: 404 }, 1).remove, true);
  assert.equal(pushFailure(new Error("network"), 1).retry, true);
});

test("older settings payloads preserve disabled subscription and reminder preferences", async () => {
  await service.update(owner, {
    comments: true,
    announcements: true,
    participation: true,
    subscriptions: false,
    reminders: false,
  });
  const view = await service.update(owner, {
    comments: false,
    announcements: true,
    participation: true,
  });
  assert.equal(view.preferences.subscriptions, false);
  assert.equal(view.preferences.reminders, false);
  assert.equal(view.preferences.comments, false);
});
