import { videoByteRange, VIDEO_STORED_MAX_BYTES } from "../domain/video-compression";
import { AppError } from "./errors";
import type { ObjectByteRange } from "./object-range-stream";

/** Call after all parent post, block and event record checks, including for HEAD and invalid ranges. */
export async function authorizedVideoResponse(
  request: Request,
  total: number,
  load: (range: ObjectByteRange, signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>,
) {
  if (!Number.isSafeInteger(total) || total < 1 || total > VIDEO_STORED_MAX_BYTES)
    throw new AppError("INTERNAL", "영상 파일을 확인하지 못했어요.");
  const headers = new Headers({
    "Content-Type": "video/mp4",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
    "Content-Disposition": "inline",
    "Accept-Ranges": "bytes",
    Vary: "Cookie",
  });
  let range;
  try {
    range = videoByteRange(request.headers.get("range"), total);
  } catch {
    headers.set("Content-Range", `bytes */${total}`);
    headers.set("Content-Length", "0");
    return new Response(null, { status: 416, headers });
  }
  const start = range?.start ?? 0,
    end = range?.end ?? total - 1;
  headers.set("Content-Length", String(end - start + 1));
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
  const status = range ? 206 : 200;
  if (request.method === "HEAD") return new Response(null, { status, headers });
  const stream = await load({ start, end, total }, request.signal);
  return new Response(stream, { status, headers });
}
