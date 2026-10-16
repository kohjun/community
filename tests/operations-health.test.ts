import assert from "node:assert/strict";
import { randomBytes, randomUUID, createECDH } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as base from "../src/db/schema";
import { CATEGORIES } from "../src/domain/categories";
import type { Database } from "../src/db/connection";
import { memberSafety, staffRoles } from "../src/db/safety-schema";
import { engagementJobs } from "../src/db/engagement-schema";
import { pushDeliveries, pushSubscriptions } from "../src/db/push-schema";
import { videoAssets } from "../src/db/video-schema";
import { mediaRetentionJobs } from "../src/db/media-retention-schema";
import { mediaRetentionService } from "../src/server/media-retention-service";
import { eventOperationsService } from "../src/server/event-operations-service";
import { deploymentReadiness } from "../src/server/deployment-readiness";
import { videoProcessingJobs, videoProcessingOutputs } from "../src/db/video-processing-schema";
import {
  operationsHealthService,
  healthConfiguration,
} from "../src/server/operations-health-service";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database;
const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
const service = operationsHealthService(connection, env);
let admin: string, mod: string, member: string, postId: string;
const errorCode = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(base.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;truncate sliper.media_retention_jobs");
  async function profile(name: string) {
    const id = randomUUID();
    await pg.query("insert into auth.users values($1)", [id]);
    await db.insert(base.profiles).values({ id, nickname: name });
    return id;
  }
  admin = await profile("점검 관리자");
  mod = await profile("점검 모더레이터");
  member = await profile("일반 회원");
  await db.insert(staffRoles).values([
    { userId: admin, role: "admin" },
    { userId: mod, role: "moderator" },
  ]);
  const [post] = await db
    .insert(base.posts)
    .values({
      authorId: member,
      kind: "이야기",
      categorySlug: "party",
      title: "PRIVATE-HEALTH-TITLE",
      bodyMarkdown: "PRIVATE-HEALTH-BODY 연락 정보는 점검 응답에 포함하지 않습니다.",
    })
    .returning({ id: base.posts.id });
  postId = post!.id;
});
after(() => pg.close());

test("health counters require an active admin and do not turn role membership into public access", async () => {
  await assert.rejects(service.snapshot(null), errorCode("UNAUTHENTICATED"));
  await assert.rejects(service.snapshot(member), errorCode("FORBIDDEN"));
  await assert.rejects(service.snapshot(mod), errorCode("FORBIDDEN"));
  assert.equal((await service.snapshot(admin)).queues.length, 3);
  for (const status of ["suspended", "closed"]) {
    await db
      .insert(memberSafety)
      .values({ userId: admin, status })
      .onConflictDoUpdate({ target: memberSafety.userId, set: { status } });
    await assert.rejects(service.snapshot(admin), errorCode("FORBIDDEN"));
  }
});

test("empty durable queues have bounded counter projections and no invented worker heartbeat", async () => {
  const result = await service.snapshot(admin);
  assert.equal(result.queues.length, 3);
  for (const q of result.queues) {
    assert.equal(q.waiting, 0);
    assert.equal(q.processing, 0);
    assert.equal(q.failed, 0);
    assert.equal(q.staleLeases, 0);
    assert.equal(q.oldestWaitingAt, null);
    assert.equal(q.latestCompletedAt, null);
    assert.equal(Object.hasOwn(q, "running"), false);
  }
  assert.deepEqual(result.media, {
    abandonedImages: 0,
    abandonedVideos: 0,
    videoSourcesToClean: 0,
    videoOutputsToClean: 0,
  });
  const text = JSON.stringify(result);
  assert.equal(text.includes("PRIVATE-HEALTH"), false);
  assert.equal(text.includes(member), false);
  assert.equal(text.includes(postId), false);
});

