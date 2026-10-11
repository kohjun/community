import assert from "node:assert/strict";
import test from "node:test";
import type { PublicVideo } from "../src/domain/contracts";
import {
  uploadVideoFile,
  type VideoUploadTransport,
  type VideoUploadStage,
} from "../src/lib/video-upload";

const jobId = "a8b5a8f3-7f78-4ff3-8121-ebedac4cc056";
const video: PublicVideo = {
  id: "cdf1100a-9921-4db3-8f18-5cab93d43592",
  src: "/api/videos/cdf1100a-9921-4db3-8f18-5cab93d43592",
  contentType: "video/mp4",
  byteSize: 1024,
  width: 640,
  height: 360,
  durationSeconds: 2,
  sortOrder: 0,
};
const file = () => new File([new Uint8Array([1, 2, 3])], "video.mp4", { type: "video/mp4" });
function fixture(statuses: unknown[]) {
  let clock = 0;
  const calls: { url: string; method: string; body: unknown; signal: AbortSignal | undefined }[] =
    [];
  const transport: VideoUploadTransport = {
    async request<T>(url: string, method = "GET", body?: unknown, signal?: AbortSignal) {
      signal?.throwIfAborted();
      calls.push({ url, method, body, signal });
      const value =
        method === "POST"
          ? { jobId, status: "queued", statusUrl: "https://foreign.example/credentials" }
          : statuses.shift();
      return value as T;
    },
    async wait(ms, signal) {
      signal?.throwIfAborted();
      clock += ms;
    },
    now: () => clock,
  };
  return { transport, calls };
}
test("async upload polls only its local owner endpoint and returns the ready derivative after queued/processing states", async () => {
  const f = fixture([
    { jobId, status: "queued", video: null, error: null },
    { jobId, status: "processing", video: null, error: null },
    { jobId, status: "ready", video, error: null },
  ]);
  const stages: VideoUploadStage[] = [];
  assert.deepEqual(
    await uploadVideoFile(file(), { onProgress: (stage) => stages.push(stage) }, f.transport),
    video,
  );
  assert.deepEqual(stages, ["uploading", "queued", "queued", "processing"]);
  assert.equal(f.calls.length, 4);
  assert.ok(f.calls[0]!.body instanceof FormData);
  for (const call of f.calls.slice(1)) assert.equal(call.url, "/api/videos/jobs/" + jobId);
});
test("invalid upload types and empty sources never send a request", async () => {
  for (const input of [
    new File([], "empty.mp4", { type: "video/mp4" }),
    new File(["source"], "sound.mp3", { type: "audio/mpeg" }),
  ]) {
    const f = fixture([]);
    await assert.rejects(uploadVideoFile(input, {}, f.transport), /50MB/);
    assert.equal(f.calls.length, 0);
  }
});
test("a failed job shows its public explanation and stops polling", async () => {
  const f = fixture([
    { jobId, status: "failed", video: null, error: "3분 이하 영상으로 다시 올려주세요." },
  ]);
  await assert.rejects(uploadVideoFile(file(), {}, f.transport), /3분 이하/);
  assert.equal(f.calls.length, 2);
});
test("mismatched jobs and malformed status replies cannot attach a video", async () => {
  for (const value of [
    { jobId: "00000000-0000-4000-8000-000000000001", status: "ready", video, error: null },
    { jobId, status: "unknown", video: null, error: null },
    null,
  ]) {
    const f = fixture([value]);
    await assert.rejects(uploadVideoFile(file(), {}, f.transport), /상태/);
  }
});
test("ready derivative validation refuses remote URLs and forged size/duration metadata", async () => {
  for (const patch of [
    { src: "https://foreign.example/video.mp4" },
    { durationSeconds: 181 },
    { byteSize: 0 },
    { width: Infinity },
    { contentType: "text/html" },
  ]) {
    const f = fixture([{ jobId, status: "ready", video: { ...video, ...patch }, error: null }]);
    await assert.rejects(uploadVideoFile(file(), {}, f.transport), /결과/);
  }
});
test("a cancelled upload cannot start a request or continue polling", async () => {
  const first = new AbortController();
  first.abort();
  const f = fixture([]);
  await assert.rejects(uploadVideoFile(file(), { signal: first.signal }, f.transport));
  assert.equal(f.calls.length, 0);
  const pending = new AbortController();
  const next = fixture([{ jobId, status: "queued", video: null, error: null }]);
  next.transport.wait = async () => {
    pending.abort();
    pending.signal.throwIfAborted();
  };
  await assert.rejects(uploadVideoFile(file(), { signal: pending.signal }, next.transport));
  assert.equal(next.calls.length, 2);
  for (const call of next.calls) assert.equal(call.signal, pending.signal);
});
test("a long worker backlog stops browser polling with a bounded wait", async () => {
  const f = fixture([{ jobId, status: "queued", video: null, error: null }]);
  let clock = 0;
  f.transport.now = () => clock;
  f.transport.wait = async () => {
    clock += 16 * 60000;
  };
  await assert.rejects(uploadVideoFile(file(), {}, f.transport), /대기가 길어/);
  assert.equal(f.calls.length, 2);
});
