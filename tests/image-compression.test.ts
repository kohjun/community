import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import sharp from "sharp";
import { IMAGE_COMPRESSION_POLICY } from "../src/domain/image-compression";
import { compressUploadedImage } from "../src/server/image-compression";
import { AppError } from "../src/server/errors";

const validationError = (error: unknown) =>
  error instanceof AppError && error.code === "VALIDATION";

test("large PNG uploads become bounded WebP while preserving aspect ratio", async () => {
  const source = await sharp({
    create: { width: 3200, height: 800, channels: 3, background: "#0A84FE" },
  })
    .png()
    .toBuffer();
  const output = await compressUploadedImage(source, "post");
  const result = await sharp(output).metadata();
  assert.equal(result.format, "webp");
  assert.equal(result.width, 2400);
  assert.equal(result.height, 600);
  assert.ok(output.byteLength < source.byteLength);
  assert.ok(output.byteLength <= IMAGE_COMPRESSION_POLICY.post.maxOutputBytes);
});

test("orientation is applied before removing EXIF, ICC and other source metadata", async () => {
  const source = await sharp({
    create: { width: 80, height: 40, channels: 3, background: "#0A84FE" },
  })
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Artist: "Private photographer", ImageDescription: "Private place" },
    })
    .jpeg()
    .toBuffer();
  const original = await sharp(source).metadata();
  assert.ok(original.exif);
  assert.equal(original.orientation, 6);
  const output = await compressUploadedImage(source, "post");
  const result = await sharp(output).metadata();
  assert.equal(result.width, 40);
  assert.equal(result.height, 80);
  assert.equal(result.orientation, undefined);
  assert.equal(result.exif, undefined);
  assert.equal(result.icc, undefined);
  assert.equal(result.xmp, undefined);
  assert.equal(result.iptc, undefined);
});

test("small transparent images retain transparency and are not enlarged", async () => {
  const source = await sharp({
    create: { width: 24, height: 18, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0 } },
  })
    .png()
    .toBuffer();
  const output = await compressUploadedImage(source, "post");
  const result = await sharp(output).metadata();
  assert.equal(result.width, 24);
  assert.equal(result.height, 18);
  assert.equal(result.hasAlpha, true);
  const pixels = await sharp(output).ensureAlpha().raw().toBuffer();
  assert.equal(pixels[3], 0);
});

test("animated GIF and WebP uploads store only the first static frame", async () => {
  const raw = Buffer.alloc(8 * 16 * 3);
  for (let pixel = 0; pixel < 8 * 16; pixel++) raw[pixel * 3 + (pixel < 8 * 8 ? 0 : 2)] = 255;
  for (const format of ["gif", "webp"] as const) {
    const source = await sharp(raw, {
      raw: { width: 8, height: 16, channels: 3, pageHeight: 8 },
    })
      .toFormat(format, { loop: 0, delay: [100, 100] })
      .toBuffer();
    assert.equal((await sharp(source, { animated: true }).metadata()).pages, 2);
    const output = await compressUploadedImage(source, "post");
    const result = await sharp(output, { animated: true }).metadata();
    assert.equal(result.format, "webp");
    assert.equal(result.width, 8);
    assert.equal(result.height, 8);
    assert.ok(!result.pages || result.pages === 1);
    const pixels = await sharp(output).removeAlpha().raw().toBuffer();
    assert.ok(pixels[0]! > 240);
    assert.ok(pixels[2]! < 15);
  }
});

test("profile pictures are square and meet the compressed byte budget", async () => {
  const source = await sharp({
    create: { width: 1200, height: 600, channels: 3, background: "#0A84FE" },
  })
    .png()
    .toBuffer();
  const output = await compressUploadedImage(source, "profile");
  const result = await sharp(output).metadata();
  assert.equal(result.format, "webp");
  assert.equal(result.width, 512);
  assert.equal(result.height, 512);
  assert.ok(output.byteLength <= IMAGE_COMPRESSION_POLICY.profile.maxOutputBytes);
});

test("noisy photos exceeding the initial encoding budget receive bounded compression", async () => {
  const source = await sharp(randomBytes(2400 * 1800 * 3), {
    raw: { width: 2400, height: 1800, channels: 3 },
  })
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .toBuffer();
  assert.ok(source.byteLength < IMAGE_COMPRESSION_POLICY.post.maxInputBytes);
  const initial = await sharp(source).webp({ quality: 82, effort: 4 }).toBuffer();
  assert.ok(initial.byteLength > IMAGE_COMPRESSION_POLICY.post.maxOutputBytes);
  const output = await compressUploadedImage(source, "post");
  assert.ok(output.byteLength <= IMAGE_COMPRESSION_POLICY.post.maxOutputBytes);
  assert.ok(output.byteLength < source.byteLength);
  assert.equal((await sharp(output).metadata()).format, "webp");
});

test("empty, oversized, unsupported and truncated uploads fail before storage", async () => {
  const valid = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "white" },
  })
    .jpeg()
    .toBuffer();
  const invalid = [
    Buffer.alloc(0),
    Buffer.alloc(IMAGE_COMPRESSION_POLICY.post.maxInputBytes + 1),
    Buffer.from("not a photograph"),
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    ),
    valid.subarray(0, Math.floor(valid.byteLength / 2)),
  ];
  for (const source of invalid)
    await assert.rejects(compressUploadedImage(source, "post"), validationError);
  await assert.rejects(
    compressUploadedImage(
      Buffer.alloc(IMAGE_COMPRESSION_POLICY.profile.maxInputBytes + 1),
      "profile",
    ),
    validationError,
  );
});

test("compressed pixel bombs are rejected by their decoded pixel limit", async () => {
  const source = await sharp({
    create: { width: 5000, height: 4001, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  assert.ok(source.byteLength < IMAGE_COMPRESSION_POLICY.post.maxInputBytes);
  await assert.rejects(compressUploadedImage(source, "post"), validationError);
});
