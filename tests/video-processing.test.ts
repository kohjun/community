import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq, sql } from "drizzle-orm";
import * as baseSchema from "../src/db/schema";
import { videoAssets } from "../src/db/video-schema";
import { videoProcessingJobs, videoProcessingOutputs } from "../src/db/video-processing-schema";
import type { Database } from "../src/db/connection";
import type { ImageStorageBackend } from "../src/domain/image-storage";
import { CATEGORIES } from "../src/domain/categories";
import { AppError } from "../src/server/errors";
import { communityService } from "../src/server/community-service";
import {
  videoProcessingService,
  videoWorker,
  type CompressedVideo,
} from "../src/server/video-processing-service";
import {
  localVideoSourceStore,
  supabaseVideoSourceStore,
  type VideoProcessingStorage,
  type VideoSourceStore,
} from "../src/server/video-source-storage";
import type { ImageObjectStore, SupabaseImageStorageApi } from "../src/server/image-storage-core";
import { mkdtemp, readdir, rmdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

const pg = new PGlite();
const db = drizzle(pg, {
  schema: { ...baseSchema, videoAssets, videoProcessingJobs, videoProcessingOutputs },
});
const database = db as unknown as Database;
const service = videoProcessingService(database);
let owner: string, other: string;
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
const raw = new Uint8Array([1, 2, 3, 4]);
const compressed: CompressedVideo = {
  bytes: new Uint8Array([5, 6]),
  width: 640,
  height: 360,
  durationSeconds: 3,
};
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values ($1)", [id]);
  await db.insert(baseSchema.profiles).values({ id, nickname });
  return id;
}
function memoryStorage() {
  const sources = new Map<string, Uint8Array>();
  const derivatives = new Map<string, Uint8Array>();
  const removed: string[] = [];
  let sourceReads = 0;
  let rejectRemoval = false;
  function source(backend: ImageStorageBackend): VideoSourceStore {
    return {
      backend,
      async write(key, bytes) {
        sources.set(backend + "/" + key, bytes.slice());
      },
      async read(key) {
        sourceReads++;
        const value = sources.get(backend + "/" + key);
        if (!value) throw new Error("private missing source");
        return value;
      },
      async remove(key) {
        if (rejectRemoval) throw new Error("private cleanup failure");
        sources.delete(backend + "/" + key);
        removed.push(backend + "/" + key);
      },
    };
  }
  function derivative(backend: ImageStorageBackend): ImageObjectStore {
    return {
      backend,
      async write(kind, key, bytes) {
        assert.equal(kind, "video");
        derivatives.set(backend + "/" + key, bytes.slice());
      },
      async read(_kind, key) {
        return derivatives.get(backend + "/" + key)!;
      },
      async remove(_kind, key) {
        derivatives.delete(backend + "/" + key);
        removed.push(backend + "/" + key);
      },
    };
  }
  const storage: VideoProcessingStorage = { sources: source, derivatives: derivative };
  return {
    storage,
    sources,
    derivatives,
    removed,
    get sourceReads() {
      return sourceReads;
    },
    set rejectRemoval(value: boolean) {
      rejectRemoval = value;
    },
  };
}
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(baseSchema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;");
  owner = await member("영상 처리 작성자");
  other = await member("다른 작성자");
});
after(() => pg.close());

test("enqueue acknowledges private durable originals without pending video assets or private DTO fields", async () => {
  const memory = memoryStorage();
  const receipt = await service.enqueue(owner, raw, memory.storage.sources("supabase"));
  assert.equal(receipt.status, "queued");
  assert.equal(receipt.statusUrl, "/api/videos/jobs/" + receipt.jobId);
  assert.equal((await db.select().from(videoAssets)).length, 0);
  const [job] = await db.select().from(videoProcessingJobs);
  assert.equal(job?.sourceReady, true);
  assert.equal(job?.sourceStorageBackend, "supabase");
  assert.equal(memory.sources.size, 1);
  const view = await service.view(receipt.jobId, owner);
  assert.deepEqual(Object.keys(view).sort(), ["error", "jobId", "status", "video"]);
  assert.equal(view.video, null);
  for (const privateValue of [owner, ".bin", "storageBackend", "sourceObjectKey"])
    assert.equal(JSON.stringify(view).includes(privateValue), false);
  await assert.rejects(service.view(receipt.jobId, other), code("NOT_FOUND"));
  await assert.rejects(service.view(receipt.jobId, null), code("UNAUTHENTICATED"));
});

