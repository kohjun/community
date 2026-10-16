import { sql } from "drizzle-orm";
import { check, index, integer, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { sliper } from "./schema";
import type { ImageStorageBackend } from "../domain/image-storage";
import type { RetentionAssetKind } from "../domain/media-retention";
export const mediaRetentionJobs = sliper
  .table(
    "media_retention_jobs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      assetKind: varchar("asset_kind", { length: 8 }).$type<RetentionAssetKind>().notNull(),
      assetId: uuid("asset_id").notNull(),
      objectKey: varchar("object_key", { length: 64 }).notNull(),
      storageBackend: varchar("storage_backend", { length: 16 })
        .$type<ImageStorageBackend>()
        .notNull(),
      policyVersion: varchar("policy_version", { length: 24 }).notNull().default("unattached-v1"),
      status: varchar("status", { length: 16 }).notNull().default("pending"),
      attempts: integer("attempts").notNull().default(0),
      availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
      leaseUntil: timestamp("lease_until", { withTimezone: true }),
      lockToken: uuid("lock_token"),
      errorCode: varchar("error_code", { length: 32 }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      removedAt: timestamp("removed_at", { withTimezone: true }),
    },
    (t) => [
      unique("retention_asset_once").on(t.assetKind, t.assetId),
      index("retention_pending_idx").on(t.status, t.availableAt, t.id),
      check("retention_asset_kind", sql`${t.assetKind} in ('image','video')`),
      check("retention_storage", sql`${t.storageBackend} in ('local','supabase')`),
      check(
        "retention_object",
        sql`(${t.assetKind}='video' and ${t.objectKey}=${t.assetId}::text||'.mp4') or (${t.assetKind}='image' and ${t.objectKey} ~ ('^'||${t.assetId}::text||'[.](jpg|jpeg|png|webp|gif)$'))`,
      ),
      check("retention_policy", sql`${t.policyVersion}='unattached-v1'`),
      check("retention_attempts", sql`${t.attempts} between 0 and 100`),
      check("retention_status", sql`${t.status} in ('pending','processing','failed','removed')`),
      check(
        "retention_lease",
        sql`(${t.status}='processing')=(${t.leaseUntil} is not null and ${t.lockToken} is not null) and (${t.status}='processing' or (${t.leaseUntil} is null and ${t.lockToken} is null))`,
      ),
      check("retention_completed", sql`(${t.status}='removed')=(${t.removedAt} is not null)`),
      check(
        "retention_error",
        sql`${t.errorCode} is null or ${t.errorCode} in ('STORAGE_DELETE_FAILED','SOURCE_NOT_ELIGIBLE')`,
      ),
    ],
  )
  .enableRLS();
