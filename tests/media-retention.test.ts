import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as base from "../src/db/schema";
import { videoAssets } from "../src/db/video-schema";
import { mediaRetentionJobs } from "../src/db/media-retention-schema";
import { staffRoles } from "../src/db/safety-schema";
import { CATEGORIES } from "../src/domain/categories";
import type { Database } from "../src/db/connection";
import { mediaRetentionService } from "../src/server/media-retention-service";
import { verifyLocalRetentionPath } from "../src/server/media-retention-local";
import { eventOperationsService } from "../src/server/event-operations-service";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database,
  service = mediaRetentionService(connection);
let owner: string, admin: string, postId: string;
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);
const databaseCode = (error: unknown) =>
  !!error &&
  typeof error === "object" &&
  "cause" in error &&
  !!error.cause &&
  typeof error.cause === "object" &&
  "code" in error.cause &&
  error.cause.code === "23514";
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(base.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;truncate sliper.media_retention_jobs");
  const profile = async (name: string) => {
    const id = randomUUID();
    await pg.query("insert into auth.users values($1)", [id]);
    await db.insert(base.profiles).values({ id, nickname: name });
    return id;
  };
  owner = await profile("파일 소유자");
  admin = await profile("보관 관리자");
  await db.insert(staffRoles).values({ userId: admin, role: "admin" });
  const [post] = await db
    .insert(base.posts)
    .values({
      authorId: owner,
      title: "보관 검사 글",
      bodyMarkdown: "연결된 파일은 계속 보존합니다.",
      categorySlug: "party",
      kind: "이야기",
    })
    .returning({ id: base.posts.id });
  postId = post!.id;
});
after(() => pg.close());
async function image(age = 31, extra: Partial<typeof base.mediaAssets.$inferInsert> = {}) {
  const id = randomUUID();
  const [row] = await db
    .insert(base.mediaAssets)
    .values({
      id,
      uploaderId: owner,
      objectKey: id + ".webp",
      contentType: "image/webp",
      byteSize: 100,
      status: "ready",
      createdAt: daysAgo(age),
      unattachedSince: daysAgo(age),
      ...extra,
    })
    .returning();
  return row!;
}
async function video(age = 31, extra: Partial<typeof videoAssets.$inferInsert> = {}) {
  const id = randomUUID();
  const [row] = await db
    .insert(videoAssets)
    .values({
      id,
      uploaderId: owner,
      objectKey: id + ".mp4",
      byteSize: 100,
      width: 10,
      height: 10,
      durationSeconds: 1,
      status: "ready",
      createdAt: daysAgo(age),
      unattachedSince: daysAgo(age),
      ...extra,
    })
    .returning();
  return row!;
}

test("30-day candidate previews are admin-only, read-only and contain no asset identities", async () => {
  await image(31);
  await image(29);
  await video(31);
  const before = await db.select().from(base.mediaAssets);
  await assert.rejects(
    service.adminSummary(null),
    (e: unknown) => e instanceof AppError && e.code === "UNAUTHENTICATED",
  );
  await assert.rejects(
    service.adminSummary(owner),
    (e: unknown) => e instanceof AppError && e.code === "FORBIDDEN",
  );
  const value = await service.adminSummary(admin);
  assert.equal(value.retentionDays, 30);
  assert.equal(value.eligibleImages, 1);
  assert.equal(value.eligibleVideos, 1);
  assert.equal(JSON.stringify(value).includes(owner), false);
  assert.equal(JSON.stringify(value).includes(".webp"), false);
  assert.deepEqual(await db.select().from(base.mediaAssets), before);
  assert.equal((await db.select().from(mediaRetentionJobs)).length, 0);
});

test("attachments and record-origin privacy stay protected; detaching starts a new grace period", async () => {
  const attached = await image(60, { postId }),
    movie = await video(60, { postId });
  assert.equal(attached.unattachedSince, null);
  assert.equal(movie.unattachedSince, null);
  assert.equal(await service.reserve(), 0);
  await db
    .update(base.mediaAssets)
    .set({ postId: null })
    .where(eq(base.mediaAssets.id, attached.id));
  const [detached] = await db
    .select()
    .from(base.mediaAssets)
    .where(eq(base.mediaAssets.id, attached.id));
  assert.ok(detached!.unattachedSince!.getTime() > Date.now() - 5000);
  assert.equal(await service.reserve(), 0);
  const [event] = await db
    .insert(base.posts)
    .values({
      authorId: owner,
      title: "이전 행사 기록",
      bodyMarkdown: "기록에 연결된 파일은 지우지 않습니다.",
      categorySlug: "party",
      kind: "모집",
    })
    .returning({ id: base.posts.id });
  await db.insert(base.eventSettings).values({
    postId: event!.id,
    amountKRW: 0,
    capacity: 10,
    startsAt: daysAgo(70),
    endsAt: daysAgo(69),
  });
  await eventOperationsService(connection).finalize(owner, event!.id);
  const protectedImage = await image(60, { recordOriginPostId: event!.id });
  assert.equal(protectedImage.unattachedSince, null);
  assert.equal(await service.reserve(), 0);
});