test("durable work distinguishes due, deferred, expired, active and stale leases without exposing subscriptions", async () => {
  const now = Date.now(),
    past = (minutes: number) => new Date(now - minutes * 60000),
    future = (minutes: number) => new Date(now + minutes * 60000);
  const source = (extra: Partial<typeof engagementJobs.$inferInsert>) => ({
    kind: "comment" as const,
    sourceKey: randomUUID(),
    postId,
    sourceId: randomUUID(),
    createdAt: past(60),
    availableAt: past(30),
    ...extra,
  });
  await db
    .insert(engagementJobs)
    .values([
      source({}),
      source({ leaseUntil: future(1) }),
      source({ leaseUntil: past(1), attempts: 1, lastError: "SOURCE_PROCESSING_FAILED" }),
      source({ completedAt: past(1), lastError: "SOURCE_RETRIES_EXHAUSTED" }),
    ]);
  const publicKey = Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64url");
  const [subscription] = await db
    .insert(pushSubscriptions)
    .values({
      userId: member,
      endpoint: "https://push.example.invalid/" + randomUUID(),
      p256dh: publicKey,
      auth: randomBytes(16).toString("base64url"),
      vapidPublicKey: publicKey,
    })
    .returning();
  const push = (extra: Partial<typeof pushDeliveries.$inferInsert>) => ({
    subscriptionId: subscription!.id,
    recipientId: member,
    dedupeKey: randomUUID(),
    kind: "test",
    title: "PRIVATE-HEALTH-PUSH",
    body: "PRIVATE-HEALTH-PUSH-BODY",
    url: "/mypage",
    createdAt: past(120),
    availableAt: past(30),
    expiresAt: future(60),
    ...extra,
  });
  await db
    .insert(pushDeliveries)
    .values([
      push({}),
      push({ availableAt: future(5), attempts: 1 }),
      push({ expiresAt: past(1) }),
      push({ status: "processing", lockedAt: past(1), lockToken: randomUUID() }),
      push({ status: "processing", lockedAt: past(3), lockToken: randomUUID() }),
      push({ status: "failed" }),
    ]);
  const video = (extra: Partial<typeof videoProcessingJobs.$inferInsert>) => {
    const id = randomUUID();
    return {
      id,
      uploaderId: member,
      sourceObjectKey: id + ".bin",
      sourceStorageBackend: "local" as const,
      sourceByteSize: 100,
      sourceReady: true,
      createdAt: past(60),
      availableAt: past(30),
      uploadExpiresAt: future(10),
      sourceExpiresAt: future(1440),
      ...extra,
    };
  };
  const jobs = await db
    .insert(videoProcessingJobs)
    .values([
      video({ attempts: 1 }),
      video({ status: "processing", leaseExpiresAt: future(2), lockToken: randomUUID() }),
      video({ status: "processing", leaseExpiresAt: past(1), lockToken: randomUUID() }),
      video({
        status: "failed",
        attempts: 3,
        lastErrorCode: "PROCESSING_FAILED",
        sourceCleanupAt: past(1),
      }),
    ])
    .returning();
  const outputId = randomUUID();
  await db.insert(videoProcessingOutputs).values({
    id: outputId,
    jobId: jobs[3]!.id,
    objectKey: outputId + ".mp4",
    storageBackend: "local",
    cleanupAt: past(1),
  });
  const value = await service.snapshot(admin),
    inbox = value.queues[0]!,
    pushStats = value.queues[1]!,
    videoStats = value.queues[2]!;
  assert.deepEqual(
    [inbox.waiting, inbox.processing, inbox.retrying, inbox.failed, inbox.staleLeases],
    [2, 1, 1, 1, 1],
  );
  assert.deepEqual(
    [
      pushStats.waiting,
      pushStats.processing,
      pushStats.retrying,
      pushStats.failed,
      pushStats.staleLeases,
    ],
    [1, 1, 1, 1, 1],
  );
  assert.deepEqual(
    [
      videoStats.waiting,
      videoStats.processing,
      videoStats.retrying,
      videoStats.failed,
      videoStats.staleLeases,
    ],
    [1, 1, 1, 1, 1],
  );
  assert.equal(value.media.videoSourcesToClean, 1);
  assert.equal(value.media.videoOutputsToClean, 1);
  const text = JSON.stringify(value);
  for (const forbidden of [
    "PRIVATE-HEALTH",
    subscription!.endpoint,
    subscription!.auth,
    member,
    outputId,
  ])
    assert.equal(text.includes(forbidden), false);
  assert.equal(Object.hasOwn(value, "jobs"), false);
});

