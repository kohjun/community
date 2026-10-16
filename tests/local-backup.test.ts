import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import {
  argumentsFor,
  assertSnapshot,
  backupId,
  childEnvironment,
  containedPath,
  decryptFile,
  encryptStream,
  initializeBackup,
  initializeRestore,
  localConfiguration,
  mediaInventory,
  mediaPath,
  newBackupId,
  newRestoreDatabase,
  publicFailure,
  requireMedia,
  restoreDatabase,
  signManifest,
  validateManifest,
  verifyPackage,
  storageInventoryQuery,
  type BackupFile,
  type BackupManifest,
  type DatabaseSnapshot,
} from "../scripts/lib/local-backup-core";

let workspace: string;
before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "sliper-backup-test-"));
});
after(async () => {
  const absolute = path.resolve(workspace),
    temporaryRoot = path.resolve(os.tmpdir());
  const relative = path.relative(temporaryRoot, absolute);
  assert.ok(
    relative.startsWith("sliper-backup-test-") &&
      !relative.includes(path.sep) &&
      !path.isAbsolute(relative),
  );
  await rm(absolute, { recursive: true, force: true });
});
const uuid = "57f066fc-8212-4f77-b699-176204ffde3a";
function metadata(id: string, files: BackupFile[]): Omit<BackupManifest, "hmac"> {
  return {
    version: 1,
    id,
    createdAt: new Date().toISOString(),
    source: "local-sliper-dev",
    compression: "none",
    encryption: "AES-256-GCM+HKDF-SHA256+HMAC-SHA256",
    serverMajor: 18,
    tableCounts: { "sliper.posts": 2 },
    flowCounts: { application_identity: 0 },
    flowSha256: "a".repeat(64),
    files,
  };
}
async function fixture() {
  const id = newBackupId(),
    initialized = await initializeBackup(workspace, id);
  const payload = Buffer.from(
    "private SQL rows and private media must only exist in encrypted backup objects",
  );
  const file = await encryptStream(
    Readable.from(payload),
    containedPath(initialized.root, "database.pgdump.enc"),
    initialized.key,
    id,
    "database.pgdump.enc",
  );
  const manifest = signManifest(metadata(id, [file]), initialized.key);
  await writeFile(containedPath(initialized.root, "manifest.json"), JSON.stringify(manifest), {
    mode: 0o600,
  });
  return { id, ...initialized, payload, file, manifest };
}

test("local configuration and native child environment refuse production, remote sources and key leakage", () => {
  const password = randomBytes(24).toString("hex");
  const env = {
    LOCAL_DATABASE: "1",
    SLIPER_AUTH_MODE: "development",
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://postgres:" + password + "@127.0.0.1:55432/sliper_dev",
  };
  const config = localConfiguration(env);
  for (const override of [
    { LOCAL_DATABASE: "0" },
    { SLIPER_AUTH_MODE: "supabase" },
    { NODE_ENV: "production" },
    { DATABASE_URL: env.DATABASE_URL.replace("127.0.0.1", "example.com") },
    { DATABASE_URL: env.DATABASE_URL + "?sslmode=require" },
    { DATABASE_URL: env.DATABASE_URL.replace("sliper_dev", "postgres") },
  ])
    assert.throws(() => localConfiguration({ ...env, ...override }), /LOCAL_ONLY/);
  const child = childEnvironment(
    {
      ...env,
      SUPABASE_STORAGE_SECRET_KEY: randomBytes(20).toString("hex"),
      PGOPTIONS: "unsafe",
      PGSERVICE: "remote",
      VAPID_PRIVATE_KEY: randomBytes(20).toString("hex"),
    },
    config,
    "sliper_dev",
  );
  assert.equal(child.PGHOST, "127.0.0.1");
  assert.equal(child.PGPASSWORD, password);
  for (const name of [
    "DATABASE_URL",
    "SUPABASE_STORAGE_SECRET_KEY",
    "VAPID_PRIVATE_KEY",
    "PGSERVICE",
  ])
    assert.equal(child[name], undefined);
  assert.notEqual(child.PGOPTIONS, "unsafe");
  assert.equal(publicFailure(new Error(password)), "BACKUP_FAILED");
});

test("quiescence is mandatory and identifiers cannot target original DB or escape local storage", () => {
  assert.throws(() => argumentsFor([]), /QUIESCENT_REQUIRED/);
  assert.throws(() => argumentsFor(["--quiescent", "--quiescent"]), /INVALID_ARGUMENT/);
  assert.throws(() => argumentsFor(["--quiescent", "--clean"]), /INVALID_ARGUMENT/);
  const id = newBackupId();
  assert.equal(argumentsFor(["--quiescent", "--backup=" + id], true), id);
  for (const value of [
    "sliper_dev",
    "postgres",
    "sliper_restore_20261014000000_0123456789abcdef;drop database sliper_dev",
  ])
    assert.throws(() => restoreDatabase(value), /INVALID_PATH/);
  assert.equal(restoreDatabase(newRestoreDatabase()).startsWith("sliper_restore_"), true);
  assert.throws(() => backupId("../" + id), /INVALID_PATH/);
  for (const relative of ["../.env", "C:/Sliper/.env", ".local/../.env", "a\\b", "a//b"])
    assert.throws(() => containedPath(workspace, relative), /INVALID_PATH/);
  for (const relative of [
    "media/uploads/.env.enc",
    "media/profile-photos/" + uuid + ".png.enc",
    "media/video-sources/" + uuid + ".mp4.enc",
    "media/uploads/../../.env.enc",
  ])
    assert.throws(() => mediaPath(relative), /INVALID_PATH/);
});

