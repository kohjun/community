import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, unlink, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import ffprobe from "@ffprobe-installer/ffprobe";
import {
  parseVideoMetadata,
  VIDEO_STORED_MAX_BYTES,
  VIDEO_UPLOAD_MAX_BYTES,
} from "../domain/video-compression";
import { AppError } from "./errors";

export function runMediaProcess(
  binary: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AppError("VALIDATION", "업로드가 취소됐어요."));
      return;
    }
    const child = spawn(binary, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "",
      stderrBytes = 0,
      failed = false;
    const stop = () => {
      failed = true;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(stop, timeoutMs);
    signal?.addEventListener("abort", stop, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 1024 * 1024) stop();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > 1024 * 1024) stop();
    });
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    };
    child.once("error", () => {
      cleanup();
      reject(
        new AppError("INTERNAL", "영상 압축 도구를 실행할 수 없어요. 서버 설정을 확인해주세요."),
      );
    });
    child.once("close", (code) => {
      cleanup();
      if (failed || code !== 0)
        reject(
          new AppError(
            "VALIDATION",
            failed
              ? "영상 처리가 오래 걸렸어요. 짧은 영상으로 다시 시도해주세요."
              : "읽을 수 있는 MP4·MOV·WebM 영상을 선택해주세요.",
          ),
        );
      else resolve(output);
    });
  });
}
export async function probeVideo(file: string, signal?: AbortSignal) {
  const result = await runMediaProcess(
    ffprobe.path,
    [
      "-v",
      "error",
      "-max_alloc",
      "134217728",
      "-protocol_whitelist",
      "file,pipe",
      "-format_whitelist",
      "mov,matroska,webm",
      "-show_entries",
      "format=duration,format_name:stream=codec_type,width,height,duration:stream_disposition=attached_pic",
      "-of",
      "json",
      file,
    ],
    15000,
    signal,
  );
  try {
    return parseVideoMetadata(JSON.parse(result));
  } catch {
    throw new AppError(
      "VALIDATION",
      "영상은 3분·2천만 화소 이하의 MP4·MOV·WebM 파일로 올려주세요.",
    );
  }
}
type MediaGate = { occupied: boolean };
const gateKey = Symbol.for("sliper.video-transcoding-gate");
const globalGate = globalThis as typeof globalThis & { [gateKey]?: MediaGate };
export async function withVideoProcessingSlot<T>(work: () => Promise<T>): Promise<T> {
  const gate = (globalGate[gateKey] ??= { occupied: false });
  if (gate.occupied)
    throw new AppError("RATE_LIMITED", "다른 영상을 처리하고 있어요. 잠시 후 다시 올려주세요.");
  gate.occupied = true;
  try {
    return await work();
  } finally {
    gate.occupied = false;
  }
}
export async function compressVideo(bytes: Uint8Array, signal?: AbortSignal) {
  if (!bytes.byteLength || bytes.byteLength > VIDEO_UPLOAD_MAX_BYTES)
    throw new AppError("VALIDATION", "영상은 50MB 이하로 올려주세요.");
  if (!ffmpeg) throw new AppError("INTERNAL", "이 서버에서 영상 압축 도구를 사용할 수 없어요.");
  const directory = await mkdtemp(path.join(tmpdir(), "sliper-video-"));
  const input = path.join(directory, "source"),
    output = path.join(directory, "compressed.mp4");
  try {
    await writeFile(input, bytes, { flag: "wx", mode: 0o600 });
    await probeVideo(input, signal);
    await runMediaProcess(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-max_alloc",
        "134217728",
        "-threads",
        "1",
        "-filter_threads",
        "1",
        "-filter_complex_threads",
        "1",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "mov,matroska,webm",
        "-i",
        input,
        "-map",
        "0:V:0",
        "-map",
        "0:a:0?",
        "-sn",
        "-dn",
        "-map_metadata",
        "-1",
        "-map_metadata:s",
        "-1",
        "-map_chapters",
        "-1",
        "-vf",
        "scale=w='max(2,trunc(min(min(1280,720*dar),iw*sar)/2)*2)':h='max(2,trunc(ow/dar/2)*2)',setsar=1",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-maxrate",
        "900k",
        "-bufsize",
        "1800k",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "30",
        "-threads",
        "1",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-ac",
        "2",
        "-ar",
        "44100",
        "-t",
        "181",
        "-fs",
        String(VIDEO_STORED_MAX_BYTES),
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        "-n",
        output,
      ],
      120000,
      signal,
    );
    const file = await stat(output);
    if (!file.size || file.size >= VIDEO_STORED_MAX_BYTES)
      throw new AppError(
        "VALIDATION",
        "압축한 영상도 용량이 커요. 영상을 줄인 뒤 다시 올려주세요.",
      );
    const metadata = await probeVideo(output, signal);
    if (metadata.width > 1280 || metadata.height > 720)
      throw new AppError("INTERNAL", "영상 압축 결과를 확인하지 못했어요.");
    const buffer = await readFile(/* turbopackIgnore: true */ output);
    return { bytes: buffer, ...metadata };
  } finally {
    await Promise.all(
      [input, output].map((file) =>
        unlink(file).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") console.error("Sliper video temporary cleanup failed.");
        }),
      ),
    );
    await rmdir(directory).catch(() => console.error("Sliper video temporary cleanup failed."));
  }
}
