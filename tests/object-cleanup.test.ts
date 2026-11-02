import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { objectCleanupJobs as jobs } from "../src/db/object-cleanup-schema";
import type { Database } from "../src/db/connection";
import { profilePhotoService } from "../src/server/profile-photo-service";
import { persistManagedImage } from "../src/server/image-persistence";
import { enqueueObjectCleanup, objectCleanupService } from "../src/server/object-cleanup-service";
import type { ImageObjectStore } from "../src/server/image-storage-core";
const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database;
let owner: string;
let files: Map<string, Uint8Array>;
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;truncate sliper.object_cleanup_jobs");
  owner = randomUUID();
  await pg.query("insert into auth.users values($1)", [owner]);
  await db.insert(schema.profiles).values({ id: owner, nickname: "정리검증" });
  files = new Map();
});
after(() => pg.close());
const stored = () => {
  const id = randomUUID();
  return {
    id,
    objectKey: id + ".webp",
    storageBackend: "local" as const,
    contentType: "image/webp" as const,
    bytes: 3,
  };
};
function store(): ImageObjectStore {
  return {
    backend: "local",
    write: async (_kind, key, bytes) => {
      assert.equal((await db.select().from(jobs)).length, 1);
      files.set(key, bytes);
    },
    read: async (_kind, key) => files.get(key)!,
    remove: async (_kind, key) => {
      files.delete(key);
    },
  };
}
test("upload intent precedes object write and metadata/intent removal commit together", async () => {
  const photo = stored();
  await persistManagedImage(
    connection,
    store(),
    "profile",
    photo.objectKey,
    new Uint8Array([1, 2, 3]),
    async (tx, object) => {
      await profilePhotoService(tx as Database).replaceStored(owner, { ...photo, ...object });
    },
  );
  assert.ok(files.has(photo.objectKey));
  assert.equal((await db.select().from(jobs)).length, 0);
  assert.equal((await db.select().from(schema.profilePhotos)).length, 1);
});
test("failed metadata and transient deletion retain an address and retry after recovery", async () => {
  const photo = stored();
  await assert.rejects(
    persistManagedImage(
      connection,
      store(),
      "profile",
      photo.objectKey,
      new Uint8Array([1, 2, 3]),
      async () => {
        throw Error("DB callback failure");
      },
    ),
  );
  assert.ok(files.has(photo.objectKey));
  assert.equal((await db.select().from(jobs)).length, 1);
  let failed = true;
  const worker = objectCleanupService(connection, async (job) => {
    if (failed) throw Error("temporary storage outage");
    files.delete(job.objectKey);
  });
  await worker.drain();
  const [job] = await db.select().from(jobs);
  assert.equal(job!.status, "pending");
  assert.equal(job!.attempts, 1);
  assert.equal(job!.errorCode, "STORAGE_DELETE_FAILED");
  failed = false;
  await db
    .update(jobs)
    .set({ availableAt: new Date(0) })
    .where(eq(jobs.id, job!.id));
  await worker.drain();
  assert.equal(files.size, 0);
  assert.equal((await db.select().from(jobs)).length, 0);
});
test("profile replacement/clear enqueue previous addresses atomically and rollback preserves photo", async () => {
  const photos = profilePhotoService(connection),
    a = stored(),
    b = stored();
  await photos.replaceStored(owner, a);
  await photos.replaceStored(owner, b);
  let rows = await db.select().from(jobs);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.objectKey, a.objectKey);
  await assert.rejects(
    db.transaction(async (tx) => {
      await profilePhotoService(tx as unknown as Database).clearStored(owner);
      throw Error("rollback");
    }),
  );
  assert.equal((await db.select().from(schema.profilePhotos))[0]!.objectKey, b.objectKey);
  assert.equal((await db.select().from(jobs)).length, 1);
  await photos.clearStored(owner);
  rows = await db.select().from(jobs);
  assert.equal(rows.length, 2);
  assert.ok(rows.some((j) => j.objectKey === b.objectKey));
});
test("worker cannot remove a currently referenced object or let stale lease owners acknowledge new work", async () => {
  const photo = stored();
  await profilePhotoService(connection).replaceStored(owner, photo);
  const id = await enqueueObjectCleanup(
    connection,
    { kind: "profile", storageBackend: "local", objectKey: photo.objectKey },
    "profile-cleared",
  );
  let deletes = 0;
  await objectCleanupService(connection, async () => {
    deletes++;
  }).processOne(id);
  assert.equal(deletes, 0);
  assert.equal((await db.select().from(schema.profilePhotos)).length, 1);
  assert.equal((await db.select().from(jobs)).length, 0);
});
test("upload completing after cleanup was claimed is rejected and rearms its orphan address", async () => {
  const photo = stored();
  let finish!: () => void;
  const original = store();
  const slow = {
    ...original,
    write: async (_kind: string, key: string, bytes: Uint8Array) => {
      await new Promise<void>((r) => {
        finish = r;
      });
      files.set(key, bytes);
    },
  } as ImageObjectStore;
  const pending = persistManagedImage(
    connection,
    slow,
    "profile",
    photo.objectKey,
    new Uint8Array([1, 2, 3]),
    async (tx, object) =>
      profilePhotoService(tx as Database).replaceStored(owner, { ...photo, ...object }),
  );
  while (!finish) await new Promise((r) => setTimeout(r, 1));
  await db.update(jobs).set({ availableAt: new Date(0) });
  await objectCleanupService(connection, async (job) => {
    files.delete(job.objectKey);
  }).drain();
  finish();
  await assert.rejects(pending);
  assert.equal((await db.select().from(schema.profilePhotos)).length, 0);
  assert.equal((await db.select().from(jobs)).length, 1);
  await objectCleanupService(connection, async (job) => {
    files.delete(job.objectKey);
  }).drain();
  assert.equal(files.size, 0);
});
