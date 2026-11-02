import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import {
  CloudCaptureError,
  openManifest,
  pgEnvironment,
  sameSnapshot,
  sealManifest,
  storageBackupPath,
  validateCloudManifest,
  type CloudManifest,
} from "../scripts/lib/cloud-capture";
import { newBackupId } from "../scripts/lib/local-backup-core";
function fixture(): CloudManifest {
  const descriptor = {
    path: "database.pgdump.enc",
    plainBytes: 12,
    plainSha256: "a".repeat(64),
    cipherBytes: 12,
    cipherSha256: "b".repeat(64),
    iv: "c".repeat(24),
    tag: "d".repeat(32),
  };
  return {
    version: 1,
    kind: "sliper-supabase-capture",
    id: newBackupId(),
    capturedAt: new Date().toISOString(),
    project: "a".repeat(20),
    serverMajor: 17,
    bucket: "sliper-private-images",
    database: descriptor,
    snapshot: {
      tables: { "auth.users": { count: "1", digest: "e".repeat(32) } },
      structure: [
        {
          schema: "auth",
          name: "users",
          rls: true,
          force_rls: false,
          indexes: 1,
          constraints: 1,
          policies: 0,
        },
      ],
    },
    roles: ["authenticated"],
    objects: [
      {
        storagePath: "profiles/11111111-1111-4111-8111-111111111111.webp",
        file: {
          ...descriptor,
          path: "media/profile-photos/11111111-1111-4111-8111-111111111111.webp.enc",
        },
      },
    ],
  };
}
test("cloud storage paths map to validated private archive paths and reject traversal and unsupported folders", () => {
  assert.equal(
    storageBackupPath("profiles/11111111-1111-4111-8111-111111111111.webp"),
    "media/profile-photos/11111111-1111-4111-8111-111111111111.webp.enc",
  );
  for (const bad of [
    "../key",
    "posts/../../x.webp",
    "other/11111111-1111-4111-8111-111111111111.webp",
    "profiles/11111111-1111-4111-8111-111111111111.bin",
    "posts//x.webp",
    "videos/nested/x.mp4",
  ])
    assert.throws(() => storageBackupPath(bad));
});
test("cloud manifest encryption authenticates identity, bytes, key, and metadata without exposing content", () => {
  const m = fixture(),
    key = randomBytes(32),
    sealed = sealManifest(m, key);
  assert.equal(sealed.bytes.includes(Buffer.from(m.objects[0]!.storagePath)), false);
  assert.deepEqual(openManifest(sealed.bytes, sealed.envelope, key, m.id), m);
  const altered = Buffer.from(sealed.bytes);
  altered[0] = altered[0]! ^ 1;
  assert.throws(() => openManifest(altered, sealed.envelope, key, m.id), /MANIFEST_AUTHENTICATION/);
  assert.throws(
    () => openManifest(sealed.bytes, sealed.envelope, randomBytes(32), m.id),
    /MANIFEST_AUTHENTICATION/,
  );
  assert.throws(
    () => openManifest(sealed.bytes, { ...sealed.envelope, id: newBackupId() }, key, m.id),
    /MANIFEST_AUTHENTICATION/,
  );
});
test("cloud manifests cannot change file mapping, duplicate files, or inject a schema or role", () => {
  const m = fixture();
  assert.equal(validateCloudManifest(m, m.id).id, m.id);
  for (const bad of [
    { ...m, objects: [...m.objects, ...m.objects] },
    { ...m, objects: [{ ...m.objects[0], file: { ...m.objects[0]!.file, path: "../key" } }] },
    { ...m, roles: ["role;drop schema auth"] },
    {
      ...m,
      snapshot: {
        ...m.snapshot,
        tables: { "public.unrelated": { count: "1", digest: "a".repeat(32) } },
      },
    },
  ])
    assert.throws(() => validateCloudManifest(bad, m.id));
});
test("restore comparison checks every table row digest and RLS/catalog counts", () => {
  const s = fixture().snapshot;
  sameSnapshot(s, JSON.parse(JSON.stringify(s)));
  assert.throws(
    () =>
      sameSnapshot({ ...s, tables: { "auth.users": { count: "1", digest: "f".repeat(32) } } }, s),
    /RESTORE_SNAPSHOT_MISMATCH/,
  );
  assert.throws(
    () => sameSnapshot({ ...s, structure: [{ ...s.structure[0], rls: false }] }, s),
    /RESTORE_SNAPSHOT_MISMATCH/,
  );
});
test("native dump environment carries credentials only in env, does not inherit application secrets", () => {
  const env = pgEnvironment(
    "postgresql://operator:synthetic-fixture@db.example.test:5432/postgres?sslmode=require",
  );
  assert.equal(env.PGPASSWORD, "synthetic-fixture");
  assert.equal(env.PGSSLMODE, "require");
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.SUPABASE_STORAGE_SECRET_KEY, undefined);
  assert.equal(new CloudCaptureError("SAFE_CODE").message, "SAFE_CODE");
});

test("server recovery encryption cannot be substituted for a DB manifest and rejects altered bytes", async () => {
  const { sealServerRecovery, openServerRecovery } = await import("../scripts/lib/cloud-capture");
  const key = randomBytes(32),
    id = newBackupId(),
    plain = Buffer.from("private-config-fixture");
  const sealed = sealServerRecovery(plain, key, id);
  assert.deepEqual(openServerRecovery(sealed.bytes, sealed.envelope, key, id), plain);
  assert.equal(sealed.bytes.includes(plain), false);
  assert.throws(
    () => openManifest(sealed.bytes, sealed.envelope, key, id),
    /MANIFEST_AUTHENTICATION/,
  );
  assert.throws(
    () => openServerRecovery(sealed.bytes, sealed.envelope, randomBytes(32), id),
    /RECOVERY_AUTHENTICATION/,
  );
});

test("cloud capture refuses missing required bytes or local-only references while allowing already removed optional outputs", async () => {
  const { requireCloudMedia } = await import("../scripts/lib/cloud-capture");
  const key = "11111111-1111-4111-8111-111111111111.webp";
  const ref = { key, folder: "profile-photos", backend: "supabase", required: true };
  assert.equal(requireCloudMedia([ref], ["profiles/" + key]), 1);
  assert.throws(() => requireCloudMedia([ref], []), /REQUIRED_STORAGE_OBJECT_MISSING/);
  assert.throws(
    () => requireCloudMedia([{ ...ref, backend: "local" }], []),
    /LOCAL_MEDIA_NOT_CAPTURED/,
  );
  assert.equal(requireCloudMedia([{ ...ref, required: false }], []), 0);
});
