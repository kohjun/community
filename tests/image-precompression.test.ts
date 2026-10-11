import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { IMAGE_COMPRESSION_POLICY } from "../src/domain/image-compression";
import {
  imageDrawRegion,
  imageHeaderSize,
  prepareImageForUpload,
  type DecodedUploadImage,
  type ImageDrawRegion,
  type ImagePreparationAdapter,
} from "../src/lib/image-precompression";

function sourceFile(size = 10_000, type = "image/png") {
  return new File([new Uint8Array(size)], "camera.png", { type, lastModified: 123 });
}
function webp(size: number) {
  return new Blob([new Uint8Array(size)], { type: "image/webp" });
}
function fakeAdapter(
  size = { width: 3200, height: 800 },
  encode: ImagePreparationAdapter["encode"] = async () => webp(300),
) {
  let closes = 0;
  let decodes = 0;
  const regions: ImageDrawRegion[] = [];
  const qualities: number[] = [];
  const adapter: ImagePreparationAdapter = {
    async decode() {
      decodes++;
      return { ...size, source: {} as CanvasImageSource, close: () => closes++ };
    },
    async encode(image, region, quality) {
      regions.push(region);
      qualities.push(quality);
      return encode(image, region, quality);
    },
  };
  return { adapter, regions, qualities, closes: () => closes, decodes: () => decodes };
}
function pngHeader(width: number, height: number) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
const cancelled = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

test("headers report dimensions of encoded PNG, JPEG, GIF and each WebP layout", async () => {
  const photo = sharp({
    create: { width: 61, height: 37, channels: 4, background: "#0a84fe" },
  });
  const variants = [
    photo.clone().png().toBuffer(),
    photo.clone().jpeg().toBuffer(),
    photo.clone().gif().toBuffer(),
    photo.clone().webp().toBuffer(),
    photo.clone().webp({ lossless: true }).toBuffer(),
    photo.clone().withMetadata().webp().toBuffer(),
  ];
  for (const buffer of await Promise.all(variants)) {
    assert.deepEqual(imageHeaderSize(buffer), { width: 61, height: 37 });
    assert.equal(imageHeaderSize(buffer.subarray(0, 7)), null);
  }
  assert.equal(imageHeaderSize(Buffer.from("not an image")), null);
});

test("post resizing retains aspect ratio and never enlarges small images", () => {
  assert.deepEqual(imageDrawRegion({ width: 3200, height: 800 }, "post", 2400), {
    sourceX: 0,
    sourceY: 0,
    sourceWidth: 3200,
    sourceHeight: 800,
    width: 2400,
    height: 600,
  });
  const small = imageDrawRegion({ width: 24, height: 18 }, "post", 2400);
  assert.equal(small.width, 24);
  assert.equal(small.height, 18);
  const portrait = imageDrawRegion({ width: 800, height: 3200 }, "post", 2400);
  assert.equal(portrait.width, 600);
  assert.equal(portrait.height, 2400);
});

test("profile cropping centers a square using the shared output dimensions", async () => {
  const runtime = fakeAdapter({ width: 1200, height: 600 });
  await prepareImageForUpload(sourceFile(), "profile", { adapter: runtime.adapter });
  assert.deepEqual(runtime.regions[0], {
    sourceX: 300,
    sourceY: 0,
    sourceWidth: 600,
    sourceHeight: 600,
    width: 512,
    height: 512,
  });
  const portrait = imageDrawRegion({ width: 600, height: 1200 }, "profile", 384);
  assert.equal(portrait.sourceY, 300);
  assert.equal(portrait.width, 384);
  assert.equal(portrait.height, 384);
  assert.equal(runtime.closes(), 1);
});

test("successful preparation sends a smaller WebP with the original lastModified", async () => {
  const runtime = fakeAdapter();
  const input = sourceFile();
  const output = await prepareImageForUpload(input, "post", { adapter: runtime.adapter });
  assert.notEqual(output, input);
  assert.equal(output.name, "camera.webp");
  assert.equal(output.type, "image/webp");
  assert.equal(output.size, 300);
  assert.equal(output.lastModified, input.lastModified);
  assert.deepEqual(runtime.qualities, [0.82]);
  assert.equal(runtime.closes(), 1);
});

test("oversized encodings try the shared quality and dimension steps in order", async () => {
  let encodings = 0;
  const runtime = fakeAdapter({ width: 3200, height: 2000 }, async () =>
    webp(++encodings < 4 ? IMAGE_COMPRESSION_POLICY.post.maxOutputBytes + 1 : 200_000),
  );
  const output = await prepareImageForUpload(sourceFile(3_000_000), "post", {
    adapter: runtime.adapter,
  });
  assert.equal(output.size, 200_000);
  assert.deepEqual(runtime.qualities, [0.82, 0.72, 0.72, 0.65]);
  assert.deepEqual(
    runtime.regions.map((region) => region.width),
    [2400, 2400, 1800, 1600],
  );
  assert.equal(runtime.closes(), 1);
});

test("profile outputs must meet their own 256 KiB budget", async () => {
  let encodings = 0;
  const runtime = fakeAdapter(undefined, async () =>
    webp(++encodings < 3 ? IMAGE_COMPRESSION_POLICY.profile.maxOutputBytes + 1 : 100_000),
  );
  const output = await prepareImageForUpload(sourceFile(1_000_000), "profile", {
    adapter: runtime.adapter,
  });
  assert.equal(output.size, 100_000);
  assert.deepEqual(
    runtime.regions.map((region) => region.width),
    [512, 512, 384],
  );
});

