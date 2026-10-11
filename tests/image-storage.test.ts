import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rmdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { isImageStorageKey } from "../src/domain/image-storage";
import {
  imageStorageConfiguration,
  ImageStorageConfigurationError,
} from "../src/server/image-storage-config";
import {
  localImageObjectStore,
  persistImageObject,
  supabaseImageObjectStore,
  type ImageObjectStore,
  type SupabaseImageStorageApi,
} from "../src/server/image-storage-core";
import { AppError } from "../src/server/errors";

const key = () => randomUUID() + ".webp";
const bytes = new Uint8Array([82, 73, 70, 70, 87, 69, 66, 80]);
// In-memory adapter tests use a disposable mock key; never load production credentials here.
const config = {
  MEDIA_STORAGE_BACKEND: "supabase",
  SUPABASE_STORAGE_URL: "https://project.supabase.co",
  SUPABASE_STORAGE_SECRET_KEY: `sb_secret_${randomBytes(32).toString("hex")}`,
  SUPABASE_STORAGE_BUCKET: "sliper-private-images",
};
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
function transport() {
  const calls: { operation: string; object?: string; options?: unknown }[] = [];
  const api: SupabaseImageStorageApi = {
    async getBucket(bucket) {
      calls.push({ operation: "bucket", object: bucket });
      return { data: { public: false }, error: null };
    },
    from(bucket) {
      assert.equal(bucket, config.SUPABASE_STORAGE_BUCKET);
      return {
        async upload(object, data, options) {
          calls.push({ operation: "upload", object, options });
          assert.deepEqual(data, bytes);
          return { data: { path: object }, error: null };
        },
        async download(object) {
          calls.push({ operation: "download", object });
          return { data: new Blob([bytes], { type: "image/webp" }), error: null };
        },
        async remove(objects) {
          assert.equal(objects.length, 1);
          calls.push({ operation: "remove", object: objects[0]! });
          return { data: [], error: null };
        },
      };
    },
  };
  return { api, calls };
}
test("storage configuration defaults to local and explicit old-row backend bypasses new remote config", () => {
  assert.deepEqual(imageStorageConfiguration(undefined, {}), { backend: "local" });
  assert.deepEqual(imageStorageConfiguration("local", { MEDIA_STORAGE_BACKEND: "supabase" }), {
    backend: "local",
  });
  const remote = imageStorageConfiguration(undefined, config);
  assert.equal(remote.backend, "supabase");
  if (remote.backend === "supabase") assert.equal(remote.url, config.SUPABASE_STORAGE_URL);
  const jwt =
    "eyJhbGciOiJIUzI1NiJ9." +
    Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url") +
    ".server-signature";
  assert.equal(
    imageStorageConfiguration("supabase", { ...config, SUPABASE_STORAGE_SECRET_KEY: jwt }).backend,
    "supabase",
  );
});
test("storage configuration rejects incomplete, public, unsafe and malformed settings without printing secrets", () => {
  const publicJwt =
    "eyJhbGciOiJIUzI1NiJ9." +
    Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url") +
    ".signature";
  for (const env of [
    { ...config, MEDIA_STORAGE_BACKEND: "other" },
    { ...config, SUPABASE_STORAGE_URL: "" },
    { ...config, SUPABASE_STORAGE_SECRET_KEY: "" },
    { ...config, SUPABASE_STORAGE_SECRET_KEY: "sb_publishable_example" },
    { ...config, SUPABASE_STORAGE_SECRET_KEY: publicJwt },
    { ...config, SUPABASE_STORAGE_BUCKET: "../public" },
    { ...config, SUPABASE_STORAGE_URL: "http://project.supabase.co" },
    { ...config, SUPABASE_STORAGE_URL: "https://example.com/other" },
    { ...config, SUPABASE_STORAGE_URL: "https://secret@project.supabase.co" },
    { ...config, SUPABASE_STORAGE_URL: "https://127.0.0.1" },
    { ...config, SUPABASE_STORAGE_URL: "https://project.supabase.co:1234" },
    {
      ...config,
      SUPABASE_STORAGE_SECRET_KEY: undefined,
      NEXT_PUBLIC_SUPABASE_STORAGE_SECRET_KEY: config.SUPABASE_STORAGE_SECRET_KEY,
    },
  ])
    assert.throws(
      () => imageStorageConfiguration(undefined, env),
      (error) => {
        assert.ok(error instanceof ImageStorageConfigurationError);
        assert.equal(error.message.includes(config.SUPABASE_STORAGE_SECRET_KEY), false);
        return true;
      },
    );
});
test("UUID-only image keys reject traversal, executable files and profile legacy extension changes", () => {
  assert.equal(isImageStorageKey("profile", key()), true);
  assert.equal(isImageStorageKey("post", randomUUID() + ".jpeg"), true);
  assert.equal(isImageStorageKey("profile", randomUUID() + ".png"), false);
  for (const object of [
    "../image.webp",
    "..\\image.webp",
    "/image.webp",
    "C:\\image.webp",
    key() + "/x",
    key() + "\n",
    randomUUID() + ".svg",
    randomUUID() + ".html",
  ])
    assert.equal(isImageStorageKey("post", object), false, object);
});
test("local adapter preserves exact existing folders, binary bytes and collision safety", async () => {
  const parent = path.resolve(process.cwd(), ".local", "storage-tests");
  const workspace = path.join(parent, randomUUID());
  assert.ok(workspace.startsWith(parent + path.sep));
  await mkdir(workspace, { recursive: true });
  const store = localImageObjectStore(workspace);
  const postKey = key(),
    profileKey = key();
  try {
    await store.write("post", postKey, bytes);
    await store.write("profile", profileKey, bytes);
    assert.deepEqual(new Uint8Array(await store.read("post", postKey)), bytes);
    assert.deepEqual(new Uint8Array(await store.read("profile", profileKey)), bytes);
    await assert.rejects(store.write("post", postKey, new Uint8Array([1])));
    assert.deepEqual(new Uint8Array(await store.read("post", postKey)), bytes);
    await assert.rejects(store.read("post", "../data"), code("NOT_FOUND"));
    await assert.rejects(store.write("post", "../data", bytes), code("NOT_FOUND"));
    await assert.rejects(store.remove("profile", "../data"), code("NOT_FOUND"));
    await store.remove("post", key());
  } finally {
    await store.remove("post", postKey);
    await store.remove("profile", profileKey);
    await rmdir(path.join(workspace, ".local", "uploads"));
    await rmdir(path.join(workspace, ".local", "profile-photos"));
    await rmdir(path.join(workspace, ".local"));
    await rmdir(workspace);
  }
});
test("Supabase uses separate UUID paths, verifies private bucket for every operation and never exposes URLs", async () => {
  const { api, calls } = transport();
  const store = supabaseImageObjectStore(api, config.SUPABASE_STORAGE_BUCKET);
  const object = key();
  await store.write("post", object, bytes);
  assert.deepEqual(await store.read("profile", object), bytes);
  await store.remove("profile", object);
  assert.deepEqual(
    calls.map((call) => call.operation),
    ["bucket", "upload", "bucket", "download", "bucket", "remove"],
  );
  assert.equal(calls[1]!.object, "posts/" + object);
  assert.equal(calls[3]!.object, "profiles/" + object);
  assert.equal(calls[5]!.object, "profiles/" + object);
  assert.deepEqual(calls[1]!.options, {
    contentType: "image/webp",
    upsert: false,
    cacheControl: "0",
  });
  assert.equal(JSON.stringify(calls).includes("http"), false);
  assert.equal(JSON.stringify(calls).includes(config.SUPABASE_STORAGE_SECRET_KEY), false);
});
test("public or inaccessible buckets fail closed before upload, read and delete", async () => {
  for (const response of [
    { data: { public: true }, error: null },
    { data: null, error: "provider secret" },
  ]) {
    const { api, calls } = transport();
    api.getBucket = async () => response;
    const store = supabaseImageObjectStore(api, config.SUPABASE_STORAGE_BUCKET);
    await assert.rejects(store.write("post", key(), bytes), code("INTERNAL"));
    await assert.rejects(store.read("profile", key()), code("INTERNAL"));
    await assert.rejects(store.remove("post", key()), code("INTERNAL"));
    assert.equal(calls.length, 0);
  }
});
test("unsafe object keys never reach Supabase and provider errors remain generic", async () => {
  const { api, calls } = transport();
  const store = supabaseImageObjectStore(api, config.SUPABASE_STORAGE_BUCKET);
  for (const object of ["../secret.webp", "/secret.webp", key() + "%2f"]) {
    await assert.rejects(store.write("post", object, bytes), code("NOT_FOUND"));
    await assert.rejects(store.read("profile", object), code("NOT_FOUND"));
    await assert.rejects(store.remove("post", object), code("NOT_FOUND"));
  }
  assert.equal(calls.length, 0);
  api.from = () => ({
    async upload() {
      return { data: null, error: config.SUPABASE_STORAGE_SECRET_KEY };
    },
    async download() {
      return { data: null, error: config.SUPABASE_STORAGE_SECRET_KEY };
    },
    async remove() {
      throw new Error(config.SUPABASE_STORAGE_SECRET_KEY);
    },
  });
  for (const work of [
    () => store.write("post", key(), bytes),
    () => store.read("post", key()),
    () => store.remove("post", key()),
  ])
    await assert.rejects(work(), (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.message.includes(config.SUPABASE_STORAGE_SECRET_KEY), false);
      return true;
    });
});
test("failed metadata persistence removes only the newly acknowledged object and preserves the original error", async () => {
  const events: string[] = [];
  const object = key();
  const store: ImageObjectStore = {
    backend: "supabase",
    async write(_kind, object) {
      events.push("write:" + object);
    },
    async read() {
      return bytes;
    },
    async remove(_kind, object) {
      events.push("remove:" + object);
    },
  };
  const failure = new Error("DB rejected the new metadata");
  await assert.rejects(
    persistImageObject(store, "profile", object, bytes, async (stored) => {
      assert.deepEqual(stored, { objectKey: object, storageBackend: "supabase" });
      events.push("persist");
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(events, ["write:" + object, "persist", "remove:" + object]);
  let failures = 0;
  store.remove = async () => {
    throw new Error("cleanup failed");
  };
  await assert.rejects(
    persistImageObject(
      store,
      "post",
      object,
      bytes,
      async () => {
        throw failure;
      },
      () => failures++,
    ),
    (error) => error === failure,
  );
  assert.equal(failures, 1);
});
test("failed upload never changes DB metadata or removes a preexisting image and success does not cleanup", async () => {
  let persisted = 0,
    removed = 0;
  const store: ImageObjectStore = {
    backend: "local",
    async write() {
      throw new Error("existing object");
    },
    async read() {
      return bytes;
    },
    async remove() {
      removed++;
    },
  };
  await assert.rejects(
    persistImageObject(store, "post", key(), bytes, async () => {
      persisted++;
    }),
  );
  assert.equal(persisted, 0);
  assert.equal(removed, 0);
  store.write = async () => {};
  const value = await persistImageObject(store, "post", key(), bytes, async () => {
    persisted++;
    return "saved";
  });
  assert.equal(value, "saved");
  assert.equal(persisted, 1);
  assert.equal(removed, 0);
});