test("encrypted objects authenticate ID/path, decrypt exact bytes, and leave no output after invalid key/tag", async () => {
  const captured = await fixture(),
    cipher = await readFile(containedPath(captured.root, captured.file.path));
  assert.equal(cipher.includes(captured.payload), false);
  const destination = containedPath(captured.root, "roundtrip.bin");
  await decryptFile(
    containedPath(captured.root, captured.file.path),
    destination,
    captured.key,
    captured.id,
    captured.file,
  );
  assert.deepEqual(await readFile(destination), captured.payload);
  const badKeyOutput = containedPath(captured.root, "wrong-key.bin");
  await assert.rejects(
    decryptFile(
      containedPath(captured.root, captured.file.path),
      badKeyOutput,
      randomBytes(32),
      captured.id,
      captured.file,
    ),
    /AUTHENTICATION_FAILED/,
  );
  await assert.rejects(readFile(badKeyOutput), { code: "ENOENT" });
  await assert.rejects(
    decryptFile(
      containedPath(captured.root, captured.file.path),
      containedPath(captured.root, "wrong-id.bin"),
      captured.key,
      newBackupId(),
      captured.file,
    ),
    /AUTHENTICATION_FAILED/,
  );
  const wrongPath = { ...captured.file, path: "media/uploads/" + uuid + ".webp.enc" };
  await assert.rejects(
    decryptFile(
      containedPath(captured.root, captured.file.path),
      containedPath(captured.root, "wrong-path.bin"),
      captured.key,
      captured.id,
      wrongPath,
    ),
    /AUTHENTICATION_FAILED/,
  );
});

test("manifest HMAC refuses altered rows, foreign IDs, unsafe paths and duplicate files even when JSON parses", async () => {
  const captured = await fixture();
  assert.equal(validateManifest(captured.manifest, captured.key, captured.id).id, captured.id);
  assert.throws(
    () =>
      validateManifest(
        { ...captured.manifest, tableCounts: { "sliper.posts": 3 } },
        captured.key,
        captured.id,
      ),
    /AUTHENTICATION_FAILED/,
  );
  assert.throws(
    () => validateManifest(captured.manifest, randomBytes(32), captured.id),
    /AUTHENTICATION_FAILED/,
  );
  assert.throws(
    () => validateManifest(captured.manifest, captured.key, newBackupId()),
    /INVALID_MANIFEST/,
  );
  assert.throws(
    () =>
      validateManifest(
        signManifest(metadata(captured.id, [captured.file, captured.file]), captured.key),
        captured.key,
        captured.id,
      ),
    /INVALID_MANIFEST/,
  );
  const badPath = { ...captured.file, path: "../.env" };
  assert.throws(
    () =>
      validateManifest(
        signManifest(metadata(captured.id, [captured.file, badPath]), captured.key),
        captured.key,
        captured.id,
      ),
    /INVALID_PATH/,
  );
});

test("package verification rejects ciphertext corruption, missing key, and unexpected plaintext before any DB is available", async () => {
  const captured = await fixture();
  assert.equal((await verifyPackage(workspace, captured.id)).manifest.id, captured.id);
  const location = containedPath(captured.root, captured.file.path),
    bytes = await readFile(location);
  bytes[0] = bytes[0]! ^ 1;
  await writeFile(location, bytes);
  await assert.rejects(verifyPackage(workspace, captured.id), /HASH_MISMATCH/);
  const other = await fixture();
  await writeFile(containedPath(other.root, ".env"), "must not be archived", { mode: 0o600 });
  await assert.rejects(verifyPackage(workspace, other.id), /HASH_MISMATCH/);
  const missingKey = await fixture();
  await rm(missingKey.keyPath);
  await assert.rejects(verifyPackage(workspace, missingKey.id));
});

