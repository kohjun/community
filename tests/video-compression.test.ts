import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { test } from "node:test";
import ffmpeg from "ffmpeg-static";
import ffprobe from "@ffprobe-installer/ffprobe";
import { VIDEO_STORED_MAX_BYTES, VIDEO_UPLOAD_MAX_BYTES } from "../src/domain/video-compression";
import { AppError } from "../src/server/errors";
import {
  compressVideo,
  probeVideo,
  runMediaProcess,
  withVideoProcessingSlot,
} from "../src/server/video-transcoding-core";

assert.ok(ffmpeg, "The installed FFmpeg binary is required for video regression tests.");
const ffmpegPath = ffmpeg;
const execFileAsync = promisify(execFile);
const validationError = (error: unknown) =>
  error instanceof AppError && error.code === "VALIDATION";
const rateLimitError = (error: unknown) =>
  error instanceof AppError && error.code === "RATE_LIMITED";

interface ProbedStream {
  codec_type: string;
  codec_name: string;
  duration?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  sample_aspect_ratio?: string;
  display_aspect_ratio?: string;
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[];
}
interface DetailedProbe {
  streams: ProbedStream[];
  format: { duration: string; tags?: Record<string, string> };
}

async function fixture<T>(work: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(path.join(tmpdir(), "sliper-video-test-"));
  try {
    return await work(directory);
  } finally {
    for (const name of await readdir(directory)) await unlink(path.join(directory, name));
    await rmdir(directory);
  }
}
async function generate(file: string, args: string[]) {
  await execFileAsync(ffmpegPath, ["-hide_banner", "-loglevel", "error", ...args, "-y", file], {
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 1024 * 1024,
    encoding: "utf8",
  });
  return readFile(file);
}
async function colorVideo(
  directory: string,
  name: string,
  width: number,
  height: number,
  extra: string[] = [],
) {
  return generate(path.join(directory, name), [
    "-f",
    "lavfi",
    "-i",
    `testsrc=size=${width}x${height}:rate=2`,
    "-t",
    "0.5",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv444p",
    ...extra,
  ]);
}
async function detailedProbe(file: string): Promise<DetailedProbe> {
  const { stdout } = await execFileAsync(
    ffprobe.path,
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
    { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024, encoding: "utf8" },
  );
  return JSON.parse(stdout) as DetailedProbe;
}
async function inspectCompressed(directory: string, bytes: Uint8Array) {
  const output = path.join(directory, "compressed-result.mp4");
  await writeFile(output, bytes);
  return detailedProbe(output);
}
function assertBoundedDimensions(width: number, height: number) {
  assert.ok(width >= 2 && width <= 1280);
  assert.ok(height >= 2 && height <= 720);
  assert.equal(width % 2, 0);
  assert.equal(height % 2, 0);
}