test("abandoned media is a read-only candidate count that never changes assets or creates cleanup work", async () => {
  const createdAt = new Date(Date.now() - 26 * 3600000),
    imageId = randomUUID(),
    videoId = randomUUID();
  await db.insert(base.mediaAssets).values({
    id: imageId,
    uploaderId: member,
    objectKey: imageId + ".webp",
    contentType: "image/webp",
    byteSize: 12,
    createdAt,
    unattachedSince: createdAt,
  });
  await db.insert(videoAssets).values({
    id: videoId,
    uploaderId: member,
    objectKey: videoId + ".mp4",
    byteSize: 12,
    width: 10,
    height: 10,
    durationSeconds: 1,
    createdAt,
    unattachedSince: createdAt,
  });
  const beforeImages = await db.select().from(base.mediaAssets),
    beforeVideos = await db.select().from(videoAssets);
  for (let i = 0; i < 2; i++) {
    const health = await service.snapshot(admin);
    assert.equal(health.media.abandonedImages, 1);
    assert.equal(health.media.abandonedVideos, 1);
  }
  assert.deepEqual(await db.select().from(base.mediaAssets), beforeImages);
  assert.deepEqual(await db.select().from(videoAssets), beforeVideos);
  assert.equal((await db.select().from(videoProcessingJobs)).length, 0);
});

test("settings expose only classifications and cannot leak credentials, addresses or storage errors", () => {
  const marker = randomBytes(24).toString("hex");
  const value = healthConfiguration({
    NODE_ENV: "production",
    MEDIA_STORAGE_BACKEND: "supabase",
    SUPABASE_STORAGE_SECRET_KEY: marker,
    REDIS_URL: "redis://user:" + marker + "@cache.example.invalid:6379",
    PUSH_WORKER_MODE: "external",
  });
  assert.deepEqual(value, {
    mediaStorage: "invalid",
    roomUpdates: "configured",
    push: "disabled",
    pushWorker: "external",
  });
  assert.equal(JSON.stringify(value).includes(marker), false);
  assert.equal(JSON.stringify(value).includes("cache.example.invalid"), false);
  assert.equal(
    healthConfiguration({
      NODE_ENV: "production",
      REDIS_URL: "https://example.invalid",
      PUSH_WORKER_MODE: "unknown",
    }).roomUpdates,
    "invalid",
  );
  assert.equal(
    healthConfiguration({ NODE_ENV: "production", PUSH_WORKER_MODE: "unknown" }).pushWorker,
    "invalid",
  );
});

test("valid push configuration is reported without returning public or private key material", () => {
  const ec = createECDH("prime256v1");
  ec.generateKeys();
  const privateKey = ec.getPrivateKey().toString("base64url"),
    publicKey = ec.getPublicKey().toString("base64url");
  const value = healthConfiguration({
    NODE_ENV: "production",
    VAPID_SUBJECT: "mailto:ops@example.invalid",
    VAPID_PUBLIC_KEY: publicKey,
    VAPID_PRIVATE_KEY: privateKey,
  });
  assert.equal(value.push, "configured");
  assert.equal(JSON.stringify(value).includes(privateKey), false);
  assert.equal(JSON.stringify(value).includes(publicKey), false);
});

