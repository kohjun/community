import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/connection";
import { mediaAssets } from "../db/schema";
import { videoAssets } from "../db/video-schema";
import {
  postDocumentImageIds,
  postDocumentVideoIds,
  type PostDocument,
} from "../domain/post-document";
import { AppError } from "./errors";
export { assertRecordMediaAccess } from "./record-policy";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export async function attachRecordMedia(
  tx: Tx,
  postId: string,
  actor: string,
  document: PostDocument | null,
) {
  const images = document ? postDocumentImageIds(document) : [],
    videos = document ? postDocumentVideoIds(document) : [];
  if (images.length > 10 || videos.length > 3)
    throw new AppError("VALIDATION", "사진은 10개, 영상은 3개까지 첨부할 수 있어요.");
  const pictureRows = images.length
    ? await tx
        .select()
        .from(mediaAssets)
        .where(inArray(mediaAssets.id, images))
        .orderBy(asc(mediaAssets.id))
        .for("update")
    : [];
  const videoRows = videos.length
    ? await tx
        .select()
        .from(videoAssets)
        .where(inArray(videoAssets.id, videos))
        .orderBy(asc(videoAssets.id))
        .for("update")
    : [];
  for (const [rows, ids] of [
    [pictureRows, images],
    [videoRows, videos],
  ] as const) {
    if (
      rows.length !== ids.length ||
      rows.some(
        (a) =>
          a.uploaderId !== actor ||
          a.status !== "ready" ||
          a.postId !== null ||
          (a.recordPostId !== null && a.recordPostId !== postId) ||
          (a.recordOriginPostId !== null && a.recordOriginPostId !== postId),
      )
    )
      throw new AppError("FORBIDDEN", "본인이 업로드한 이 기록의 사진과 영상만 첨부할 수 있어요.");
  }
  await tx
    .update(mediaAssets)
    .set({ recordPostId: null })
    .where(eq(mediaAssets.recordPostId, postId));
  await tx
    .update(videoAssets)
    .set({ recordPostId: null })
    .where(eq(videoAssets.recordPostId, postId));
  for (const [sortOrder, id] of images.entries())
    await tx
      .update(mediaAssets)
      .set({ recordPostId: postId, sortOrder })
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.uploaderId, actor)));
  for (const [sortOrder, id] of videos.entries())
    await tx
      .update(videoAssets)
      .set({ recordPostId: postId, sortOrder })
      .where(and(eq(videoAssets.id, id), eq(videoAssets.uploaderId, actor)));
}