test("a noisy full-HD upload stores a smaller H.264/AAC MP4 without private source metadata", async () => {
  await fixture(async (directory) => {
    const source = await generate(path.join(directory, "private-source.mov"), [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1920x1080:rate=12,noise=alls=60:allf=t+u:all_seed=42",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=600:sample_rate=48000",
      "-t",
      "0.5",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-preset",
      "ultrafast",
      "-crf",
      "12",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ac",
      "1",
      "-metadata",
      "title=Sliper private fixture",
      "-metadata",
      "comment=Sliper private fixture",
      "-metadata",
      "location=+37.5000+127.0000/",
    ]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("Video compression must not fetch remote content.");
    };
    try {
      const result = await compressVideo(source);
      assert.ok(result.bytes.byteLength < source.byteLength);
      assert.ok(result.bytes.byteLength < VIDEO_STORED_MAX_BYTES);
      assertBoundedDimensions(result.width, result.height);
      assert.ok(result.durationSeconds > 0 && result.durationSeconds <= 180);
      const probe = await inspectCompressed(directory, result.bytes);
      const video = probe.streams.find((stream) => stream.codec_type === "video");
      const audio = probe.streams.find((stream) => stream.codec_type === "audio");
      assert.equal(video?.codec_name, "h264");
      assert.equal(video?.pix_fmt, "yuv420p");
      assert.equal(video?.sample_aspect_ratio, "1:1");
      assert.equal(audio?.codec_name, "aac");
      assert.ok(!JSON.stringify(probe).includes("Sliper private fixture"));
      for (const key of ["title", "comment", "location", "location-eng", "creation_time"])
        assert.equal(probe.format.tags?.[key], undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("non-square pixels retain the source display aspect ratio when normalized", async () => {
  await fixture(async (directory) => {
    const source = await colorVideo(directory, "non-square.mp4", 720, 576, ["-vf", "setsar=16/15"]);
    const input = await detailedProbe(path.join(directory, "non-square.mp4"));
    assert.equal(input.streams[0]?.display_aspect_ratio, "4:3");
    const result = await compressVideo(source);
    assert.equal(result.width, 768);
    assert.equal(result.height, 576);
    const output = await inspectCompressed(directory, result.bytes);
    assert.equal(output.streams[0]?.sample_aspect_ratio, "1:1");
    assert.equal(output.streams[0]?.display_aspect_ratio, "4:3");
  });
});

test("portrait videos preserve their shape within the compressed size budget", async () => {
  await fixture(async (directory) => {
    const result = await compressVideo(await colorVideo(directory, "portrait.mp4", 1080, 1920));
    assertBoundedDimensions(result.width, result.height);
    assert.ok(result.height > result.width);
    assert.ok(Math.abs(result.width / result.height - 9 / 16) < 0.01);
  });
});

test("a display-matrix rotation is applied before removing source metadata", async () => {
  await fixture(async (directory) => {
    const sourcePath = path.join(directory, "landscape.mp4");
    await colorVideo(directory, "landscape.mp4", 160, 90);
    const rotated = path.join(directory, "rotated.mp4");
    const source = await generate(rotated, [
      "-display_rotation",
      "90",
      "-i",
      sourcePath,
      "-c",
      "copy",
    ]);
    const input = await detailedProbe(rotated);
    assert.ok(
      input.streams[0]?.side_data_list?.some((data) => Math.abs(data.rotation ?? 0) === 90),
    );
    const result = await compressVideo(source);
    assert.equal(result.width, 90);
    assert.equal(result.height, 160);
    const output = await inspectCompressed(directory, result.bytes);
    assert.ok(!output.streams[0]?.side_data_list?.some((data) => data.rotation));
  });
});

test("odd source dimensions become even square-pixel dimensions without stretching", async () => {
  await fixture(async (directory) => {
    const source = await colorVideo(directory, "odd.mp4", 101, 303);
    const input = await detailedProbe(path.join(directory, "odd.mp4"));
    assert.equal(input.streams[0]?.width, 101);
    assert.equal(input.streams[0]?.height, 303);
    const result = await compressVideo(source);
    assertBoundedDimensions(result.width, result.height);
    assert.ok(Math.abs(result.width / result.height - 1 / 3) < 0.01);
    assert.equal(
      (await inspectCompressed(directory, result.bytes)).streams[0]?.sample_aspect_ratio,
      "1:1",
    );
  });
});

test("empty, oversized, truncated and remote-playlist uploads fail before storage", async () => {
  await fixture(async (directory) => {
    const source = await colorVideo(directory, "valid.mp4", 32, 32);
    for (const bytes of [
      Buffer.alloc(0),
      Buffer.alloc(VIDEO_UPLOAD_MAX_BYTES + 1),
      Buffer.from("not a video"),
      Buffer.from("#EXTM3U\n#EXTINF:1,\nhttps://example.invalid/private-video.mp4\n"),
      source.subarray(0, Math.floor(source.byteLength / 2)),
    ])
      await assert.rejects(compressVideo(bytes), validationError);
  });
});

test("a short MP4 header cannot hide a video stream longer than three minutes", async () => {
  await fixture(async (directory) => {
    const original = await generate(path.join(directory, "long.mp4"), [
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=64x64:r=1",
      "-t",
      "240",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-pix_fmt",
      "yuv420p",
    ]);
    const bytes = Buffer.from(original);
    const movie = bytes.indexOf("mvhd");
    assert.ok(movie >= 0);
    assert.equal(bytes[movie + 4], 0);
    bytes.writeUInt32BE(bytes.readUInt32BE(movie + 16), movie + 20);
    const misleading = path.join(directory, "short-header.mp4");
    await writeFile(misleading, bytes);
    const raw = await detailedProbe(misleading);
    assert.equal(bytes.readUInt32BE(movie + 20) / bytes.readUInt32BE(movie + 16), 1);
    assert.ok(
      Math.max(
        Number(raw.format.duration),
        ...raw.streams.map((stream) => Number(stream.duration) || 0),
      ) >= 240,
    );
    await assert.rejects(probeVideo(misleading), validationError);
    await assert.rejects(compressVideo(bytes), validationError);
  });
});

test("a forged WebM duration is rejected after bounded encoding instead of storing a long video", async () => {
  await fixture(async (directory) => {
    const original = await generate(path.join(directory, "long.webm"), [
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=64x64:r=1",
      "-t",
      "240",
      "-c:v",
      "libvpx-vp9",
      "-cpu-used",
      "8",
      "-threads",
      "1",
      "-pix_fmt",
      "yuv420p",
    ]);
    const bytes = Buffer.from(original);
    const duration = bytes.indexOf(Buffer.from([0x44, 0x89, 0x88]));
    assert.ok(duration >= 0);
    assert.equal(bytes.readDoubleBE(duration + 3), 240000);
    bytes.writeDoubleBE(1000, duration + 3);
    const misleading = path.join(directory, "short-header.webm");
    await writeFile(misleading, bytes);
    assert.equal((await probeVideo(misleading)).durationSeconds, 1);
    await assert.rejects(compressVideo(bytes), validationError);
  });
});

test("the processing slot rejects concurrent work and releases after success or failure", async () => {
  let release: (() => void) | undefined;
  const occupied = withVideoProcessingSlot(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  try {
    await assert.rejects(
      withVideoProcessingSlot(async () => "blocked"),
      rateLimitError,
    );
  } finally {
    release?.();
    await occupied;
  }
  assert.equal(await withVideoProcessingSlot(async () => "available"), "available");
  await assert.rejects(
    withVideoProcessingSlot(async () => {
      throw new Error("fixture failure");
    }),
    /fixture failure/,
  );
  assert.equal(await withVideoProcessingSlot(async () => "available again"), "available again");
});

test("aborting active work kills its subprocess and releases the processing slot", async () => {
  await fixture(async (directory) => {
    const marker = path.join(directory, "started");
    const controller = new AbortController();
    const running = withVideoProcessingSlot(() =>
      runMediaProcess(
        process.execPath,
        [
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);`,
        ],
        10000,
        controller.signal,
      ),
    );
    const rejected = assert.rejects(running, validationError);
    let childPid: number | undefined;
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          childPid = Number(await readFile(marker, "utf8"));
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await delay(30);
      }
      const finishedPid = childPid;
      assert.ok(
        finishedPid && Number.isSafeInteger(finishedPid),
        "The fixture subprocess must start.",
      );
      controller.abort();
      await rejected;
      assert.throws(() => process.kill(finishedPid, 0), { code: "ESRCH" });
      assert.equal(await withVideoProcessingSlot(async () => "available"), "available");
    } finally {
      controller.abort();
      await rejected;
    }
  });
});

test("pre-cancelled work, timeouts and excessive subprocess logs terminate safely", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runMediaProcess(process.execPath, ["-e", "process.exit(0)"], 10000, controller.signal),
    validationError,
  );
  await assert.rejects(
    runMediaProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], 100),
    validationError,
  );
  await assert.rejects(
    runMediaProcess(
      process.execPath,
      ["-e", "process.stderr.write('x'.repeat(1100000));setInterval(()=>{},1000);"],
      10000,
    ),
    validationError,
  );
});