test("recently detached old media starts a fresh observation window without being counted from creation", async () => {
  const createdAt = new Date(Date.now() - 60 * 86400000);
  const imageId = randomUUID(),
    videoId = randomUUID();
  await db.insert(base.mediaAssets).values({
    id: imageId,
    uploaderId: member,
    postId,
    objectKey: imageId + ".webp",
    contentType: "image/webp",
    byteSize: 12,
    status: "ready",
    createdAt,
  });
  await db.insert(videoAssets).values({
    id: videoId,
    uploaderId: member,
    postId,
    objectKey: videoId + ".mp4",
    byteSize: 12,
    width: 10,
    height: 10,
    durationSeconds: 1,
    status: "ready",
    createdAt,
  });
  await db.update(base.mediaAssets).set({ postId: null }).where(eq(base.mediaAssets.id, imageId));
  await db.update(videoAssets).set({ postId: null }).where(eq(videoAssets.id, videoId));
  const images = await db.select().from(base.mediaAssets),
    videos = await db.select().from(videoAssets);
  assert.ok(images[0]!.unattachedSince!.getTime() > Date.now() - 5000);
  assert.ok(videos[0]!.unattachedSince!.getTime() > Date.now() - 5000);
  const value = await service.snapshot(admin);
  assert.equal(value.media.abandonedImages, 0);
  assert.equal(value.media.abandonedVideos, 0);
  assert.deepEqual(await db.select().from(base.mediaAssets), images);
  assert.deepEqual(await db.select().from(videoAssets), videos);
  assert.equal((await db.select().from(mediaRetentionJobs)).length, 0);
});

test("historical record-origin media remains protected even with an old observation timestamp", async () => {
  const old = new Date(Date.now() - 60 * 86400000);
  const [event] = await db
    .insert(base.posts)
    .values({
      authorId: member,
      title: "비공개 기록 보관 확인",
      bodyMarkdown: "기록 원본은 관찰 대상이 아닙니다.",
      categorySlug: "party",
      kind: "모집",
    })
    .returning({ id: base.posts.id });
  await db.insert(base.eventSettings).values({
    postId: event!.id,
    amountKRW: 0,
    capacity: 10,
    startsAt: new Date(old.getTime() - 86400000),
    endsAt: old,
  });
  await eventOperationsService(connection).finalize(member, event!.id);
  const imageId = randomUUID(),
    videoId = randomUUID();
  await db.insert(base.mediaAssets).values({
    id: imageId,
    uploaderId: member,
    recordOriginPostId: event!.id,
    objectKey: imageId + ".webp",
    contentType: "image/webp",
    byteSize: 12,
    createdAt: old,
  });
  await db.insert(videoAssets).values({
    id: videoId,
    uploaderId: member,
    recordOriginPostId: event!.id,
    objectKey: videoId + ".mp4",
    byteSize: 12,
    width: 10,
    height: 10,
    durationSeconds: 1,
    createdAt: old,
  });
  // Reproduce migration-era rows whose new default timestamp aged while already linked.
  await pg.exec(
    "alter table sliper.media_assets disable trigger media_retention_parent_guard;alter table sliper.video_assets disable trigger media_retention_parent_guard",
  );
  try {
    await db
      .update(base.mediaAssets)
      .set({ unattachedSince: old })
      .where(eq(base.mediaAssets.id, imageId));
    await db.update(videoAssets).set({ unattachedSince: old }).where(eq(videoAssets.id, videoId));
  } finally {
    await pg.exec(
      "alter table sliper.media_assets enable trigger media_retention_parent_guard;alter table sliper.video_assets enable trigger media_retention_parent_guard",
    );
  }
  const beforeImages = await db.select().from(base.mediaAssets),
    beforeVideos = await db.select().from(videoAssets);
  const value = await service.snapshot(admin);
  assert.equal(value.media.abandonedImages, 0);
  assert.equal(value.media.abandonedVideos, 0);
  assert.deepEqual(await db.select().from(base.mediaAssets), beforeImages);
  assert.deepEqual(await db.select().from(videoAssets), beforeVideos);
  assert.equal((await db.select().from(mediaRetentionJobs)).length, 0);
});

