import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, open, rmdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { authorizedVideoResponse } from "../src/server/video-delivery";
import { cachedImageObjectStore } from "../src/server/image-object-cache";
import {
  localImageObjectStore,
  supabaseImageObjectStore,
  type SupabaseImageStorageApi,
} from "../src/server/image-storage-core";
import {
  exactObjectRangeStream,
  localObjectRangeStream,
  supabaseObjectRangeReader,
  type ObjectByteRange,
} from "../src/server/object-range-stream";
import { AppError } from "../src/server/errors";

const total = 25 * 1024 * 1024;
const range = { start: 100, end: 101, total };
const config = {
  url: "https://range-test.supabase.co",
  bucket: "private-media",
  secretKey: "server-test-key",
};
const bytes = new Uint8Array([7, 8]);
const code = (error: unknown) => error instanceof AppError && error.code === "INTERNAL";
const response = (body: BodyInit | null = bytes, headers: Record<string, string> = {}) =>
  new Response(body, {
    status: 206,
    headers: { "content-range": `bytes 100-101/${total}`, "content-length": "2", ...headers },
  });

test("two-byte video seek requests only those bytes from authenticated Supabase and bypasses image byte caching", async () => {
  let fetched = 0,
    downloads = 0,
    bucketChecks = 0;
  const api: SupabaseImageStorageApi = {
    async getBucket() {
      bucketChecks++;
      return { data: { public: false }, error: null };
    },
    from() {
      return {
        async upload() {
          return { data: {}, error: null };
        },
        async download() {
          downloads++;
          throw new Error("full download forbidden");
        },
        async remove() {
          return { data: [], error: null };
        },
      };
    },
  };
  const object = randomUUID() + ".mp4";
  const readRange = supabaseObjectRangeReader(config, async (url, init) => {
    assert.equal(
      url,
      `${config.url}/storage/v1/object/authenticated/private-media/videos/${object}`,
    );
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("range"), "bytes=100-101");
    assert.equal(headers.get("apikey"), config.secretKey);
    assert.equal(headers.get("authorization"), "Bearer " + config.secretKey);
    assert.equal(headers.get("accept-encoding"), "identity");
    return response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            fetched += bytes.byteLength;
            controller.enqueue(bytes);
            controller.close();
          },
        },
        { highWaterMark: 0 },
      ),
    );
  });
  const store = cachedImageObjectStore(
    supabaseImageObjectStore(api, config.bucket, readRange),
    randomUUID(),
  );
  assert.ok(store.readRange);
  const result = await authorizedVideoResponse(
    new Request("http://local/video", { headers: { range: "bytes=100-101" } }),
    total,
    (selected, signal) => store.readRange!("video", object, selected, signal),
  );
  assert.equal(result.status, 206);
  assert.equal(result.headers.get("content-range"), `bytes 100-101/${total}`);
  assert.equal(result.headers.get("content-length"), "2");
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
  assert.equal(fetched, 2);
  assert.equal(downloads, 0);
  assert.equal(bucketChecks, 1);
});

test("Supabase refuses ignored ranges, redirects, wrong totals, encodings and lengths without reading a body", async () => {
  for (const make of [
    () => new Response(bytes, { status: 200, headers: { "content-length": String(total) } }),
    () => new Response(null, { status: 302, headers: { location: "https://elsewhere.invalid" } }),
    () => response(bytes, { "content-range": `bytes 100-101/${total + 1}` }),
    () => response(bytes, { "content-range": `bytes 0-1/${total}` }),
    () => response(bytes, { "content-length": "3" }),
    () => response(bytes, { "content-encoding": "gzip" }),
    () =>
      new Response(null, {
        status: 206,
        headers: { "content-range": `bytes 100-101/${total}`, "content-length": "2" },
      }),
  ]) {
    const read = supabaseObjectRangeReader(config, async () => make());
    await assert.rejects(read("videos/" + randomUUID() + ".mp4", range), code);
  }
  let pulls = 0,
    cancelled = 0;
  const read = supabaseObjectRangeReader(
    config,
    async () =>
      new Response(
        new ReadableStream(
          {
            pull() {
              pulls++;
            },
            cancel() {
              cancelled++;
            },
          },
          { highWaterMark: 0 },
        ),
        { status: 200 },
      ),
  );
  await assert.rejects(read("videos/" + randomUUID() + ".mp4", range), code);
  assert.equal(pulls, 0);
  assert.equal(cancelled, 1);
});

test("Supabase actual short or overlong bytes fail closed despite matching response headers", async () => {
  for (const payload of [new Uint8Array([1]), new Uint8Array([1, 2, 3])]) {
    const read = supabaseObjectRangeReader(config, async () => response(payload));
    await assert.rejects(
      new Response(await read("videos/" + randomUUID() + ".mp4", range)).arrayBuffer(),
      code,
    );
  }
});

test("response cancellation and request abort stop upstream ranged reads", async () => {
  for (const mode of ["cancel", "abort"]) {
    const aborter = new AbortController();
    let reads = 0,
      cancelled = 0;
    let upstreamSignal: AbortSignal | undefined;
    const read = supabaseObjectRangeReader(config, async (_url, init) => {
      upstreamSignal = init?.signal as AbortSignal;
      return response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              reads++;
              controller.enqueue(new Uint8Array([1]));
            },
            cancel() {
              cancelled++;
            },
          },
          { highWaterMark: 0 },
        ),
      );
    });
    const stream = await read("videos/" + randomUUID() + ".mp4", range, aborter.signal);
    const reader = stream.getReader();
    assert.equal((await reader.read()).value?.byteLength, 1);
    assert.equal(reads, 1);
    if (mode === "cancel") await reader.cancel();
    else {
      aborter.abort();
      await assert.rejects(
        reader.read(),
        (error: unknown) => (error as Error).name === "AbortError",
      );
    }
    assert.equal(cancelled, 1);
    assert.equal(upstreamSignal?.aborted, true);
    assert.equal(reads, 1);
  }
});

