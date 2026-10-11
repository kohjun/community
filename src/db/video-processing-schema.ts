import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { profiles, sliper } from "./schema";
import type { ImageStorageBackend } from "../domain/image-storage";
import type { VideoJobErrorCode } from "../domain/video-processing";

export const videoJobStatusEnum = sliper.enum("video_job_status", [
  "queued",
  "processing",
  "ready",
  "failed",
]);
export const videoProcessingJobs = sliper
  .table(
    "video_processing_jobs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      uploaderId: uuid("uploader_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "restrict" }),
      sourceObjectKey: varchar("source_object_key", { length: 40 }).notNull().unique(),
      sourceStorageBackend: varchar("source_storage_backend", { length: 16 })
        .$type<ImageStorageBackend>()
        .notNull(),
      sourceByteSize: integer("source_byte_size").notNull(),
      sourceReady: boolean("source_ready").notNull().default(false),
      sourceRemovedAt: timestamp("source_removed_at", { withTimezone: true }),
      sourceCleanupAt: timestamp("source_cleanup_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
      uploadExpiresAt: timestamp("upload_expires_at", { withTimezone: true })
        .notNull()
        .default(sql`now()+interval '15 minutes'`),
      sourceExpiresAt: timestamp("source_expires_at", { withTimezone: true })
        .notNull()
        .default(sql`now()+interval '24 hours'`),
      status: videoJobStatusEnum("status").notNull().default("queued"),
      attempts: integer("attempts").notNull().default(0),
      availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
      leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
      lockToken: uuid("lock_token"),
      resultAssetId: uuid("result_asset_id"),
      lastErrorCode: varchar("last_error_code", { length: 32 }).$type<VideoJobErrorCode>(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      unique("video_processing_jobs_result_unique").on(t.resultAssetId),
      index("video_processing_jobs_queue_idx").on(t.status, t.availableAt, t.createdAt),
      index("video_processing_jobs_uploader_idx").on(t.uploaderId, t.status),
      index("video_processing_jobs_source_cleanup_idx").on(t.sourceRemovedAt, t.sourceCleanupAt),
      check("video_processing_jobs_source_key", sql`${t.sourceObjectKey}=${t.id}::text||'.bin'`),
      check(
        "video_processing_jobs_source_backend",
        sql`${t.sourceStorageBackend} in ('local','supabase')`,
      ),
      check("video_processing_jobs_source_size", sql`${t.sourceByteSize} between 1 and 52428800`),
      check("video_processing_jobs_attempts", sql`${t.attempts} between 0 and 3`),
      check(
        "video_processing_jobs_lease",
        sql`(${t.status}='processing')=(${t.lockToken} is not null and ${t.leaseExpiresAt} is not null) and (${t.status}='processing' or (${t.lockToken} is null and ${t.leaseExpiresAt} is null))`,
      ),
      check(
        "video_processing_jobs_result",
        sql`(${t.status}='ready')=(${t.resultAssetId} is not null)`,
      ),
      check(
        "video_processing_jobs_ready_source",
        sql`${t.status} not in ('processing','ready') or ${t.sourceReady}`,
      ),
      check(
        "video_processing_jobs_source_removed",
        sql`${t.sourceRemovedAt} is null or ${t.status} in ('ready','failed')`,
      ),
      check(
        "video_processing_jobs_expiry",
        sql`${t.uploadExpiresAt}>${t.createdAt} and ${t.sourceExpiresAt}>=${t.uploadExpiresAt}`,
      ),
      check(
        "video_processing_jobs_error",
        sql`${t.lastErrorCode} is null or ${t.lastErrorCode} in ('UPLOAD_FAILED','INVALID_VIDEO','PROCESSING_FAILED','EXPIRED')`,
      ),
    ],
  )
  .enableRLS();

// Record an attempt before its object write so worker crashes leave a cleanup address.
export const videoProcessingOutputs = sliper
  .table(
    "video_processing_outputs",
    {
      id: uuid("id").primaryKey(),
      jobId: uuid("job_id")
        .notNull()
        .references(() => videoProcessingJobs.id, { onDelete: "restrict" }),
      objectKey: varchar("object_key", { length: 40 }).notNull().unique(),
      storageBackend: varchar("storage_backend", { length: 16 })
        .$type<ImageStorageBackend>()
        .notNull(),
      publishedAt: timestamp("published_at", { withTimezone: true }),
      discardedAt: timestamp("discarded_at", { withTimezone: true }),
      removedAt: timestamp("removed_at", { withTimezone: true }),
      cleanupAt: timestamp("cleanup_at", { withTimezone: true })
        .notNull()
        .default(sql`now()+interval '1 hour'`),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("video_processing_outputs_job_idx").on(t.jobId),
      index("video_processing_outputs_cleanup_idx").on(t.publishedAt, t.removedAt, t.cleanupAt),
      check("video_processing_outputs_key", sql`${t.objectKey}=${t.id}::text||'.mp4'`),
      check("video_processing_outputs_backend", sql`${t.storageBackend} in ('local','supabase')`),
      check(
        "video_processing_outputs_published",
        sql`${t.publishedAt} is null or (${t.discardedAt} is null and ${t.removedAt} is null)`,
      ),
      check(
        "video_processing_outputs_removed",
        sql`${t.removedAt} is null or ${t.discardedAt} is not null`,
      ),
    ],
  )
  .enableRLS();
