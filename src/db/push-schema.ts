import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { comments, posts, profiles, sliper } from "./schema";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// Browser endpoints and keys stay in the private server-only schema. Never return
// them from profile, inbox, room or public community DTOs.
export const pushPreferences = sliper
  .table("push_preferences", {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => profiles.id, { onDelete: "cascade" }),
    comments: boolean("comments").notNull().default(true),
    announcements: boolean("announcements").notNull().default(true),
    participation: boolean("participation").notNull().default(true),
    subscriptions: boolean("subscriptions").notNull().default(true),
    reminders: boolean("reminders").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  })
  .enableRLS();

export const pushSubscriptions = sliper
  .table(
    "push_subscriptions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      endpoint: text("endpoint").notNull().unique(),
      p256dh: varchar("p256dh", { length: 128 }).notNull(),
      auth: varchar("auth", { length: 128 }).notNull(),
      vapidPublicKey: varchar("vapid_public_key", { length: 100 }).notNull(),
      expirationTime: timestamp("expiration_time", { withTimezone: true }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      unique("push_subscriptions_id_user_unique").on(t.id, t.userId),
      index("push_subscriptions_user_idx").on(t.userId, t.createdAt.desc()),
      check(
        "push_subscriptions_endpoint",
        sql`char_length(${t.endpoint}) between 12 and 2048 and ${t.endpoint} ~ '^https://' and ${t.endpoint} !~ '[[:space:]]'`,
      ),
      check(
        "push_subscriptions_keys",
        sql`${t.p256dh} ~ '^[A-Za-z0-9_-]{87}=?$' and ${t.auth} ~ '^[A-Za-z0-9_-]{22}(==)?$' and ${t.vapidPublicKey} ~ '^[A-Za-z0-9_-]{87}=?$'`,
      ),
    ],
  )
  .enableRLS();

// This is a transactional outbox. Workers lease rows with SKIP LOCKED and keep
// PostgreSQL as the durable source; a browser push service is only delivery.
export const pushDeliveries = sliper
  .table(
    "push_deliveries",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      subscriptionId: uuid("subscription_id").notNull(),
      recipientId: uuid("recipient_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      dedupeKey: varchar("dedupe_key", { length: 220 }).notNull(),
      kind: varchar("kind", { length: 24 }).notNull(),
      postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
      commentId: uuid("comment_id").references(() => comments.id, { onDelete: "cascade" }),
      title: varchar("title", { length: 120 }).notNull(),
      body: varchar("body", { length: 300 }).notNull(),
      url: varchar("url", { length: 512 }).notNull(),
      status: varchar("status", { length: 16 }).notNull().default("pending"),
      attempts: smallint("attempts").notNull().default(0),
      availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
      lockedAt: timestamp("locked_at", { withTimezone: true }),
      lockToken: uuid("lock_token"),
      expiresAt: timestamp("expires_at", { withTimezone: true })
        .notNull()
        .default(sql`now() + interval '24 hours'`),
      sentAt: timestamp("sent_at", { withTimezone: true }),
      lastErrorCode: varchar("last_error_code", { length: 64 }),
      createdAt: createdAt(),
    },
    (t) => [
      foreignKey({
        name: "push_deliveries_subscription_owner_fk",
        columns: [t.subscriptionId, t.recipientId],
        foreignColumns: [pushSubscriptions.id, pushSubscriptions.userId],
      }).onDelete("cascade"),
      unique("push_deliveries_subscription_dedupe_unique").on(t.subscriptionId, t.dedupeKey),
      index("push_deliveries_pending_idx")
        .on(t.availableAt, t.createdAt, t.id)
        .where(sql`${t.status} = 'pending'`),
      index("push_deliveries_processing_idx")
        .on(t.lockedAt, t.id)
        .where(sql`${t.status} = 'processing'`),
      index("push_deliveries_recipient_idx").on(t.recipientId, t.createdAt.desc()),
      check("push_deliveries_dedupe", sql`char_length(btrim(${t.dedupeKey})) between 1 and 220`),
      check(
        "push_deliveries_kind",
        sql`${t.kind} in ('comment','announcement','participation','subscription','reminder','test')`,
      ),
      check(
        "push_deliveries_source",
        sql`(${t.kind} = 'comment' and ${t.postId} is not null and ${t.commentId} is not null) or (${t.kind} in ('announcement','participation','subscription','reminder') and ${t.postId} is not null and ${t.commentId} is null) or (${t.kind} = 'test' and ${t.commentId} is null)`,
      ),
      check(
        "push_deliveries_content",
        sql`char_length(btrim(${t.title})) between 1 and 120 and char_length(${t.body}) between 1 and 300`,
      ),
      check(
        "push_deliveries_local_url",
        sql`char_length(${t.url}) between 1 and 512 and left(${t.url},1)='/' and left(${t.url},2)<>'//' and strpos(${t.url},chr(92))=0 and ${t.url} !~ '[[:cntrl:]]'`,
      ),
      check(
        "push_deliveries_status",
        sql`${t.status} in ('pending','processing','sent','failed','cancelled')`,
      ),
      check("push_deliveries_attempts", sql`${t.attempts} between 0 and 100`),
      check(
        "push_deliveries_lease",
        sql`(${t.status} = 'processing' and ${t.lockedAt} is not null and ${t.lockToken} is not null) or (${t.status} <> 'processing' and ${t.lockedAt} is null and ${t.lockToken} is null)`,
      ),
      check(
        "push_deliveries_sent_time",
        sql`(${t.status} = 'sent' and ${t.sentAt} is not null) or (${t.status} <> 'sent' and ${t.sentAt} is null)`,
      ),
      check("push_deliveries_expiration", sql`${t.expiresAt} > ${t.createdAt}`),
    ],
  )
  .enableRLS();