test("a worker uses the recorded source backend, publishes only a bounded derivative and removes the original", async () => {
  const memory = memoryStorage();
  const receipt = await service.enqueue(owner, raw, memory.storage.sources("supabase"));
  const worker = videoWorker(database, {
    storage: memory.storage,
    derivativeBackend: "local",
    transcode: async (bytes) => {
      assert.deepEqual(bytes, raw);
      return compressed;
    },
  });
  assert.deepEqual(await worker.drain(), { processed: 1 });
  assert.equal(memory.sourceReads, 1);
  assert.equal(memory.sources.size, 0);
  assert.equal(memory.derivatives.size, 1);
  const view = await service.view(receipt.jobId, owner);
  assert.equal(view.status, "ready");
  assert.equal(view.video?.contentType, "video/mp4");
  assert.equal(view.video?.byteSize, compressed.bytes.byteLength);
  assert.equal(view.video?.src, "/api/videos/" + view.video?.id);
  assert.equal(view.error, null);
  const [job] = await db.select().from(videoProcessingJobs);
  const [output] = await db.select().from(videoProcessingOutputs);
  assert.ok(job?.sourceRemovedAt);
  assert.ok(output?.publishedAt);
  assert.equal(output?.removedAt, null);
  assert.deepEqual(await worker.drain(), { processed: 0 });
  assert.equal((await db.select().from(videoAssets)).length, 1);
});

test("duplicate claims are excluded and expired leases fence stale success and failure", async () => {
  const memory = memoryStorage();
  const receipt = await service.enqueue(owner, raw, memory.storage.sources("local"));
  const first = await service.claim("local");
  assert.ok(first);
  assert.equal(await videoProcessingService(database).claim("local"), null);
  await db
    .update(videoProcessingJobs)
    .set({ leaseExpiresAt: sql`statement_timestamp()-interval '1 second'` })
    .where(eq(videoProcessingJobs.id, receipt.jobId));
  const next = await videoProcessingService(database).claim("supabase");
  assert.ok(next);
  assert.notEqual(next.output.id, first.output.id);
  assert.equal(next.job.attempts, 2);
  assert.equal(await service.complete(first, compressed), false);
  assert.equal(await service.fail(first, new Error("old private worker error")), false);
  assert.equal((await db.select().from(videoAssets)).length, 0);
  await memory.storage
    .derivatives("supabase")
    .write("video", next.output.objectKey, compressed.bytes);
  assert.equal(await service.complete(next, compressed), true);
  assert.equal((await db.select().from(videoAssets)).length, 1);
  const [oldOutput] = await db
    .select()
    .from(videoProcessingOutputs)
    .where(eq(videoProcessingOutputs.id, first.output.id));
  assert.ok(oldOutput?.discardedAt);
});

test("transient failures retry at most three times and permanent failure exposes only a safe message", async () => {
  const memory = memoryStorage();
  const receipt = await service.enqueue(owner, raw, memory.storage.sources("local"));
  const worker = videoWorker(database, {
    storage: memory.storage,
    derivativeBackend: "local",
    transcode: async () => {
      throw new Error("secret-user-path token=private");
    },
  });
  for (let attempt = 1; attempt <= 3; attempt++) {
    await worker.drain();
    const [job] = await db.select().from(videoProcessingJobs);
    assert.equal(job?.attempts, attempt);
    assert.equal(job?.status, attempt < 3 ? "queued" : "failed");
    assert.equal(memory.sources.size, attempt < 3 ? 1 : 0);
    await db
      .update(videoProcessingJobs)
      .set({ availableAt: sql`statement_timestamp()` })
      .where(eq(videoProcessingJobs.id, receipt.jobId));
  }
  assert.deepEqual(await worker.drain(), { processed: 0 });
  const view = await service.view(receipt.jobId, owner);
  assert.equal(view.status, "failed");
  assert.ok(view.error);
  assert.equal(JSON.stringify(view).includes("private"), false);
  assert.equal((await db.select().from(videoAssets)).length, 0);
  assert.equal(memory.derivatives.size, 0);
  assert.ok((await db.select().from(videoProcessingOutputs)).every((output) => !!output.removedAt));
});

