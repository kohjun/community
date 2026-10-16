import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { mediaAssets } from "../db/schema";
import { videoAssets } from "../db/video-schema";
import { mediaRetentionJobs } from "../db/media-retention-schema";
import {
  MEDIA_RETENTION_BATCH_SIZE,
  MEDIA_RETENTION_MAX_ATTEMPTS,
  MEDIA_RETENTION_LEASE_SECONDS,
  UNATTACHED_MEDIA_RETENTION_DAYS,
  type MediaRetentionSummary,
  type RetentionAssetKind,
} from "../domain/media-retention";
import type { ImageStorageBackend } from "../domain/image-storage";
import { analyticsService } from "./analytics-service";
type Table = typeof mediaAssets | typeof videoAssets;
type Job = typeof mediaRetentionJobs.$inferSelect;
export type RetentionObjectRemover = (
  kind: RetentionAssetKind,
  backend: ImageStorageBackend,
  key: string,
) => Promise<void>;
const table = (kind: RetentionAssetKind) => (kind === "image" ? mediaAssets : videoAssets);
function eligible(t: Table, kind: RetentionAssetKind, at: Date) {
  return and(
    isNull(t.postId),
    isNull(t.recordPostId),
    isNull(t.recordOriginPostId),
    sql`${t.unattachedSince} <= ${new Date(at.getTime() - UNATTACHED_MEDIA_RETENTION_DAYS * 86400000).toISOString()}::timestamptz`,
    sql`not exists(select 1 from sliper.media_retention_jobs j where j.asset_kind=${kind} and j.asset_id=${t.id})`,
  );
}
/** Durable file-removal outbox: parents are checked under row locks before files can be removed. */
export function mediaRetentionService(db: Database) {
  async function summary(): Promise<MediaRetentionSummary> {
    const now = new Date();
    const [images, videos, jobs] = await Promise.all([
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(mediaAssets)
        .where(eligible(mediaAssets, "image", now)),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(videoAssets)
        .where(eligible(videoAssets, "video", now)),
      db
        .select({
          queued: sql<number>`count(*) filter(where ${mediaRetentionJobs.status}='pending')::int`,
          processing: sql<number>`count(*) filter(where ${mediaRetentionJobs.status}='processing')::int`,
          failed: sql<number>`count(*) filter(where ${mediaRetentionJobs.status}='failed')::int`,
          removed: sql<number>`count(*) filter(where ${mediaRetentionJobs.status}='removed')::int`,
        })
        .from(mediaRetentionJobs),
    ]);
    return {
      checkedAt: now.toISOString(),
      retentionDays: UNATTACHED_MEDIA_RETENTION_DAYS,
      eligibleImages: Number(images[0]?.n ?? 0),
      eligibleVideos: Number(videos[0]?.n ?? 0),
      ...jobs[0]!,
    };
  }
  async function reserve() {
    return db.transaction(async (tx) => {
      let reserved = 0;
      for (const kind of ["image", "video"] as const) {
        const t = table(kind);
        const rows = await tx
          .select()
          .from(t)
          .where(eligible(t, kind, new Date()))
          .orderBy(asc(t.id))
          .limit(MEDIA_RETENTION_BATCH_SIZE)
          .for("update", { skipLocked: true });
        for (const asset of rows) {
          const [job] = await tx
            .insert(mediaRetentionJobs)
            .values({
              assetKind: kind,
              assetId: asset.id,
              objectKey: asset.objectKey,
              storageBackend: asset.storageBackend,
            })
            .onConflictDoNothing()
            .returning({ id: mediaRetentionJobs.id });
          if (!job) continue;
          await tx.update(t).set({ status: "pending" }).where(eq(t.id, asset.id));
          reserved++;
        }
      }
      return reserved;
    });
  }
  async function claim(): Promise<Job | null | undefined> {
    return db.transaction(async (tx) => {
      const now = new Date().toISOString();
      const [job] = await tx
        .select()
        .from(mediaRetentionJobs)
        .where(
          and(
            or(
              eq(mediaRetentionJobs.status, "pending"),
              and(
                eq(mediaRetentionJobs.status, "processing"),
                sql`${mediaRetentionJobs.leaseUntil}<=${now}::timestamptz`,
              ),
            ),
            sql`${mediaRetentionJobs.availableAt}<=${now}::timestamptz`,
          ),
        )
        .orderBy(asc(mediaRetentionJobs.availableAt), asc(mediaRetentionJobs.id))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!job) return;
      if (job.attempts >= MEDIA_RETENTION_MAX_ATTEMPTS) {
        await tx
          .update(mediaRetentionJobs)
          .set({
            status: "failed",
            leaseUntil: null,
            lockToken: null,
            errorCode: job.errorCode ?? "STORAGE_DELETE_FAILED",
          })
          .where(eq(mediaRetentionJobs.id, job.id));
        return null;
      }
      const [claimed] = await tx
        .update(mediaRetentionJobs)
        .set({
          status: "processing",
          attempts: job.attempts + 1,
          leaseUntil: sql`clock_timestamp()+${MEDIA_RETENTION_LEASE_SECONDS}*interval '1 second'`,
          lockToken: randomUUID(),
        })
        .where(eq(mediaRetentionJobs.id, job.id))
        .returning();
      return claimed;
    });
  }
  const owns = (job: Job) =>
    and(
      eq(mediaRetentionJobs.id, job.id),
      eq(mediaRetentionJobs.status, "processing"),
      eq(mediaRetentionJobs.lockToken, job.lockToken!),
      sql`${mediaRetentionJobs.leaseUntil}>statement_timestamp()`,
    );
  async function process(job: Job, remove: RetentionObjectRemover) {
    const [current] = await db
      .select({ id: mediaRetentionJobs.id })
      .from(mediaRetentionJobs)
      .where(owns(job));
    if (!current) return false;
    const t = table(job.assetKind);
    const [asset] = await db.select().from(t).where(eq(t.id, job.assetId));
    if (
      asset &&
      (asset.postId ||
        asset.recordPostId ||
        asset.recordOriginPostId ||
        asset.status !== "pending" ||
        asset.objectKey !== job.objectKey ||
        asset.storageBackend !== job.storageBackend)
    ) {
      await db
        .update(mediaRetentionJobs)
        .set({
          status: "failed",
          lockToken: null,
          leaseUntil: null,
          errorCode: "SOURCE_NOT_ELIGIBLE",
        })
        .where(owns(job));
      return false;
    }
    try {
      await remove(job.assetKind, job.storageBackend, job.objectKey);
      const removed = await db
        .update(mediaRetentionJobs)
        .set({
          status: "removed",
          removedAt: sql`clock_timestamp()`,
          lockToken: null,
          leaseUntil: null,
          errorCode: null,
        })
        .where(owns(job))
        .returning({ id: mediaRetentionJobs.id });
      return removed.length === 1;
    } catch {
      await db
        .update(mediaRetentionJobs)
        .set({
          status: job.attempts >= MEDIA_RETENTION_MAX_ATTEMPTS ? "failed" : "pending",
          leaseUntil: null,
          lockToken: null,
          errorCode: "STORAGE_DELETE_FAILED",
          availableAt: sql`clock_timestamp()+${Math.min(3600, 30 * 2 ** (job.attempts - 1))}*interval '1 second'`,
        })
        .where(owns(job));
      return false;
    }
  }
  return {
    summary,
    async adminSummary(actor: string | null) {
      await analyticsService(db).allowedAdmin(actor);
      return summary();
    },
    reserve,
    claim,
    process,
    async drain(remove: RetentionObjectRemover) {
      const reserved = await reserve();
      let attempted = 0,
        removed = 0;
      for (let i = 0; i < MEDIA_RETENTION_BATCH_SIZE; i++) {
        const job = await claim();
        if (job === undefined) break;
        if (job === null) continue;
        attempted++;
        if (await process(job, remove)) removed++;
      }
      return { reserved, attempted, removed };
    },
  };
}