test("reservation prevents late parent attachment and revival before deleting any object", async () => {
  const asset = await image();
  assert.equal(await service.reserve(), 1);
  assert.equal(await service.reserve(), 0);
  await assert.rejects(
    db
      .update(base.mediaAssets)
      .set({ postId, status: "ready" })
      .where(eq(base.mediaAssets.id, asset.id)),
    databaseCode,
  );
  await assert.rejects(
    db.update(base.mediaAssets).set({ status: "ready" }).where(eq(base.mediaAssets.id, asset.id)),
    databaseCode,
  );
  const claim = await service.claim();
  assert.ok(claim);
  let calls = 0;
  assert.equal(
    await service.process(claim, async (kind, backend, key) => {
      assert.equal(kind, "image");
      assert.equal(backend, "local");
      assert.equal(key, asset.objectKey);
      calls++;
    }),
    true,
  );
  assert.equal(calls, 1);
  assert.equal(
    await service.process(claim, async () => {
      calls++;
    }),
    false,
  );
  assert.equal(calls, 1);
  assert.equal((await service.summary()).removed, 1);
  const [metadata] = await db
    .select()
    .from(base.mediaAssets)
    .where(eq(base.mediaAssets.id, asset.id));
  assert.equal(metadata!.status, "pending");
});

test("storage failure keeps a durable retry; a stale token cannot delete or complete the newer claim", async () => {
  await video();
  await service.reserve();
  const first = await service.claim();
  assert.ok(first);
  assert.equal(
    await service.process(first, async () => {
      throw new Error("PRIVATE-DELETE-ERROR");
    }),
    false,
  );
  const [pending] = await db.select().from(mediaRetentionJobs);
  assert.equal(pending!.status, "pending");
  assert.equal(pending!.errorCode, "STORAGE_DELETE_FAILED");
  await db
    .update(mediaRetentionJobs)
    .set({ availableAt: daysAgo(1) })
    .where(eq(mediaRetentionJobs.id, pending!.id));
  const second = await service.claim();
  assert.ok(second);
  assert.notEqual(second.lockToken, first.lockToken);
  assert.equal(second.attempts, 2);
  let staleCalls = 0;
  assert.equal(
    await service.process(first, async () => {
      staleCalls++;
    }),
    false,
  );
  assert.equal(staleCalls, 0);
  assert.equal(await service.process(second, async () => {}), true);
  assert.equal((await service.summary()).removed, 1);
});

test("retries are bounded and source or cleanup identities cannot be reassigned", async () => {
  const asset = await image();
  await service.reserve();
  const [pending] = await db.select().from(mediaRetentionJobs);
  await assert.rejects(
    db
      .update(mediaRetentionJobs)
      .set({ assetId: randomUUID() })
      .where(eq(mediaRetentionJobs.id, pending!.id)),
    databaseCode,
  );
  for (let attempt = 1; attempt <= 5; attempt++) {
    if (attempt > 1)
      await db
        .update(mediaRetentionJobs)
        .set({ availableAt: daysAgo(1) })
        .where(eq(mediaRetentionJobs.id, pending!.id));
    const job = await service.claim();
    assert.ok(job);
    assert.equal(job.attempts, attempt);
    await service.process(job, async () => {
      throw Error("unavailable");
    });
  }
  const [failed] = await db.select().from(mediaRetentionJobs);
  assert.equal(failed!.status, "failed");
  assert.equal(await service.claim(), undefined);
  assert.equal((await service.summary()).failed, 1);
  const [preserved] = await db
    .select()
    .from(base.mediaAssets)
    .where(eq(base.mediaAssets.id, asset.id));
  assert.equal(preserved!.postId, null);
});

test("local cleanup rejects traversal and storage folders redirected outside the workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sliper-retention-")),
    external = await mkdtemp(path.join(os.tmpdir(), "sliper-retention-outside-"));
  try {
    await mkdir(path.join(root, ".local"));
    await symlink(
      external,
      path.join(root, ".local", "uploads"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(verifyLocalRetentionPath("image", "../../private", root));
    await assert.rejects(
      verifyLocalRetentionPath("image", randomUUID() + ".webp", root),
      (e: unknown) => e instanceof AppError && e.code === "FORBIDDEN",
    );
  } finally {
    for (const folder of [root, external]) {
      const resolved = path.resolve(folder),
        temporary = path.resolve(os.tmpdir()) + path.sep;
      assert.ok(resolved.toLowerCase().startsWith(temporary.toLowerCase()));
      assert.ok(path.basename(resolved).startsWith("sliper-retention-"));
      await rm(resolved, { recursive: true, force: true });
    }
  }
});

test("an expired final-attempt claim does not block the next available cleanup", async () => {
  await image();
  await image();
  await service.reserve();
  const expired = await service.claim();
  assert.ok(expired);
  // Simulate time passing after the last allowed claim, without delaying the suite two minutes.
  await pg.exec("alter table sliper.media_retention_jobs disable trigger retention_job_guard");
  try {
    await pg.query(
      "update sliper.media_retention_jobs set attempts=5,lease_until=statement_timestamp()-interval '1 second' where id=$1",
      [expired.id],
    );
  } finally {
    await pg.exec("alter table sliper.media_retention_jobs enable trigger retention_job_guard");
  }
  const result = await service.drain(async () => {});
  assert.deepEqual(result, { reserved: 0, attempted: 1, removed: 1 });
  assert.equal((await service.summary()).failed, 1);
});