test("invalid media fails once and shutdown interruption preserves the queued original without consuming an attempt", async () => {
  const invalidMemory = memoryStorage();
  const invalid = await service.enqueue(owner, raw, invalidMemory.storage.sources("local"));
  await videoWorker(database, {
    storage: invalidMemory.storage,
    derivativeBackend: "local",
    transcode: async () => {
      throw new AppError("VALIDATION", "private unsafe source message");
    },
  }).drain();
  assert.equal((await service.view(invalid.jobId, owner)).status, "failed");
  assert.equal(invalidMemory.sources.size, 0);
  const memory = memoryStorage();
  const receipt = await service.enqueue(owner, raw, memory.storage.sources("local"));
  const controller = new AbortController();
  let started!: () => void;
  const processing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const worker = videoWorker(database, {
    storage: memory.storage,
    derivativeBackend: "local",
    transcode: async (_bytes, signal) => {
      started();
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("shutdown")), { once: true });
      });
    },
  });
  const draining = worker.drain(controller.signal);
  await processing;
  controller.abort();
  await draining;
  const [job] = await db
    .select()
    .from(videoProcessingJobs)
    .where(eq(videoProcessingJobs.id, receipt.jobId));
  assert.equal(job?.status, "queued");
  assert.equal(job?.attempts, 0);
  assert.equal(memory.sources.size, 1);
  assert.equal(job?.lockToken, null);
});

test("a failed original write retains its cleanup address until storage removal succeeds", async () => {
  const memory = memoryStorage();
  const source = memory.storage.sources("local");
  memory.rejectRemoval = true;
  const failing: VideoSourceStore = {
    ...source,
    async write(key, bytes) {
      await source.write(key, bytes);
      throw new AppError("INTERNAL", "private storage write failure");
    },
  };
  await assert.rejects(service.enqueue(owner, raw, failing), code("INTERNAL"));
  const [job] = await db.select().from(videoProcessingJobs);
  assert.equal(job?.status, "failed");
  assert.equal(job?.sourceRemovedAt, null);
  assert.equal(memory.sources.size, 1);
  memory.rejectRemoval = false;
  await service.cleanup(memory.storage);
  assert.equal(memory.sources.size, 0);
  assert.ok((await db.select().from(videoProcessingJobs))[0]?.sourceRemovedAt);
  assert.equal((await db.select().from(videoAssets)).length, 0);
});

test("source acknowledgement failure rolls back publication and cleans the reserved original", async () => {
  const memory = memoryStorage();
  const failingDb = new Proxy(database, {
    get(target, property, receiver) {
      if (property !== "update") return Reflect.get(target, property, receiver);
      return (table: typeof videoProcessingJobs) => {
        const builder = target.update(table);
        return new Proxy(builder, {
          get(updateTarget, key, updateReceiver) {
            if (key !== "set") return Reflect.get(updateTarget, key, updateReceiver);
            return (values: Parameters<typeof builder.set>[0]) => {
              if (values.sourceReady === true) throw new Error("private acknowledgement failure");
              return builder.set(values);
            };
          },
        });
      };
    },
  });
  await assert.rejects(
    videoProcessingService(failingDb).enqueue(owner, raw, memory.storage.sources("local")),
    /acknowledgement failure/,
  );
  assert.equal(memory.sources.size, 0);
  const [job] = await db.select().from(videoProcessingJobs);
  assert.equal(job?.status, "failed");
  assert.ok(job?.sourceRemovedAt);
  assert.equal((await db.select().from(videoAssets)).length, 0);
});

test("the per-user pending bound rejects a fourth job across service instances", async () => {
  const memory = memoryStorage();
  for (let index = 0; index < 3; index++)
    await videoProcessingService(database).enqueue(owner, raw, memory.storage.sources("local"));
  await assert.rejects(
    videoProcessingService(database).enqueue(owner, raw, memory.storage.sources("local")),
    code("RATE_LIMITED"),
  );
  await service.enqueue(other, raw, memory.storage.sources("local"));
  assert.equal((await db.select().from(videoProcessingJobs)).length, 4);
  assert.equal(memory.sources.size, 4);
});