test("larger or empty browser encodings always preserve the original upload", async () => {
  for (const bytes of [1000, 1001, 0]) {
    const input = sourceFile(1000);
    const runtime = fakeAdapter(undefined, async () => webp(bytes));
    assert.equal(await prepareImageForUpload(input, "post", { adapter: runtime.adapter }), input);
    assert.equal(runtime.qualities.length, 4);
    assert.equal(runtime.closes(), 1);
  }
});

test("missing APIs, decode failures and unsupported encoding fall back to the original", async () => {
  const input = sourceFile();
  assert.equal(await prepareImageForUpload(input, "post", { adapter: null }), input);
  assert.equal(await prepareImageForUpload(input, "post"), input);
  const broken = fakeAdapter();
  broken.adapter.decode = async () => {
    throw new Error("decoder unsupported");
  };
  assert.equal(await prepareImageForUpload(input, "post", { adapter: broken.adapter }), input);
  for (const result of [null, new Blob(["png fallback"], { type: "image/png" })]) {
    const runtime = fakeAdapter(undefined, async () => result);
    assert.equal(await prepareImageForUpload(input, "post", { adapter: runtime.adapter }), input);
    assert.equal(runtime.closes(), 1);
  }
  const failedEncode = fakeAdapter(undefined, async () => {
    throw new Error("canvas failed");
  });
  assert.equal(
    await prepareImageForUpload(input, "post", { adapter: failedEncode.adapter }),
    input,
  );
  assert.equal(failedEncode.closes(), 1);
});

test("original input limits are enforced before browser decode or any fallback", async () => {
  const runtime = fakeAdapter();
  for (const kind of ["post", "profile"] as const) {
    await assert.rejects(
      prepareImageForUpload(sourceFile(IMAGE_COMPRESSION_POLICY[kind].maxInputBytes + 1), kind, {
        adapter: runtime.adapter,
      }),
    );
    await assert.rejects(prepareImageForUpload(sourceFile(0), kind, { adapter: null }));
  }
  await assert.rejects(prepareImageForUpload(sourceFile(100, "image/svg+xml"), "post"));
  assert.equal(runtime.decodes(), 0);
});

test("pixel bombs are rejected from their header before decoding even without browser APIs", async () => {
  const input = new File([pngHeader(5000, 4001)], "bomb.png", { type: "image/png" });
  const runtime = fakeAdapter();
  await assert.rejects(prepareImageForUpload(input, "post", { adapter: runtime.adapter }));
  await assert.rejects(prepareImageForUpload(input, "profile", { adapter: null }));
  assert.equal(runtime.decodes(), 0);
});

test("unexpected oversized decoded dimensions cannot bypass the limit or fall back", async () => {
  const runtime = fakeAdapter({ width: 5000, height: 4001 });
  await assert.rejects(prepareImageForUpload(sourceFile(), "post", { adapter: runtime.adapter }));
  assert.equal(runtime.closes(), 1);
  assert.equal(runtime.qualities.length, 0);
});

test("a cancelled preparation does not decode or return an uploadable file", async () => {
  const controller = new AbortController();
  controller.abort();
  const runtime = fakeAdapter();
  await assert.rejects(
    prepareImageForUpload(sourceFile(), "post", {
      adapter: runtime.adapter,
      signal: controller.signal,
    }),
    cancelled,
  );
  assert.equal(runtime.decodes(), 0);
});

test("cancelling native decode keeps serial work bounded and closes its late result", async () => {
  const controller = new AbortController();
  let finishDecode!: (image: DecodedUploadImage) => void;
  let closeCount = 0;
  const first = fakeAdapter();
  first.adapter.decode = () =>
    new Promise((resolve) => {
      finishDecode = resolve;
    });
  const work = prepareImageForUpload(sourceFile(), "post", {
    adapter: first.adapter,
    signal: controller.signal,
  });
  await tick();
  controller.abort();
  await assert.rejects(work, cancelled);
  const next = fakeAdapter();
  const queued = prepareImageForUpload(sourceFile(), "post", { adapter: next.adapter });
  await tick();
  assert.equal(next.decodes(), 0);
  finishDecode({
    width: 24,
    height: 24,
    source: {} as CanvasImageSource,
    close: () => closeCount++,
  });
  await queued;
  assert.equal(closeCount, 1);
  assert.equal(first.qualities.length, 0);
  assert.equal(next.decodes(), 1);
});

test("cancelling native encoding rejects immediately and releases the decoded source afterward", async () => {
  const controller = new AbortController();
  let finishEncode!: (blob: Blob) => void;
  const runtime = fakeAdapter(
    undefined,
    () =>
      new Promise((resolve) => {
        finishEncode = resolve;
      }),
  );
  const work = prepareImageForUpload(sourceFile(), "post", {
    adapter: runtime.adapter,
    signal: controller.signal,
  });
  await tick();
  controller.abort();
  await assert.rejects(work, cancelled);
  assert.equal(runtime.closes(), 0);
  finishEncode(webp(300));
  // A following request waits for the cancelled native operation and its cleanup.
  await prepareImageForUpload(sourceFile(), "post", { adapter: null });
  assert.equal(runtime.closes(), 1);
});
