import "server-only";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "../db/client";
import { posts } from "../db/schema";
import { videoAssets } from "../db/video-schema";
import {
  acceptsVideoUpload,
  VIDEO_UPLOAD_MAX_BYTES,
  videoByteRange,
} from "../domain/video-compression";
import { uuidSchema } from "../domain/validation";
import type { QueuedVideoUpload, VideoJobView } from "../domain/video-processing";
import { AppError, requireActor } from "./errors";
import { readBody } from "./http";
import { enforceRequestLimit } from "./request-limits";
import { imageObjectStore } from "./image-storage";
import { videoSourceStore } from "./video-source-storage";
import { videoProcessingService } from "./video-processing-service";
import { assertRecordMediaAccess } from "./record-policy";
import { assertContentVisible } from "./safety-visibility";

/** Web requests only enqueue bounded originals. FFmpeg runs in the independent worker. */
export async function uploadVideo(
  request: Request,
  actor: string | null,
): Promise<QueuedVideoUpload> {
  const userId = requireActor(actor);
  await enforceRequestLimit(getDatabase(), userId, "video-upload", 6);
  const bytes = await readBody(request, VIDEO_UPLOAD_MAX_BYTES + 64 * 1024);
  let form: FormData;
  try {
    form = await new Request(request.url, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") ?? "" },
      body: new Uint8Array(bytes),
    }).formData();
  } catch {
    throw new AppError("VALIDATION", "올바른 영상 업로드 형식으로 요청해주세요.");
  }
  const file = form.get("file");
  if (!(file instanceof File) || !acceptsVideoUpload(file.type, file.size))
    throw new AppError("VALIDATION", "50MB 이하의 MP4·MOV·WebM 영상을 선택해주세요.");
  return videoProcessingService(getDatabase()).enqueue(
    userId,
    new Uint8Array(await file.arrayBuffer()),
    videoSourceStore(),
    request.signal,
  );
}
export async function readVideoJob(id: string, actor: string | null): Promise<VideoJobView> {
  return videoProcessingService(getDatabase()).view(id, actor);
}
export async function readVideo(id: string, actor: string | null, request: Request) {
  const [row] = await getDatabase()
    .select({ asset: videoAssets, post: posts })
    .from(videoAssets)
    .leftJoin(posts, eq(posts.id, videoAssets.postId))
    .where(and(eq(videoAssets.id, uuidSchema.parse(id)), eq(videoAssets.status, "ready")));
  if (
    !row ||
    !(
      row.post?.status === "published" ||
      (row.asset.recordPostId !== null && row.asset.recordOriginPostId !== null) ||
      (!row.asset.postId && !row.asset.recordPostId && actor && row.asset.uploaderId === actor)
    )
  )
    throw new AppError("NOT_FOUND", "영상을 찾을 수 없어요.");
  if (row.asset.postId) await assertContentVisible(getDatabase(), "post", row.asset.postId);
  if (row.asset.recordOriginPostId)
    await assertRecordMediaAccess(getDatabase(), row.asset.recordOriginPostId, actor);
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
    "Content-Disposition": "inline",
    "Accept-Ranges": "bytes",
  };
  let range;
  try {
    range = videoByteRange(request.headers.get("range"), row.asset.byteSize);
  } catch {
    return new Response(null, {
      status: 416,
      headers: { ...headers, "Content-Range": "bytes */" + row.asset.byteSize },
    });
  }
  const start = range?.start ?? 0,
    end = range?.end ?? row.asset.byteSize - 1;
  headers["Content-Length"] = String(end - start + 1);
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${row.asset.byteSize}`;
  if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
  const bytes = await imageObjectStore(row.asset.storageBackend).read("video", row.asset.objectKey);
  if (bytes.byteLength !== row.asset.byteSize)
    throw new AppError("INTERNAL", "영상 파일을 확인하지 못했어요.");
  return new Response(new Uint8Array(bytes.subarray(start, end + 1)), {
    status: range ? 206 : 200,
    headers,
  });
}
