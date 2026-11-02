import { authorizedImageResponse } from "./image-delivery";
import "server-only";
import { randomUUID } from "node:crypto";
import type { ImageStorageBackend, StoredImageObject } from "../domain/image-storage";
import { imageObjectStore } from "./image-storage";
import { persistManagedImage } from "./image-persistence";
import { enqueueObjectCleanup, objectCleanupService } from "./object-cleanup-service";
import type { Database } from "../db/connection";
import { compressUploadedImage } from "./image-compression";
import { getDatabase } from "../db/client";
import { AppError, requireActor } from "./errors";
import { assertSameOrigin, readBody } from "./http";
import {
  profilePhotoService,
  PROFILE_PHOTO_MAX_INPUT_BYTES,
  PROFILE_PHOTO_TYPES,
} from "./profile-photo-service";

export async function removeFile(
  objectKey: string | null,
  storageBackend: ImageStorageBackend = "local",
) {
  if (!objectKey) return;
  try {
    const db = getDatabase();
    const id = await enqueueObjectCleanup(
      db,
      { kind: "profile", storageBackend, objectKey },
      "profile-cleared",
    );
    await objectCleanupService(db, async (object) =>
      imageObjectStore(object.storageBackend).remove(object.kind, object.objectKey),
    ).processOne(id);
  } catch {
    console.error("Sliper profile photo cleanup failed.");
  }
}
async function removePreviousPhoto(previous: StoredImageObject | null) {
  if (previous) await removeFile(previous.objectKey, previous.storageBackend);
}

export async function uploadProfilePhoto(request: Request, actor: string | null) {
  const userId = requireActor(actor);
  assertSameOrigin(request);
  const bytes = await readBody(request, PROFILE_PHOTO_MAX_INPUT_BYTES + 128 * 1024);
  let form: FormData;
  try {
    form = await new Request(request.url, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") || "" },
      body: new Uint8Array(bytes),
    }).formData();
  } catch {
    throw new AppError("VALIDATION", "올바른 프로필 사진 업로드 형식으로 요청해주세요.");
  }
  let unexpectedField = false;
  form.forEach((_value, key) => {
    if (key !== "file") unexpectedField = true;
  });
  const files = form.getAll("file");
  if (files.length !== 1 || !(files[0] instanceof File) || unexpectedField)
    throw new AppError("VALIDATION", "프로필 사진 한 장을 선택해주세요.");
  const file = files[0];
  if (
    file.size < 1 ||
    file.size > PROFILE_PHOTO_MAX_INPUT_BYTES ||
    !PROFILE_PHOTO_TYPES.some((type) => type === file.type)
  )
    throw new AppError("VALIDATION", "5MB 이하의 JPG·PNG·WebP·GIF 사진을 선택해주세요.");
  const output = await compressUploadedImage(Buffer.from(await file.arrayBuffer()), "profile");
  const id = randomUUID(),
    objectKey = id + ".webp";
  const previous = await persistManagedImage(
    getDatabase(),
    imageObjectStore(),
    "profile",
    objectKey,
    output,
    async (connection, stored) => {
      return profilePhotoService(connection as Database).replaceStored(userId, {
        id,
        ...stored,
        contentType: "image/webp",
        bytes: output.byteLength,
      });
    },
  );
  await removePreviousPhoto(previous);
}

export async function clearProfilePhoto(request: Request, actor: string | null) {
  const userId = requireActor(actor);
  assertSameOrigin(request);
  await removePreviousPhoto(await profilePhotoService(getDatabase()).clearStored(userId));
}

export async function readProfilePhoto(
  id: string,
  actor: string | null,
  roomId?: string | null,
  request?: Request,
) {
  const photo = await profilePhotoService(getDatabase()).read(actor, id, roomId);
  return authorizedImageResponse(
    request,
    { id: photo.id, contentType: "image/webp", byteSize: photo.bytes, browserCache: false },
    () => imageObjectStore(photo.storageBackend).read("profile", photo.objectKey),
  );
}
