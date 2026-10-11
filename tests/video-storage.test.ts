import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, rmdir } from "node:fs/promises";
import path from "node:path";
import {
  videoByteRange,
  acceptsVideoUpload,
  parseVideoMetadata,
} from "../src/domain/video-compression";
import { isImageStorageKey } from "../src/domain/image-storage";
import {
  localImageObjectStore,
  supabaseImageObjectStore,
  type SupabaseImageStorageApi,
} from "../src/server/image-storage-core";
test("video byte ranges retain suffix/open/closed seeks and reject invalid or multiple ranges", () => {
  assert.equal(videoByteRange(null, 100), null);
  assert.deepEqual(videoByteRange("bytes=0-9", 100), { start: 0, end: 9 });
  assert.deepEqual(videoByteRange("bytes=50-", 100), { start: 50, end: 99 });
  assert.deepEqual(videoByteRange("bytes=-20", 100), { start: 80, end: 99 });
  assert.deepEqual(videoByteRange("bytes=50-999", 100), { start: 50, end: 99 });
  assert.deepEqual(videoByteRange("bytes=-200", 100), { start: 0, end: 99 });
  for (const range of [
    "bytes=100-",
    "bytes=5-1",
    "bytes=-0",
    "bytes=-",
    "bytes=0-1,2-3",
    "other=0-1",
    "bytes=9007199254740992-",
  ])
    assert.throws(() => videoByteRange(range, 100));
});
test("upload and probe bounds reject oversized, missing-video or deceptive duration metadata", () => {
  assert.equal(acceptsVideoUpload("video/quicktime", 50 * 1024 * 1024), true);
  assert.equal(acceptsVideoUpload("video/mp4", 50 * 1024 * 1024 + 1), false);
  assert.equal(acceptsVideoUpload("text/html", 30), false);
  const stream = { codec_type: "video", width: 1920, height: 1080, duration: "2" };
  const fixture = {
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "2" },
    streams: [stream],
  };
  assert.deepEqual(parseVideoMetadata(fixture), { width: 1920, height: 1080, durationSeconds: 2 });
  for (const value of [
    { ...fixture, streams: [{ ...stream, duration: "240" }] },
    { ...fixture, format: { ...fixture.format, duration: "181" } },
    { ...fixture, streams: [{ ...stream, width: 9000 }] },
    { ...fixture, streams: [{ ...stream, width: 8192, height: 8192 }] },
    { ...fixture, streams: [{ ...stream, disposition: { attached_pic: 1 } }] },
    { ...fixture, format: { format_name: "hls", duration: "1" } },
    { ...fixture, streams: [{ codec_type: "audio", duration: "1" }] },
    { ...fixture, streams: [{ ...stream, duration: "Infinity" }] },
  ])
    assert.throws(() => parseVideoMetadata(value));
});
test("video object adapter uses its own exact UUID MP4 path and preserves binary bytes locally", async () => {
  const parent = path.resolve(process.cwd(), ".local", "storage-tests");
  const workspace = path.join(parent, randomUUID());
  const object = randomUUID() + ".mp4",
    bytes = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112]);
  await mkdir(workspace, { recursive: true });
  const store = localImageObjectStore(workspace);
  assert.equal(isImageStorageKey("video", object), true);
  for (const bad of ["../" + object, object + "/x", object + "\n", randomUUID() + ".webp"])
    assert.equal(isImageStorageKey("video", bad), false);
  try {
    await store.write("video", object, bytes);
    assert.deepEqual(new Uint8Array(await store.read("video", object)), bytes);
    await assert.rejects(store.write("post", object, bytes));
    await assert.rejects(store.write("video", object, bytes));
  } finally {
    await store.remove("video", object);
    await rmdir(path.join(workspace, ".local", "videos"));
    await rmdir(path.join(workspace, ".local"));
    await rmdir(workspace);
  }
});
test("Supabase video adapter keeps MP4 MIME and private-bucket authorization for every access", async () => {
  const object = randomUUID() + ".mp4",
    bytes = new Uint8Array([1, 2, 3]);
  let bucketChecks = 0;
  const operations: string[] = [];
  const api: SupabaseImageStorageApi = {
    async getBucket() {
      bucketChecks++;
      return { data: { public: false }, error: null };
    },
    from(bucket) {
      assert.equal(bucket, "private-media");
      return {
        async upload(key, payload, options) {
          assert.equal(key, "videos/" + object);
          assert.deepEqual(payload, bytes);
          assert.equal(options.contentType, "video/mp4");
          assert.equal(options.upsert, false);
          operations.push("write");
          return { data: {}, error: null };
        },
        async download(key) {
          assert.equal(key, "videos/" + object);
          operations.push("read");
          return { data: new Blob([bytes]), error: null };
        },
        async remove(keys) {
          assert.deepEqual(keys, ["videos/" + object]);
          operations.push("remove");
          return { data: [], error: null };
        },
      };
    },
  };
  const store = supabaseImageObjectStore(api, "private-media");
  await store.write("video", object, bytes);
  assert.deepEqual(await store.read("video", object), bytes);
  await store.remove("video", object);
  assert.equal(bucketChecks, 3);
  assert.deepEqual(operations, ["write", "read", "remove"]);
});
