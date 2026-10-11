import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  integer,
  smallint,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { posts, profiles, sliper, uploadStatusEnum, eventRecords } from "./schema";
import type { ImageStorageBackend } from "../domain/image-storage";

// Original videos are discarded after transcoding. Only the bounded MP4 derivative is stored.
export const videoAssets = sliper
  .table(
    "video_assets",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      uploaderId: uuid("uploader_id").references(() => profiles.id, { onDelete: "set null" }),
      postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
      recordOriginPostId: uuid("record_origin_post_id").references(() => eventRecords.postId, {
        onDelete: "restrict",
      }),
      recordPostId: uuid("record_post_id").references(() => eventRecords.postId, {
        onDelete: "restrict",
      }),
      objectKey: varchar("object_key", { length: 40 }).notNull().unique(),
      storageBackend: varchar("storage_backend", { length: 16 })
        .$type<ImageStorageBackend>()
        .notNull()
        .default("local"),
      contentType: varchar("content_type", { length: 32 })
        .$type<"video/mp4">()
        .notNull()
        .default("video/mp4"),
      byteSize: integer("byte_size").notNull(),
      width: integer("width").notNull(),
      height: integer("height").notNull(),
      durationSeconds: doublePrecision("duration_seconds").notNull(),
      status: uploadStatusEnum("status").notNull().default("pending"),
      sortOrder: smallint("sort_order").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      unique("video_assets_post_order_unique").on(t.postId, t.sortOrder),
      unique("video_assets_record_order_unique").on(t.recordPostId, t.sortOrder),
      check("video_single_parent", sql`num_nonnulls(${t.postId}, ${t.recordPostId}) <= 1`),
      index("video_assets_uploader_idx").on(t.uploaderId),
      check("video_assets_object_key", sql`${t.objectKey} = ${t.id}::text || '.mp4'`),
      check("video_assets_storage_backend", sql`${t.storageBackend} in ('local','supabase')`),
      check("video_assets_content_type", sql`${t.contentType} = 'video/mp4'`),
      check("video_assets_size_range", sql`${t.byteSize} between 1 and 26214400`),
      check(
        "video_assets_dimensions",
        sql`${t.width} between 1 and 1920 and ${t.height} between 1 and 1920`,
      ),
      check("video_assets_duration", sql`${t.durationSeconds} > 0 and ${t.durationSeconds} <= 180`),
      check("video_assets_order_range", sql`${t.sortOrder} between 0 and 2`),
      check(
        "video_assets_attachment_ready",
        sql`(${t.postId} is null and ${t.recordPostId} is null) or ${t.status} = 'ready'`,
      ),
    ],
  )
  .enableRLS();
