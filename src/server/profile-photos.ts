import "server-only";
import { randomUUID } from "node:crypto";
import type { ImageStorageBackend, StoredImageObject } from "../domain/image-storage";
import { imageObjectStore } from "./image-storage";
import { persistImageObject } from "./image-storage-core";
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
    await imageObjectStore(storageBackend).remove("profile", objectKey);
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
  const previous = await persistImageObject(
    imageObjectStore(),
    "profile",
    objectKey,
    output,
    async (stored) => {
      return profilePhotoService(getDatabase()).replaceStored(userId, {
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

export async function readProfilePhoto(id: string, actor: string | null, roomId?: string | null) {
  const photo = await profilePhotoService(getDatabase()).read(actor, id, roomId);
  const bytes = await imageObjectStore(photo.storageBackend).read("profile", photo.objectKey);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
    },
  });
}
