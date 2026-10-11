import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { profiles } from "../db/schema";
import { videoAssets } from "../db/video-schema";
import { videoProcessingJobs, videoProcessingOutputs } from "../db/video-processing-schema";
import type { PublicVideo } from "../domain/contracts";
import type { ImageStorageBackend } from "../domain/image-storage";
import { VIDEO_UPLOAD_MAX_BYTES, VIDEO_STORED_MAX_BYTES } from "../domain/video-compression";
import {
  VIDEO_JOB_LEASE_SECONDS,
  VIDEO_JOB_MAX_ATTEMPTS,
  VIDEO_JOB_MAX_PENDING,
  videoJobErrorMessage,
  type QueuedVideoUpload,
  type VideoJobErrorCode,
  type VideoJobView,
} from "../domain/video-processing";
import { uuidSchema } from "../domain/validation";
import { AppError, requireActor } from "./errors";
import type { VideoProcessingStorage, VideoSourceStore } from "./video-source-storage";

type Job = typeof videoProcessingJobs.$inferSelect;
type Output = typeof videoProcessingOutputs.$inferSelect;
export interface ClaimedVideoJob {
  job: Job;
  output: Output;
}
export interface CompressedVideo {
  bytes: Uint8Array;
  width: number;
  height: number;
  durationSeconds: number;
}
export type VideoTranscoder = (bytes: Uint8Array, signal: AbortSignal) => Promise<CompressedVideo>;
function publicVideo(asset: typeof videoAssets.$inferSelect): PublicVideo {
  return {
    id: asset.id,
    src: "/api/videos/" + asset.id,
    contentType: "video/mp4",
    byteSize: asset.byteSize,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    sortOrder: asset.sortOrder,
  };
}
function activeClaim(claim: ClaimedVideoJob) {
  return and(
    eq(videoProcessingJobs.id, claim.job.id),
    eq(videoProcessingJobs.status, "processing"),
    eq(videoProcessingJobs.lockToken, claim.output.id),
    sql`${videoProcessingJobs.leaseExpiresAt}>statement_timestamp()`,
  );
}
export function videoProcessingService(db: Database) {
  async function enqueue(
    actor: string | null,
    bytes: Uint8Array,
    store: VideoSourceStore,
    signal?: AbortSignal,
  ): Promise<QueuedVideoUpload> {
    const userId = requireActor(actor);
    if (!bytes.byteLength || bytes.byteLength > VIDEO_UPLOAD_MAX_BYTES)
      throw new AppError("VALIDATION", "영상은 50MB 이하로 올려주세요.");
    signal?.throwIfAborted();
    const id = randomUUID();
    const [job] = await db.transaction(async (tx) => {
      // Serialize the pending count across every web instance for this uploader.
      const [owner] = await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .for("update");
      if (!owner) throw new AppError("UNAUTHENTICATED", "로그인 후 이용할 수 있어요.");
      const pendingRows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(videoProcessingJobs)
        .where(
          and(
            eq(videoProcessingJobs.uploaderId, userId),
            inArray(videoProcessingJobs.status, ["queued", "processing"]),
            sql`${videoProcessingJobs.sourceExpiresAt}>statement_timestamp()`,
            sql`(${videoProcessingJobs.sourceReady} or ${videoProcessingJobs.uploadExpiresAt}>statement_timestamp())`,
          ),
        );
      if ((pendingRows[0]?.count ?? 0) >= VIDEO_JOB_MAX_PENDING)
        throw new AppError(
          "RATE_LIMITED",
          "대기 중인 영상이 많아요. 처리가 끝난 뒤 다시 올려주세요.",
        );
      return tx
        .insert(videoProcessingJobs)
        .values({
          id,
          uploaderId: userId,
          sourceObjectKey: id + ".bin",
          sourceStorageBackend: store.backend,
          sourceByteSize: bytes.byteLength,
        })
        .returning();
    });
    if (!job) throw new AppError("INTERNAL", "영상 업로드를 등록하지 못했어요.");
    try {
      await store.write(job.sourceObjectKey, bytes, signal);
      signal?.throwIfAborted();
      const [acknowledged] = await db
        .update(videoProcessingJobs)
        .set({ sourceReady: true, updatedAt: sql`statement_timestamp()` })
        .where(
          and(
            eq(videoProcessingJobs.id, id),
            eq(videoProcessingJobs.status, "queued"),
            sql`${videoProcessingJobs.uploadExpiresAt}>statement_timestamp()`,
          ),
        )
        .returning({ id: videoProcessingJobs.id });
      if (!acknowledged) throw new AppError("INTERNAL", "영상 업로드를 완료하지 못했어요.");
      return { jobId: id, status: "queued", statusUrl: "/api/videos/jobs/" + id };
    } catch (error) {
      // Retain cleanup addresses if database acknowledgement is unavailable or uncertain.
      const failed = await db
        .update(videoProcessingJobs)
        .set({
          status: "failed",
          lastErrorCode: "UPLOAD_FAILED",
          updatedAt: sql`statement_timestamp()`,
        })
        .where(
          and(
            eq(videoProcessingJobs.id, id),
            eq(videoProcessingJobs.status, "queued"),
            eq(videoProcessingJobs.sourceReady, false),
          ),
        )
        .returning({ id: videoProcessingJobs.id })
        .catch(() => []);
      if (!failed.length) {
        const [acknowledged] = await db
          .select({
            sourceReady: videoProcessingJobs.sourceReady,
            status: videoProcessingJobs.status,
          })
          .from(videoProcessingJobs)
          .where(eq(videoProcessingJobs.id, id))
          .catch(() => []);
        if (acknowledged?.sourceReady && acknowledged.status !== "failed")
          return { jobId: id, status: "queued", statusUrl: "/api/videos/jobs/" + id };
        if (acknowledged?.status !== "failed") throw error;
        // A slow write can finish after reservation expiry cleanup. Reopen its cleanup address.
        await db
          .update(videoProcessingJobs)
          .set({ sourceRemovedAt: null, sourceCleanupAt: sql`statement_timestamp()` })
          .where(and(eq(videoProcessingJobs.id, id), eq(videoProcessingJobs.status, "failed")));
      }
      try {
        await store.remove(job.sourceObjectKey);
        await db
          .update(videoProcessingJobs)
          .set({ sourceRemovedAt: sql`statement_timestamp()` })
          .where(and(eq(videoProcessingJobs.id, id), eq(videoProcessingJobs.status, "failed")));
      } catch {
        /* The worker retries cleanup using the durable reservation. */
      }
      throw error;
    }
  }
  async function view(id: string, actor: string | null): Promise<VideoJobView> {
    const userId = requireActor(actor);
    const [row] = await db
      .select({ job: videoProcessingJobs, asset: videoAssets })
      .from(videoProcessingJobs)
      .leftJoin(
        videoAssets,
        and(
          eq(videoAssets.id, videoProcessingJobs.resultAssetId),
          eq(videoAssets.uploaderId, videoProcessingJobs.uploaderId),
          eq(videoAssets.status, "ready"),
        ),
      )
      .where(
        and(
          eq(videoProcessingJobs.id, uuidSchema.parse(id)),
          eq(videoProcessingJobs.uploaderId, userId),
        ),
      );
    if (!row || (row.job.status === "ready" && !row.asset))
      throw new AppError("NOT_FOUND", "영상 처리 내역을 찾을 수 없어요.");
    return {
      jobId: row.job.id,
      status: row.job.status,
      video: row.job.status === "ready" && row.asset ? publicVideo(row.asset) : null,
      error: row.job.status === "failed" ? videoJobErrorMessage(row.job.lastErrorCode) : null,
    };
  }
  async function claim(backend: ImageStorageBackend): Promise<ClaimedVideoJob | null> {
    return db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(videoProcessingJobs)
        .where(
          and(
            eq(videoProcessingJobs.sourceReady, true),
            sql`${videoProcessingJobs.sourceExpiresAt}>statement_timestamp()`,
            sql`${videoProcessingJobs.attempts}<${VIDEO_JOB_MAX_ATTEMPTS}`,
            or(
              and(
                eq(videoProcessingJobs.status, "queued"),
                sql`${videoProcessingJobs.availableAt}<=statement_timestamp()`,
              ),
              and(
                eq(videoProcessingJobs.status, "processing"),
                sql`${videoProcessingJobs.leaseExpiresAt}<=statement_timestamp()`,
              ),
            ),
          ),
        )
        .orderBy(
          asc(videoProcessingJobs.availableAt),
          asc(videoProcessingJobs.createdAt),
          asc(videoProcessingJobs.id),
        )
        .limit(1)
        .for("update", { skipLocked: true });
      if (!job) return null;
      if (job.lockToken)
        await tx
          .update(videoProcessingOutputs)
          .set({ discardedAt: sql`statement_timestamp()` })
          .where(
            and(
              eq(videoProcessingOutputs.id, job.lockToken),
              isNull(videoProcessingOutputs.publishedAt),
            ),
          );
      const token = randomUUID();
      const [claimed] = await tx
        .update(videoProcessingJobs)
        .set({
          status: "processing",
          attempts: sql`${videoProcessingJobs.attempts}+1`,
          lockToken: token,
          leaseExpiresAt: sql`statement_timestamp()+${VIDEO_JOB_LEASE_SECONDS}*interval '1 second'`,
          lastErrorCode: null,
          updatedAt: sql`statement_timestamp()`,
        })
        .where(eq(videoProcessingJobs.id, job.id))
        .returning();
      const [output] = await tx
        .insert(videoProcessingOutputs)
        .values({ id: token, jobId: job.id, objectKey: token + ".mp4", storageBackend: backend })
        .returning();
      return { job: claimed!, output: output! };
    });
  }
  async function current(claimed: ClaimedVideoJob): Promise<boolean> {
    const [row] = await db
      .select({ id: videoProcessingJobs.id })
      .from(videoProcessingJobs)
      .where(activeClaim(claimed));
    return !!row;
  }
  async function complete(claimed: ClaimedVideoJob, video: CompressedVideo): Promise<boolean> {
    if (
      !video.bytes.byteLength ||
      video.bytes.byteLength > VIDEO_STORED_MAX_BYTES ||
      !Number.isSafeInteger(video.width) ||
      !Number.isSafeInteger(video.height) ||
      video.width < 1 ||
      video.width > 1280 ||
      video.height < 1 ||
      video.height > 720 ||
      !Number.isFinite(video.durationSeconds) ||
      video.durationSeconds <= 0 ||
      video.durationSeconds > 180
    )
      throw new AppError("VALIDATION", "영상 압축 결과를 확인하지 못했어요.");
    return db.transaction(async (tx) => {
      const [job] = await tx
        .select({ id: videoProcessingJobs.id })
        .from(videoProcessingJobs)
        .where(activeClaim(claimed))
        .for("update");
      if (!job) return false;
      const [output] = await tx
        .select()
        .from(videoProcessingOutputs)
        .where(
          and(
            eq(videoProcessingOutputs.id, claimed.output.id),
            eq(videoProcessingOutputs.jobId, claimed.job.id),
            isNull(videoProcessingOutputs.discardedAt),
            isNull(videoProcessingOutputs.publishedAt),
          ),
        )
        .for("update");
      if (!output) return false;
      await tx.insert(videoAssets).values({
        id: output.id,
        uploaderId: claimed.job.uploaderId,
        objectKey: output.objectKey,
        storageBackend: output.storageBackend,
        contentType: "video/mp4",
        byteSize: video.bytes.byteLength,
        width: video.width,
        height: video.height,
        durationSeconds: video.durationSeconds,
        status: "ready",
      });
      await tx
        .update(videoProcessingOutputs)
        .set({ publishedAt: sql`statement_timestamp()` })
        .where(eq(videoProcessingOutputs.id, output.id));
      await tx
        .update(videoProcessingJobs)
        .set({
          status: "ready",
          resultAssetId: output.id,
          leaseExpiresAt: null,
          lockToken: null,
          lastErrorCode: null,
          updatedAt: sql`statement_timestamp()`,
        })
        .where(eq(videoProcessingJobs.id, claimed.job.id));
      return true;
    });
  }
  async function fail(claimed: ClaimedVideoJob, error: unknown, interrupted = false) {
    const permanent = error instanceof AppError && error.code === "VALIDATION";
    const retry = interrupted || (!permanent && claimed.job.attempts < VIDEO_JOB_MAX_ATTEMPTS);
    const code: VideoJobErrorCode = permanent ? "INVALID_VIDEO" : "PROCESSING_FAILED";
    return db.transaction(async (tx) => {
      const [job] = await tx
        .update(videoProcessingJobs)
        .set({
          status: retry ? "queued" : "failed",
          attempts: interrupted
            ? sql`greatest(${videoProcessingJobs.attempts}-1,0)`
            : claimed.job.attempts,
          leaseExpiresAt: null,
          lockToken: null,
          lastErrorCode: retry ? null : code,
          availableAt: sql`statement_timestamp()+${interrupted ? 0 : 15 * 2 ** (claimed.job.attempts - 1)}*interval '1 second'`,
          updatedAt: sql`statement_timestamp()`,
        })
        .where(activeClaim(claimed))
        .returning({ id: videoProcessingJobs.id });
      if (!job) return false;
      await tx
        .update(videoProcessingOutputs)
        .set({ discardedAt: sql`statement_timestamp()` })
        .where(
          and(
            eq(videoProcessingOutputs.id, claimed.output.id),
            isNull(videoProcessingOutputs.publishedAt),
          ),
        );
      return true;
    });
  }
  async function removeOutput(output: Output, storage: VideoProcessingStorage) {
    // Mark discard before removal. A concurrent finalizer must see the discard and roll back.
    const [discarded] = await db
      .update(videoProcessingOutputs)
      .set({
        discardedAt: sql`coalesce(${videoProcessingOutputs.discardedAt},statement_timestamp())`,
      })
      .where(
        and(eq(videoProcessingOutputs.id, output.id), isNull(videoProcessingOutputs.publishedAt)),
      )
      .returning();
    if (!discarded) return;
    try {
      await storage.derivatives(discarded.storageBackend).remove("video", discarded.objectKey);
      await db
        .update(videoProcessingOutputs)
        .set({ removedAt: sql`statement_timestamp()` })
        .where(
          and(
            eq(videoProcessingOutputs.id, discarded.id),
            isNull(videoProcessingOutputs.publishedAt),
          ),
        );
    } catch {
      await db
        .update(videoProcessingOutputs)
        .set({ cleanupAt: sql`statement_timestamp()+interval '1 minute'` })
        .where(eq(videoProcessingOutputs.id, discarded.id));
    }
  }
  async function cleanup(storage: VideoProcessingStorage, limit = 10) {
    const count = Math.min(20, Math.max(1, Math.floor(limit)));
    await db
      .update(videoProcessingJobs)
      .set({
        status: "failed",
        leaseExpiresAt: null,
        lockToken: null,
        lastErrorCode: "EXPIRED",
        updatedAt: sql`statement_timestamp()`,
      })
      .where(
        and(
          inArray(videoProcessingJobs.status, ["queued", "processing"]),
          or(
            sql`${videoProcessingJobs.sourceExpiresAt}<=statement_timestamp()`,
            and(
              eq(videoProcessingJobs.status, "queued"),
              eq(videoProcessingJobs.sourceReady, false),
              sql`${videoProcessingJobs.uploadExpiresAt}<=statement_timestamp()`,
            ),
            and(
              eq(videoProcessingJobs.status, "processing"),
              sql`${videoProcessingJobs.leaseExpiresAt}<=statement_timestamp()`,
              sql`${videoProcessingJobs.attempts}>=${VIDEO_JOB_MAX_ATTEMPTS}`,
            ),
          ),
        ),
      );
    const sources = await db
      .select()
      .from(videoProcessingJobs)
      .where(
        and(
          inArray(videoProcessingJobs.status, ["ready", "failed"]),
          isNull(videoProcessingJobs.sourceRemovedAt),
          sql`${videoProcessingJobs.sourceCleanupAt}<=statement_timestamp()`,
        ),
      )
      .orderBy(asc(videoProcessingJobs.sourceCleanupAt), asc(videoProcessingJobs.createdAt))
      .limit(count);
    for (const job of sources) {
      try {
        await storage.sources(job.sourceStorageBackend).remove(job.sourceObjectKey);
        await db
          .update(videoProcessingJobs)
          .set({ sourceRemovedAt: sql`statement_timestamp()` })
          .where(
            and(
              eq(videoProcessingJobs.id, job.id),
              inArray(videoProcessingJobs.status, ["ready", "failed"]),
            ),
          );
      } catch {
        await db
          .update(videoProcessingJobs)
          .set({ sourceCleanupAt: sql`statement_timestamp()+interval '1 minute'` })
          .where(eq(videoProcessingJobs.id, job.id));
      }
    }
    const outputs = await db
      .select({ output: videoProcessingOutputs })
      .from(videoProcessingOutputs)
      .innerJoin(videoProcessingJobs, eq(videoProcessingJobs.id, videoProcessingOutputs.jobId))
      .where(
        and(
          isNull(videoProcessingOutputs.publishedAt),
          isNull(videoProcessingOutputs.removedAt),
          sql`${videoProcessingOutputs.cleanupAt}<=statement_timestamp()`,
          or(
            sql`${videoProcessingJobs.status}<>'processing'`,
            sql`${videoProcessingJobs.lockToken}<>${videoProcessingOutputs.id}`,
            sql`${videoProcessingJobs.leaseExpiresAt}<=statement_timestamp()`,
          ),
        ),
      )
      .orderBy(asc(videoProcessingOutputs.cleanupAt), asc(videoProcessingOutputs.createdAt))
      .limit(count);
    for (const { output } of outputs) await removeOutput(output, storage);
    return { sources: sources.length, outputs: outputs.length };
  }
  return { enqueue, view, claim, current, complete, fail, removeOutput, cleanup };
}

