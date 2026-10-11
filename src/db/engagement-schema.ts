import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  primaryKey,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { categories, posts, profiles, sliper } from "./schema";
import type { InboxKind } from "../domain/engagement";
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const categorySubscriptions = sliper
  .table(
    "category_subscriptions",
    {
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      categorySlug: varchar("category_slug", { length: 24 })
        .notNull()
        .$type<typeof categories.$inferSelect.slug>(),
      createdAt: created(),
    },
    (t) => [
      primaryKey({ columns: [t.userId, t.categorySlug] }),
      index("category_subscription_fanout_idx").on(t.categorySlug, t.userId),
      check(
        "category_subscription_slug",
        sql`${t.categorySlug} in ('travel','dating','race','mind-games','survival','music','sports','cooking','party','knowledge','lab','crew')`,
      ),
    ],
  )
  .enableRLS();
export const hostSubscriptions = sliper
  .table(
    "host_subscriptions",
    {
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      hostId: uuid("host_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      createdAt: created(),
    },
    (t) => [
      primaryKey({ columns: [t.userId, t.hostId] }),
      index("host_subscription_fanout_idx").on(t.hostId, t.userId),
      check("host_subscription_not_self", sql`${t.userId}<>${t.hostId}`),
    ],
  )
  .enableRLS();
export const inboxItems = sliper
  .table(
    "inbox_items",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      recipientId: uuid("recipient_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      dedupeKey: varchar("dedupe_key", { length: 220 }).notNull(),
      kind: varchar("kind", { length: 24 }).notNull().$type<InboxKind>(),
      postId: uuid("post_id")
        .notNull()
        .references(() => posts.id, { onDelete: "cascade" }),
      sourceId: uuid("source_id"),
      actorId: uuid("actor_id").references(() => profiles.id, { onDelete: "set null" }),
      title: varchar("title", { length: 120 }).notNull(),
      body: varchar("body", { length: 500 }).notNull().default(""),
      url: varchar("url", { length: 2048 }).notNull(),
      createdAt: created(),
      readAt: timestamp("read_at", { withTimezone: true }),
    },
    (t) => [
      unique("inbox_recipient_dedupe").on(t.recipientId, t.dedupeKey),
      index("inbox_recipient_page_idx").on(t.recipientId, t.createdAt.desc(), t.id.desc()),
      index("inbox_unread_idx")
        .on(t.recipientId, t.createdAt.desc())
        .where(sql`${t.readAt} is null`),
      index("inbox_source_idx").on(t.kind, t.sourceId, t.recipientId),
      check(
        "inbox_kind",
        sql`${t.kind} in ('comments','announcements','participation','subscriptions','reminders','credits','records')`,
      ),
      check("inbox_internal_url", sql`${t.url} ~ '^/[^/]' and ${t.url} !~ '[[:cntrl:]]'`),
    ],
  )
  .enableRLS();
export const engagementJobs = sliper
  .table(
    "engagement_jobs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      kind: varchar("kind", { length: 24 })
        .notNull()
        .$type<"comment" | "announcement" | "participation" | "event-change" | "subscription">(),
      sourceKey: varchar("source_key", { length: 220 }).notNull().unique(),
      postId: uuid("post_id")
        .notNull()
        .references(() => posts.id, { onDelete: "cascade" }),
      sourceId: uuid("source_id").notNull(),
      payload: jsonb("payload")
        .$type<{ recipientId?: string; status?: string }>()
        .notNull()
        .default(sql`'{}'::jsonb`),
      createdAt: created(),
      availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
      completedAt: timestamp("completed_at", { withTimezone: true }),
      leaseUntil: timestamp("lease_until", { withTimezone: true }),
      attempts: integer("attempts").notNull().default(0),
      lastError: varchar("last_error", { length: 100 }),
      recipientCursor: uuid("recipient_cursor"),
    },
    (t) => [
      index("engagement_due_jobs_idx")
        .on(t.availableAt, t.createdAt, t.id)
        .where(sql`${t.completedAt} is null`),
      check(
        "engagement_job_kind",
        sql`${t.kind} in ('comment','announcement','participation','event-change','subscription')`,
      ),
      check("engagement_job_attempts", sql`${t.attempts} between 0 and 100`),
      check("engagement_job_payload", sql`jsonb_typeof(${t.payload})='object'`),
    ],
  )
  .enableRLS();
