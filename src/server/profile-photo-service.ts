import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import {
  eventApplications,
  eventSettings,
  posts,
  profilePhotos,
  profiles,
  roomManagers,
  roomMembers,
} from "../db/schema";
import { uuidSchema } from "../domain/validation";
import {
  isImageStorageKey,
  type ImageStorageBackend,
  type StoredImageObject,
} from "../domain/image-storage";
import { AppError, requireActor } from "./errors";
import { IMAGE_COMPRESSION_POLICY, IMAGE_UPLOAD_CONTENT_TYPES } from "../domain/image-compression";

export const PROFILE_PHOTO_MAX_INPUT_BYTES = IMAGE_COMPRESSION_POLICY.profile.maxInputBytes;
// Keep the historical storage ceiling so older photos remain valid; new uploads use 256KB.
export const PROFILE_PHOTO_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
export const PROFILE_PHOTO_TYPES = IMAGE_UPLOAD_CONTENT_TYPES;
export function isProfilePhotoObjectKey(value: string): boolean {
  return isImageStorageKey("profile", value);
}

type PhotoInput = {
  id: string;
  objectKey: string;
  contentType: "image/webp";
  bytes: number;
  storageBackend?: ImageStorageBackend;
};
/** Metadata is server-generated. This service never accepts a member identity from a request body. */
export function profilePhotoService(db: Database) {
  async function replaceStored(
    actor: string | null,
    input: PhotoInput,
  ): Promise<StoredImageObject | null> {
    const userId = requireActor(actor),
      id = uuidSchema.parse(input.id);
    if (
      !isProfilePhotoObjectKey(input.objectKey) ||
      (input.storageBackend !== undefined &&
        !["local", "supabase"].includes(input.storageBackend)) ||
      input.objectKey !== id + ".webp" ||
      input.contentType !== "image/webp" ||
      !Number.isSafeInteger(input.bytes) ||
      input.bytes < 1 ||
      input.bytes > PROFILE_PHOTO_MAX_OUTPUT_BYTES
    )
      throw new AppError("VALIDATION", "프로필 사진 정보를 확인해주세요.");
    return db.transaction(async (tx) => {
      const [profile] = await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .for("update");
      if (!profile) throw new AppError("NOT_FOUND", "프로필을 찾을 수 없어요.");
      const [previous] = await tx
        .select({
          objectKey: profilePhotos.objectKey,
          storageBackend: profilePhotos.storageBackend,
        })
        .from(profilePhotos)
        .where(eq(profilePhotos.userId, userId));
      if (previous?.objectKey === input.objectKey)
        throw new AppError("CONFLICT", "이미 저장된 프로필 사진이에요.");
      const now = new Date();
      await tx
        .insert(profilePhotos)
        .values({
          ...input,
          storageBackend: input.storageBackend ?? "local",
          userId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: profilePhotos.userId,
          set: {
            ...input,
            storageBackend: input.storageBackend ?? "local",
            createdAt: now,
            updatedAt: now,
          },
        });
      await tx.update(profiles).set({ updatedAt: now }).where(eq(profiles.id, userId));
      return previous ?? null;
    });
  }
  async function clearStored(actor: string | null): Promise<StoredImageObject | null> {
    const userId = requireActor(actor);
    return db.transaction(async (tx) => {
      const [profile] = await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .for("update");
      if (!profile) throw new AppError("NOT_FOUND", "프로필을 찾을 수 없어요.");
      const [previous] = await tx
        .delete(profilePhotos)
        .where(eq(profilePhotos.userId, userId))
        .returning({
          objectKey: profilePhotos.objectKey,
          storageBackend: profilePhotos.storageBackend,
        });
      await tx.update(profiles).set({ updatedAt: new Date() }).where(eq(profiles.id, userId));
      return previous ?? null;
    });
  }
  async function read(actor: string | null, photoId: string, roomId?: string | null) {
    const userId = requireActor(actor),
      id = uuidSchema.parse(photoId),
      room = roomId ? uuidSchema.parse(roomId) : null;
    const notFound = () => new AppError("NOT_FOUND", "프로필 사진을 찾을 수 없어요.");
    return db.transaction(async (tx) => {
      const [photo] = await tx.select().from(profilePhotos).where(eq(profilePhotos.id, id));
      if (!photo) throw notFound();
      if (photo.userId === userId) return photo;
      if (!room) throw notFound();
      // The event lock is also held by approval, refund and manager changes.
      const [post] = await tx
        .select({ authorId: posts.authorId })
        .from(posts)
        .where(and(eq(posts.id, room), eq(posts.status, "published")))
        .for("update");
      const [settings] = await tx
        .select({ postId: eventSettings.postId })
        .from(eventSettings)
        .where(eq(eventSettings.postId, room));
      if (!post || !settings) throw notFound();
      async function isCurrentMember(memberId: string) {
        if (post!.authorId === memberId) return true;
        const [manager] = await tx
          .select({ userId: roomManagers.userId })
          .from(roomManagers)
          .where(and(eq(roomManagers.postId, room!), eq(roomManagers.userId, memberId)));
        if (manager) return true;
        const [participant] = await tx
          .select({ userId: roomMembers.userId })
          .from(roomMembers)
          .innerJoin(eventApplications, eq(eventApplications.id, roomMembers.applicationId))
          .where(
            and(
              eq(roomMembers.postId, room!),
              eq(roomMembers.userId, memberId),
              sql`${roomMembers.revokedAt} is null`,
              eq(eventApplications.status, "confirmed"),
            ),
          );
        return !!participant;
      }
      if (!(await isCurrentMember(userId)) || !(await isCurrentMember(photo.userId)))
        throw notFound();
      return photo;
    });
  }
  async function replace(actor: string | null, input: PhotoInput) {
    return (await replaceStored(actor, input))?.objectKey ?? null;
  }
  async function clear(actor: string | null) {
    return (await clearStored(actor))?.objectKey ?? null;
  }
  return { replace, clear, replaceStored, clearStored, read };
}