/** Storage and transcoding are injected so neither web imports nor tests load FFmpeg. */
export function videoWorker(
  db: Database,
  options: {
    storage: VideoProcessingStorage;
    transcode: VideoTranscoder;
    derivativeBackend: ImageStorageBackend;
  },
) {
  const service = videoProcessingService(db);
  async function drain(signal?: AbortSignal) {
    await service.cleanup(options.storage);
    if (signal?.aborted) return { processed: 0 };
    const claimed = await service.claim(options.derivativeBackend);
    if (!claimed) return { processed: 0 };
    const timeout = AbortSignal.timeout(240000);
    const activeSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let ready = false;
    try {
      const source = await options.storage
        .sources(claimed.job.sourceStorageBackend)
        .read(claimed.job.sourceObjectKey, activeSignal);
      if (source.byteLength !== claimed.job.sourceByteSize)
        throw new AppError("VALIDATION", "영상 원본을 확인하지 못했어요.");
      const result = await options.transcode(source, activeSignal);
      activeSignal.throwIfAborted();
      if (await service.current(claimed)) {
        await options.storage
          .derivatives(claimed.output.storageBackend)
          .write("video", claimed.output.objectKey, result.bytes);
        activeSignal.throwIfAborted();
        ready = await service.complete(claimed, result);
      }
    } catch (error) {
      await service.fail(
        claimed,
        timeout.aborted && !signal?.aborted
          ? new AppError("INTERNAL", "영상 처리 시간이 지났어요.")
          : error,
        !!signal?.aborted,
      );
    } finally {
      if (!ready) await service.removeOutput(claimed.output, options.storage);
      await service.cleanup(options.storage);
    }
    return { processed: 1 };
  }
  return { drain };
}
