import { authorizedImageResponse } from "./image-delivery";
import { assertReunionImageAccess } from "./reunion-media-access";
import "server-only";
import { randomUUID } from "node:crypto";
import { imageObjectStore } from "./image-storage";
import { persistManagedImage } from "./image-persistence";
import { compressUploadedImage } from "./image-compression";
import { and, eq, or, isNull } from "drizzle-orm";
import { getDatabase } from "../db/client";
import { mediaAssets, posts } from "../db/schema";
import { imageUploadSchema, uuidSchema } from "../domain/validation";
import { AppError, requireActor } from "./errors";
import { readBody } from "./http";
import { enforceRequestLimit } from "./request-limits";
import { assertRecordMediaAccess } from "./record-policy";
import { contentVisible, authorVisible } from "./safety-visibility";

export async function uploadImage(request: Request, actor: string | null) {
  const userId = requireActor(actor);
  await enforceRequestLimit(getDatabase(), userId, "upload", 20);
  const bytes = await readBody(request, 11 * 1024 * 1024);
  let form: FormData;
  try {
    form = await new Request(request.url, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") || "" },
      body: new Uint8Array(bytes),
    }).formData();
  } catch {
    throw new AppError("VALIDATION", "올바른 사진 업로드 형식으로 요청해주세요.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION", "사진을 선택해주세요.");
  imageUploadSchema.parse({ contentType: file.type, byteSize: file.size });
  const output = await compressUploadedImage(Buffer.from(await file.arrayBuffer()), "post");
  const id = randomUUID(),
    objectKey = `${id}.webp`;
  await persistManagedImage(
    getDatabase(),
    imageObjectStore(),
    "post",
    objectKey,
    output,
    async (connection, stored) => {
      await connection.insert(mediaAssets).values({
        id,
        uploaderId: userId,
        ...stored,
        contentType: "image/webp",
        byteSize: output.byteLength,
        status: "ready",
      });
    },
  );
  return { id, src: `/api/media/${id}`, contentType: "image/webp", sortOrder: 0 };
}

export async function readImage(id: string, actor: string | null, request?: Request) {
  const [row] = await getDatabase()
    .select({ asset: mediaAssets, post: posts })
    .from(mediaAssets)
    .leftJoin(posts, eq(posts.id, mediaAssets.postId))
    .where(
      and(
        eq(mediaAssets.id, uuidSchema.parse(id)),
        eq(mediaAssets.status, "ready"),
        authorVisible(posts.authorId, actor),
        or(isNull(mediaAssets.postId), contentVisible("post", posts.id)),
      ),
    );
  const visible =
    row &&
    (row.asset.reunionOriginPostId !== null ||
      row.post?.status === "published" ||
      (row.asset.recordPostId !== null && row.asset.recordOriginPostId !== null) ||
      (!row.asset.postId && !row.asset.recordPostId && actor && row.asset.uploaderId === actor));
  if (!visible || !row) throw new AppError("NOT_FOUND", "이미지를 찾을 수 없어요.");
  if (row.asset.reunionOriginPostId)
    await assertReunionImageAccess(getDatabase(), row.asset.reunionOriginPostId, id, actor);
  if (row.asset.recordOriginPostId)
    await assertRecordMediaAccess(getDatabase(), row.asset.recordOriginPostId, actor);
  return authorizedImageResponse(
    request,
    {
      id: row.asset.id,
      contentType: row.asset.contentType,
      byteSize: row.asset.byteSize,
      browserCache:
        !!row.asset.postId && !row.asset.recordOriginPostId && !row.asset.reunionOriginPostId,
    },
    () => imageObjectStore(row.asset.storageBackend).read("post", row.asset.objectKey),
  );
}