test("HEAD, suffix/open/bounded ranges and invalid ranges retain exact status and lengths", async () => {
  let loads = 0;
  const load = async (selected: ObjectByteRange) => {
    loads++;
    return new Blob([new Uint8Array(selected.end - selected.start + 1)]).stream();
  };
  for (const [header, expected, length] of [
    [null, null, "10"],
    ["bytes=3-", "bytes 3-9/10", "7"],
    ["bytes=-2", "bytes 8-9/10", "2"],
    ["bytes=7-999", "bytes 7-9/10", "3"],
  ] as const) {
    for (const method of ["GET", "HEAD"]) {
      const result = await authorizedVideoResponse(
        new Request("http://local/video", {
          method,
          headers: header ? { Range: header } : {},
        }),
        10,
        load,
      );
      assert.equal(result.status, header ? 206 : 200);
      assert.equal(result.headers.get("content-range"), expected);
      assert.equal(result.headers.get("content-length"), length);
      assert.equal((await result.arrayBuffer()).byteLength, method === "HEAD" ? 0 : Number(length));
    }
  }
  assert.equal(loads, 4);
  for (const header of ["bytes=10-", "bytes=0-1,3-4", "bytes=5-1", "bytes=-0"]) {
    const result = await authorizedVideoResponse(
      new Request("http://local/video", { headers: { Range: header } }),
      10,
      load,
    );
    assert.equal(result.status, 416);
    assert.equal(result.headers.get("content-range"), "bytes */10");
    assert.equal(result.headers.get("content-length"), "0");
  }
  assert.equal(loads, 4);
});

test("private bucket refusal and unsafe keys prevent the upstream range request", async () => {
  let fetched = 0;
  const api = {
    getBucket: async () => ({ data: { public: true }, error: null }),
  } as unknown as SupabaseImageStorageApi;
  const store = supabaseImageObjectStore(api, "media", async () => {
    fetched++;
    return new Blob([bytes]).stream();
  });
  await assert.rejects(store.readRange!("video", randomUUID() + ".mp4", range), code);
  await assert.rejects(store.readRange!("video", "../private.mp4", range));
  assert.equal(fetched, 0);
});

test("local range streams issue only selected file reads, close on cancellation and verify stored size", async () => {
  const workspace = path.resolve(".local", "storage-tests", randomUUID());
  await mkdir(workspace, { recursive: true });
  const store = localImageObjectStore(workspace),
    object = randomUUID() + ".mp4";
  const payload = new Uint8Array(total);
  payload[100] = 7;
  payload[101] = 8;
  await store.write("video", object, payload);
  try {
    const file = await open(path.join(workspace, ".local", "videos", object), "r");
    const original = file.read.bind(file);
    let requested = 0,
      fetched = 0,
      offset = -1;
    file.read = (async (...args: unknown[]) => {
      const [buffer, start, length, position] = args as [Uint8Array, number, number, number];
      requested += length;
      offset = position;
      const result = await original(buffer, start, length, position);
      fetched += result.bytesRead;
      return result;
    }) as typeof file.read;
    const stream = await localObjectRangeStream(file, range);
    assert.deepEqual(new Uint8Array(await new Response(stream).arrayBuffer()), bytes);
    assert.equal(requested, 2);
    assert.equal(fetched, 2);
    assert.equal(offset, 100);
    await assert.rejects(file.stat());
    const part = await store.readRange!("video", object, {
      start: total - 2,
      end: total - 1,
      total,
    });
    assert.equal((await new Response(part).arrayBuffer()).byteLength, 2);
    await assert.rejects(
      store.readRange!("video", object, { start: 0, end: 1, total: total - 1 }),
      code,
    );
    const cancelFile = await open(path.join(workspace, ".local", "videos", object), "r");
    const cancelled = await localObjectRangeStream(cancelFile, { start: 0, end: total - 1, total });
    await cancelled.cancel();
    await assert.rejects(cancelFile.stat());
    const abortFile = await open(path.join(workspace, ".local", "videos", object), "r");
    const aborter = new AbortController();
    const aborted = await localObjectRangeStream(abortFile, range, aborter.signal);
    aborter.abort();
    await assert.rejects(new Response(aborted).arrayBuffer());
    await assert.rejects(abortFile.stat());
  } finally {
    await store.remove("video", object);
    await rmdir(path.join(workspace, ".local", "videos"));
    await rmdir(path.join(workspace, ".local"));
    await rmdir(workspace);
  }
});

test("bounded streams surface upstream failures without their credential-bearing error text", async () => {
  const stream = exactObjectRangeStream(
    new ReadableStream({
      pull() {
        throw new Error(config.secretKey);
      },
    }),
    2,
  );
  await assert.rejects(
    new Response(stream).arrayBuffer(),
    (error: unknown) => code(error) && !(error as Error).message.includes(config.secretKey),
  );
});