test("reserved and removed metadata never reappears as unreserved media observation", async () => {
  const old = new Date(Date.now() - 31 * 86400000),
    imageId = randomUUID(),
    videoId = randomUUID();
  await db.insert(base.mediaAssets).values({
    id: imageId,
    uploaderId: member,
    objectKey: imageId + ".webp",
    contentType: "image/webp",
    byteSize: 12,
    createdAt: old,
    unattachedSince: old,
    status: "ready",
  });
  await db.insert(videoAssets).values({
    id: videoId,
    uploaderId: member,
    objectKey: videoId + ".mp4",
    byteSize: 12,
    width: 10,
    height: 10,
    durationSeconds: 1,
    createdAt: old,
    unattachedSince: old,
    status: "ready",
  });
  assert.equal((await service.snapshot(admin)).media.abandonedImages, 1);
  assert.equal((await service.snapshot(admin)).media.abandonedVideos, 1);
  const retention = mediaRetentionService(connection);
  assert.equal(await retention.reserve(), 2);
  const claim = await retention.claim();
  assert.ok(claim);
  assert.equal(await retention.process(claim, async () => {}), true);
  const beforeJobs = await db.select().from(mediaRetentionJobs);
  assert.deepEqual(beforeJobs.map((job) => job.status).sort(), ["pending", "removed"]);
  const beforeImages = await db.select().from(base.mediaAssets),
    beforeVideos = await db.select().from(videoAssets);
  for (let i = 0; i < 2; i++) {
    const value = await service.snapshot(admin);
    assert.equal(value.media.abandonedImages, 0);
    assert.equal(value.media.abandonedVideos, 0);
  }
  assert.deepEqual(await db.select().from(mediaRetentionJobs), beforeJobs);
  assert.deepEqual(await db.select().from(base.mediaAssets), beforeImages);
  assert.deepEqual(await db.select().from(videoAssets), beforeVideos);
});

test("health and deployment reject the same malformed Redis formats without exposing supplied values", () => {
  const marker = randomBytes(20).toString("hex");
  const invalid = [
    "redis://cache.example/not-a-db",
    "redis://cache.example/-1",
    "redis://cache.example/9007199254740992",
    "redis://cache.example:0",
    "redis://cache.example:65536",
    "redis://bad_host.example/0",
    "redis://999.999.999.999",
    "redis://%ZZ:" + marker + "@cache.example/0",
    "redis://user:%ZZ@cache.example/0",
    "https://user:" + marker + "@cache.example",
  ];
  for (const raw of invalid) {
    const env = { NODE_ENV: "production", REDIS_URL: raw } as NodeJS.ProcessEnv;
    const health = healthConfiguration(env),
      report = deploymentReadiness(env);
    assert.equal(health.roomUpdates, "invalid");
    assert.equal(report.find((item) => item.id === "room-realtime")!.status, "fail");
    for (const value of [raw, marker, "cache.example", "bad_host.example"])
      assert.equal(JSON.stringify({ health, report }).includes(value), false);
  }
});

test("valid Redis format is classified without implying a network connection or weakening TLS policy", () => {
  for (const [raw, expected] of [
    ["rediss://user:private@cache.example:6380/0", "pass"],
    ["redis://127.0.0.1:6380/0", "warn"],
    ["redis://redis.internal/1", "warn"],
    ["redis://cache.example/0", "fail"],
  ] as const) {
    const env = { NODE_ENV: "production", REDIS_URL: raw } as NodeJS.ProcessEnv;
    assert.equal(healthConfiguration(env).roomUpdates, "configured");
    assert.equal(
      deploymentReadiness(env).find((item) => item.id === "room-realtime")!.status,
      expected,
    );
    assert.equal(JSON.stringify(healthConfiguration(env)).includes(raw), false);
  }
  assert.equal(
    healthConfiguration({ NODE_ENV: "production", REDIS_URL: "   " }).roomUpdates,
    "disabled",
  );
});
