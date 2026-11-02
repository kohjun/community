import type { Database } from "../db/connection";
import { eq } from "drizzle-orm";
import { objectCleanupJobs } from "../db/object-cleanup-schema";
import type { ImageStorageKind, StoredImageObject } from "../domain/image-storage";
import type { ImageObjectStore } from "./image-storage-core";
import {
  enqueueObjectCleanup,
  rearmObjectCleanup,
  type CleanupConnection,
} from "./object-cleanup-service";
import { AppError } from "./errors";
/** The durable upload intent exists before Storage writes. Metadata and intent removal commit together. */
export async function persistManagedImage<T>(
  db: Database,
  store: ImageObjectStore,
  kind: ImageStorageKind,
  objectKey: string,
  bytes: Uint8Array,
  persist: (connection: CleanupConnection, object: StoredImageObject) => Promise<T>,
) {
  const object = { kind, objectKey, storageBackend: store.backend };
  const intent = await enqueueObjectCleanup(db, object, "upload-rollback", 60 * 60_000);
  try {
    await store.write(kind, objectKey, bytes);
    return await db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(objectCleanupJobs)
        .where(eq(objectCleanupJobs.id, intent))
        .for("update");
      if (!job || job.status !== "pending" || job.attempts !== 0)
        throw new AppError("CONFLICT", "사진 저장 시간이 지나 다시 업로드해주세요.");
      const result = await persist(tx, { objectKey, storageBackend: store.backend });
      await tx.delete(objectCleanupJobs).where(eq(objectCleanupJobs.id, intent));
      return result;
    });
  } catch (error) {
    // If the DB is temporarily unavailable, the prewritten intent is still due after one hour.
    await rearmObjectCleanup(db, object).catch(() => {});
    throw error;
  }
}