test("TTL cleanup expires abandoned uploads and removes a crash-created unpublished derivative", async () => {
  const memory = memoryStorage();
  const id = randomUUID();
  await db.insert(videoProcessingJobs).values({
    id,
    uploaderId: owner,
    sourceObjectKey: id + ".bin",
    sourceStorageBackend: "local",
    sourceByteSize: 4,
    createdAt: new Date(Date.now() - 3600000),
    uploadExpiresAt: new Date(Date.now() - 600000),
    sourceExpiresAt: new Date(Date.now() + 3600000),
  });
  await memory.storage.sources("local").write(id + ".bin", raw);
  await service.cleanup(memory.storage);
  assert.equal((await service.view(id, owner)).status, "failed");
  assert.equal(memory.sources.size, 0);
  const receipt = await service.enqueue(owner, raw, memory.storage.sources("local"));
  const claimed = await service.claim("local");
  assert.ok(claimed);
  await memory.storage
    .derivatives("local")
    .write("video", claimed.output.objectKey, compressed.bytes);
  await db
    .update(videoProcessingJobs)
    .set({ leaseExpiresAt: sql`statement_timestamp()-interval '1 second'` })
    .where(eq(videoProcessingJobs.id, receipt.jobId));
  await db
    .update(videoProcessingOutputs)
    .set({ cleanupAt: sql`statement_timestamp()-interval '1 second'` })
    .where(eq(videoProcessingOutputs.id, claimed.output.id));
  await service.cleanup(memory.storage);
  assert.equal(memory.derivatives.size, 0);
  assert.equal(await service.complete(claimed, compressed), false);
});

test("deleting a post with a worker result does not block asset cascading or retain a public result", async () => {
  const memory = memoryStorage();
  const receipt = await service.enqueue(owner, raw, memory.storage.sources("local"));
  await videoWorker(database, {
    storage: memory.storage,
    derivativeBackend: "local",
    transcode: async () => compressed,
  }).drain();
  const result = await service.view(receipt.jobId, owner);
  assert.ok(result.video);
  const post = await communityService(database).createPost(owner, {
    categorySlug: "party",
    kind: "이야기",
    title: "비동기 영상 삭제",
    bodyMarkdown: "영상 본문",
    bodyDocument: {
      version: 1,
      type: "doc",
      content: [{ type: "uploadedVideo", attrs: { assetId: result.video.id } }],
    },
  });
  await communityService(database).deletePost(owner, post.id);
  await db.delete(baseSchema.posts).where(eq(baseSchema.posts.id, post.id));
  assert.equal((await db.select().from(videoAssets)).length, 0);
  await assert.rejects(service.view(receipt.jobId, owner), code("NOT_FOUND"));
  await service.cleanup(memory.storage);
});

test("original storage rejects public buckets and traversal and stays outside derivative directories", async () => {
  const api: SupabaseImageStorageApi = {
    async getBucket() {
      return { data: { public: true }, error: null };
    },
    from() {
      throw new Error("public storage must not be used");
    },
  };
  await assert.rejects(
    supabaseVideoSourceStore(api, "media").write(randomUUID() + ".bin", raw),
    code("INTERNAL"),
  );
  const directory = await mkdtemp(path.join(tmpdir(), "sliper-video-source-test-"));
  const store = localVideoSourceStore(directory);
  const key = randomUUID() + ".bin";
  try {
    await assert.rejects(store.write("../private.bin", raw), code("NOT_FOUND"));
    await assert.rejects(store.write(randomUUID() + ".bin", new Uint8Array()), code("VALIDATION"));
    await store.write(key, raw);
    assert.deepEqual(await store.read(key), Buffer.from(raw));
    assert.deepEqual(await readdir(path.join(directory, ".local")), ["video-sources"]);
    await store.remove(key);
    await store.remove(key);
  } finally {
    await store.remove(key);
    await rmdir(path.join(directory, ".local", "video-sources"));
    await rmdir(path.join(directory, ".local"));
    await rmdir(directory);
  }
});

test("a source write completing after reservation cleanup reopens cleanup and removes its late original", async () => {
  const memory = memoryStorage();
  const source = memory.storage.sources("local");
  const late: VideoSourceStore = {
    ...source,
    async write(key, bytes) {
      const id = key.slice(0, -4);
      await db
        .update(videoProcessingJobs)
        .set({ status: "failed", lastErrorCode: "EXPIRED" })
        .where(eq(videoProcessingJobs.id, id));
      await service.cleanup(memory.storage);
      assert.ok(
        (await db.select().from(videoProcessingJobs).where(eq(videoProcessingJobs.id, id)))[0]
          ?.sourceRemovedAt,
      );
      await source.write(key, bytes);
    },
  };
  await assert.rejects(service.enqueue(owner, raw, late), code("INTERNAL"));
  assert.equal(memory.sources.size, 0);
  const [job] = await db.select().from(videoProcessingJobs);
  assert.equal(job?.status, "failed");
  assert.ok(job?.sourceRemovedAt);
});
