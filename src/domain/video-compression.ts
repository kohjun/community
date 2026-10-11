export const VIDEO_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const VIDEO_STORED_MAX_BYTES = 25 * 1024 * 1024;
export const VIDEO_MAX_DURATION_SECONDS = 180;
export const VIDEO_MAX_ATTACHMENTS = 3;
export const VIDEO_UPLOAD_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
] as const;

export function acceptsVideoUpload(type: string, bytes: number): boolean {
  return (
    VIDEO_UPLOAD_TYPES.includes(type as (typeof VIDEO_UPLOAD_TYPES)[number]) &&
    Number.isSafeInteger(bytes) &&
    bytes > 0 &&
    bytes <= VIDEO_UPLOAD_MAX_BYTES
  );
}

export interface VideoMetadata {
  width: number;
  height: number;
  durationSeconds: number;
}
export function parseVideoMetadata(value: unknown): VideoMetadata {
  if (!value || typeof value !== "object") throw new Error("Invalid video metadata.");
  const data = value as { streams?: Record<string, unknown>[]; format?: Record<string, unknown> };
  const streams = data.streams;
  if (!Array.isArray(streams)) throw new Error("No video stream.");
  const video = streams.find(
    (stream) =>
      stream.codec_type === "video" &&
      !(stream.disposition as { attached_pic?: number } | undefined)?.attached_pic,
  );
  const durationCandidates = [data.format?.duration, ...streams.map((stream) => stream.duration)]
    .filter((value) => value !== undefined && value !== "N/A")
    .map(Number);
  if (durationCandidates.some((value) => !Number.isFinite(value) || value < 0))
    throw new Error("Invalid duration.");
  const duration = Math.max(0, ...durationCandidates);
  const width = Number(video?.width),
    height = Number(video?.height);
  if (
    !video ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > VIDEO_MAX_DURATION_SECONDS ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 2 ||
    height < 2 ||
    width > 8192 ||
    height > 8192 ||
    width * height > 20_000_000
  )
    throw new Error("Video exceeds processing limits.");
  const formats = String(data.format?.format_name ?? "").split(",");
  if (!formats.some((format) => ["mov", "mp4", "matroska", "webm"].includes(format)))
    throw new Error("Unsupported video container.");
  return { width, height, durationSeconds: duration };
}

export interface VideoByteRange {
  start: number;
  end: number;
}
export function videoByteRange(header: string | null, total: number): VideoByteRange | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw new Error("Invalid range.");
  let start: number, end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) throw new Error("Invalid range.");
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= total ||
    end < start
  )
    throw new Error("Invalid range.");
  return { start, end };
}
