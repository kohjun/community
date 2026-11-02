import { sql } from "drizzle-orm";
import { check, index, integer, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { sliper } from "./schema";
import type { ImageStorageBackend, ImageStorageKind } from "../domain/image-storage";
export const objectCleanupJobs = sliper
  .table(
    "object_cleanup_jobs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      objectKey: varchar("object_key", { length: 64 }).notNull(),
      storageBackend: varchar("storage_backend", { length: 16 })
        .$type<ImageStorageBackend>()
        .notNull(),
      kind: varchar("kind", { length: 12 }).$type<ImageStorageKind>().notNull(),
      reason: varchar("reason", { length: 24 }).notNull(),
      status: varchar("status", { length: 12 }).notNull().default("pending"),
      attempts: integer("attempts").notNull().default(0),
      availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
      leaseUntil: timestamp("lease_until", { withTimezone: true }),
      lockToken: uuid("lock_token"),
      errorCode: varchar("error_code", { length: 32 }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      unique("cleanup_object_once").on(t.storageBackend, t.kind, t.objectKey),
      index("cleanup_ready_idx").on(t.status, t.availableAt, t.id),
      check("cleanup_backend", sql`${t.storageBackend} in ('local','supabase')`),
      check("cleanup_kind", sql`${t.kind} in ('post','profile','video')`),
      check(
        "cleanup_reason",
        sql`${t.reason} in ('profile-replaced','profile-cleared','account-closed','upload-rollback')`,
      ),
      check("cleanup_status", sql`${t.status} in ('pending','processing','failed')`),
      check("cleanup_attempts", sql`${t.attempts} between 0 and 8`),
      check(
        "cleanup_key",
        sql`${t.objectKey} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp|gif|mp4)$' and ((${t.kind}='video')=(${t.objectKey} like '%.mp4'))`,
      ),
      check(
        "cleanup_lease",
        sql`(${t.status}='processing')=(${t.lockToken} is not null and ${t.leaseUntil} is not null) and (${t.status}='processing' or (${t.lockToken} is null and ${t.leaseUntil} is null))`,
      ),
      check("cleanup_error", sql`${t.errorCode} is null or ${t.errorCode}='STORAGE_DELETE_FAILED'`),
    ],
  )
  .enableRLS();