test("media inventory excludes env/test-account files, preserves allowed media and rejects a linked storage directory", async () => {
  const mediaWorkspace = containedPath(workspace, "inventory");
  await mkdir(mediaWorkspace);
  await mkdir(containedPath(mediaWorkspace, ".local/uploads"), { recursive: true });
  await writeFile(containedPath(mediaWorkspace, ".env"), "private");
  await writeFile(containedPath(mediaWorkspace, ".local/uploads/.env"), "private");
  await writeFile(
    containedPath(mediaWorkspace, ".local/uploads/" + uuid + ".webp"),
    "real image bytes",
  );
  const files = await mediaInventory(mediaWorkspace);
  assert.deepEqual(
    files.map((file) => file.relative),
    ["media/uploads/" + uuid + ".webp.enc"],
  );
  const outside = containedPath(workspace, "outside");
  await mkdir(outside);
  await symlink(
    outside,
    containedPath(mediaWorkspace, ".local/videos"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(mediaInventory(mediaWorkspace), /UNSAFE_FILE/);
});

test("isolated restore paths use a generated new directory and cannot overwrite a previous rehearsal", async () => {
  const id = newRestoreDatabase(),
    root = await initializeRestore(workspace, id);
  assert.equal(path.relative(workspace, root), path.join(".local", "restores", id));
  await assert.rejects(initializeRestore(workspace, id), { code: "EEXIST" });
  await assert.rejects(initializeRestore(workspace, "sliper_dev"), /INVALID_PATH/);
});

test("restore equality requires row content, sequence/flow counts and all required physical media", () => {
  const snapshot: DatabaseSnapshot = {
    tableCounts: { "sliper.posts": 2 },
    flowCounts: { sequence_state: 1, admission_identity: 2 },
    flowSha256: "a".repeat(64),
    serverMajor: 18,
    requiredMedia: ["media/uploads/" + uuid + ".webp.enc"],
  };
  assertSnapshot(snapshot, { ...snapshot });
  assert.throws(
    () => assertSnapshot({ ...snapshot, flowSha256: "b".repeat(64) }, snapshot),
    /RESTORE_MISMATCH/,
  );
  assert.throws(
    () =>
      assertSnapshot(
        { ...snapshot, flowCounts: { ...snapshot.flowCounts, admission_identity: 1 } },
        snapshot,
      ),
    /RESTORE_MISMATCH/,
  );
  assert.throws(() => requireMedia(snapshot, []), /SOURCE_MEDIA_MISSING/);
  requireMedia(snapshot, snapshot.requiredMedia);
});

test("published video metadata remains in backups after retention, but requires no deleted bytes; active videos still require bytes", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const { mediaRetentionService } = await import("../src/server/media-retention-service");
  const pg = new PGlite(),
    db = drizzle(pg);
  try {
    await pg.exec(
      "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated",
    );
    await migrate(db, { migrationsFolder: "./drizzle" });
    const owner = randomUUID(),
      oldAsset = randomUUID(),
      activeAsset = randomUUID();
    await pg.query("insert into auth.users(id) values($1)", [owner]);
    await pg.query("insert into sliper.profiles(id,nickname) values($1,'복원 검증 회원')", [owner]);
    for (const [id, age] of [
      [oldAsset, 31],
      [activeAsset, 1],
    ] as const) {
      const job = randomUUID();
      await pg.query(
        "insert into sliper.video_assets(id,uploader_id,object_key,byte_size,width,height,duration_seconds,status,unattached_since) values($1,$2,$3,100,10,10,1,'ready',now()-($4::integer*interval '1 day'))",
        [id, owner, id + ".mp4", age],
      );
      await pg.query(
        "insert into sliper.video_processing_jobs(id,uploader_id,source_object_key,source_storage_backend,source_byte_size,source_ready) values($1,$2,$3,'local',100,true)",
        [job, owner, job + ".bin"],
      );
      await pg.query(
        "insert into sliper.video_processing_outputs(id,job_id,object_key,storage_backend,published_at) values($1,$2,$3,'local',now())",
        [id, job, id + ".mp4"],
      );
      await pg.query(
        "update sliper.video_processing_jobs set status='ready',result_asset_id=$2,source_removed_at=now() where id=$1",
        [job, id],
      );
    }
    const readRequired = async () =>
      (await pg.query<{ key: string; required: boolean }>(storageInventoryQuery)).rows
        .filter((row) => row.required)
        .map((row) => row.key);
    assert.ok((await readRequired()).includes(oldAsset + ".mp4"));
    const service = mediaRetentionService(db as unknown as import("../src/db/connection").Database);
    assert.equal(await service.reserve(), 1);
    const job = await service.claim();
    assert.ok(job);
    await service.process(job, async () => {});
    const required = await readRequired();
    assert.equal(required.includes(oldAsset + ".mp4"), false);
    assert.ok(required.includes(activeAsset + ".mp4"));
    const outputs = await pg.query<{ count: number | string }>(
      "select count(*) as count from sliper.video_processing_outputs",
    );
    assert.equal(Number(outputs.rows[0]!.count), 2);
    assert.throws(
      () => requireMedia({ requiredMedia: ["media/videos/" + activeAsset + ".mp4.enc"] }, []),
      /SOURCE_MEDIA_MISSING/,
    );
  } finally {
    await pg.close();
  }
});
