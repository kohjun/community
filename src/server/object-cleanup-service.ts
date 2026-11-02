import { randomUUID } from "node:crypto";
import { and, asc, eq, or, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { objectCleanupJobs as jobs } from "../db/object-cleanup-schema";
import { mediaAssets, profilePhotos } from "../db/schema";
import { videoAssets } from "../db/video-schema";
import {
  isImageStorageKey,
  type ImageStorageBackend,
  type ImageStorageKind,
} from "../domain/image-storage";
import { AppError } from "./errors";
export type CleanupConnection = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];
export type CleanupObject = {
  kind: ImageStorageKind;
  storageBackend: ImageStorageBackend;
  objectKey: string;
};
export type CleanupReason =
  "profile-replaced" | "profile-cleared" | "account-closed" | "upload-rollback";
export async function enqueueObjectCleanup(
  connection: CleanupConnection,
  object: CleanupObject,
  reason: CleanupReason,
  delayMs = 0,
) {
  if (!isImageStorageKey(object.kind, object.objectKey))
    throw new AppError("VALIDATION", "정리 파일 식별자를 확인해주세요.");
  const [created] = await connection
    .insert(jobs)
    .values({ ...object, reason, availableAt: new Date(Date.now() + delayMs) })
    .onConflictDoNothing()
    .returning({ id: jobs.id });
  if (created) return created.id;
  const [existing] = await connection
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.storageBackend, object.storageBackend),
        eq(jobs.kind, object.kind),
        eq(jobs.objectKey, object.objectKey),
      ),
    );
  return existing!.id;
}
/** A late upload failure invalidates an older deletion acknowledgement and queues another attempt. */
export async function rearmObjectCleanup(connection: CleanupConnection, object: CleanupObject) {
  if (!isImageStorageKey(object.kind, object.objectKey))
    throw new AppError("VALIDATION", "정리 파일 식별자를 확인해주세요.");
  await connection
    .insert(jobs)
    .values({ ...object, reason: "upload-rollback" })
    .onConflictDoUpdate({
      target: [jobs.storageBackend, jobs.kind, jobs.objectKey],
      set: {
        status: "pending",
        attempts: 0,
        availableAt: new Date(),
        leaseUntil: null,
        lockToken: null,
        errorCode: null,
      },
    });
}
export function objectCleanupService(
  db: Database,
  remove: (object: CleanupObject) => Promise<void>,
) {
  async function claim(id?: string) {
    return db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(jobs)
        .where(
          and(
            id ? eq(jobs.id, id) : undefined,
            or(
              eq(jobs.status, "pending"),
              and(eq(jobs.status, "processing"), sql`${jobs.leaseUntil}<=statement_timestamp()`),
            ),
            sql`${jobs.availableAt}<=statement_timestamp()`,
          ),
        )
        .orderBy(asc(jobs.availableAt), asc(jobs.id))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!job) return null;
      if (job.attempts >= 8) {
        await tx
          .update(jobs)
          .set({ status: "failed", leaseUntil: null, lockToken: null })
          .where(eq(jobs.id, job.id));
        return null;
      }
      const token = randomUUID();
      const [claimed] = await tx
        .update(jobs)
        .set({
          status: "processing",
          attempts: job.attempts + 1,
          lockToken: token,
          leaseUntil: sql`statement_timestamp()+interval '2 minutes'`,
        })
        .where(eq(jobs.id, job.id))
        .returning();
      return claimed!;
    });
  }
  async function referenced(object: CleanupObject) {
    const table =
      object.kind === "profile"
        ? profilePhotos
        : object.kind === "video"
          ? videoAssets
          : mediaAssets;
    const [row] = await db
      .select({ id: table.id })
      .from(table)
      .where(
        and(eq(table.objectKey, object.objectKey), eq(table.storageBackend, object.storageBackend)),
      )
      .limit(1);
    return !!row;
  }
  async function processOne(id?: string) {
    const job = await claim(id);
    if (!job) return false;
    try {
      // Existing metadata always wins; this queue never expires attached or private assets.
      if (!(await referenced(job))) await remove(job);
      await db.delete(jobs).where(and(eq(jobs.id, job.id), eq(jobs.lockToken, job.lockToken!)));
    } catch {
      await db
        .update(jobs)
        .set({
          status: job.attempts >= 8 ? "failed" : "pending",
          lockToken: null,
          leaseUntil: null,
          errorCode: "STORAGE_DELETE_FAILED",
          availableAt: new Date(Date.now() + Math.min(3600, 30 * 2 ** job.attempts) * 1000),
        })
        .where(and(eq(jobs.id, job.id), eq(jobs.lockToken, job.lockToken!)));
    }
    return true;
  }
  async function drain(limit = 10) {
    let processed = 0;
    while (processed < limit && (await processOne())) processed++;
    return { cleanupProcessed: processed };
  }
  return { processOne, drain };
}
