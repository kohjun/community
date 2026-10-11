import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { CATEGORY_SLUGS } from "../domain/categories";
import {
  LIGHTNING_CATEGORY_SLUGS,
  type LightningCategorySlug,
} from "../domain/lightning-categories";
import type { DiscussionType } from "../domain/discussions";
import type { PostDocument } from "../domain/post-document";
import type { EventRecordSnapshot } from "../domain/records";
import type { ImageStorageBackend } from "../domain/image-storage";

// Only the trusted Next.js server accesses this schema. Never expose it through
// Supabase's Data API. Public responses must use explicit DTO projections.
export const sliper = pgSchema("sliper");
export const categorySlugEnum = sliper.enum("category_slug", CATEGORY_SLUGS);
export const contentStatusEnum = sliper.enum("content_status", ["published", "deleted"]);
export const notificationKindEnum = sliper.enum("notification_kind", [
  "post_comment",
  "comment_reply",
]);
export const uploadStatusEnum = sliper.enum("upload_status", ["pending", "ready"]);
export const postKindEnum = sliper.enum("post_kind", ["모집", "후기", "이야기", "투표"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const profiles = sliper
  .table(
    "profiles",
    {
      id: uuid("id")
        .primaryKey()
        .references(() => authUsers.id, { onDelete: "cascade" }),
      // Public identity differs from the authentication subject.
      publicId: uuid("public_id").notNull().defaultRandom().unique(),
      nickname: varchar("nickname", { length: 24 }).notNull(),
      analyticsExcluded: boolean("analytics_excluded").notNull().default(false),
      // Private account information: include only in the member's own profile DTO.
      phoneNumber: varchar("phone_number", { length: 20 }),
      phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
      profileCompletedAt: timestamp("profile_completed_at", { withTimezone: true }),
      onboardingConsentAt: timestamp("onboarding_consent_at", { withTimezone: true }),
      ageBand: varchar("age_band", { length: 20 }),
      gender: varchar("gender", { length: 20 }),
      bio: varchar("bio", { length: 300 }).notNull().default(""),
      region: varchar("region", { length: 80 }).notNull().default(""),
      avatar: varchar("avatar", { length: 16 }).notNull().default("spark"),
      interests: text("interests")
        .array()
        .notNull()
        .default(sql`ARRAY[]::text[]`),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      check("profiles_nickname_length", sql`char_length(btrim(${t.nickname})) between 2 and 24`),
      check(
        "profile_phone_format",
        sql`${t.phoneNumber} is null or ${t.phoneNumber} ~ '^01[016789][0-9]{7,8}$'`,
      ),
      check(
        "profile_phone_verification",
        sql`${t.phoneVerifiedAt} is null or ${t.phoneNumber} is not null`,
      ),
      check(
        "profile_completion",
        sql`${t.profileCompletedAt} is null or (${t.phoneNumber} is not null and ${t.onboardingConsentAt} is not null)`,
      ),
      check(
        "profile_age_band",
        sql`${t.ageBand} is null or ${t.ageBand} in ('20s','30s','40s','50plus')`,
      ),
      check("profile_gender", sql`${t.gender} is null or ${t.gender} in ('female','male','other')`),
    ],
  )
  .enableRLS();

export const profilePhotos = sliper
  .table(
    "profile_photos",
    {
      id: uuid("id").primaryKey(),
      userId: uuid("user_id")
        .notNull()
        .unique()
        .references(() => profiles.id, { onDelete: "cascade" }),
      objectKey: varchar("object_key", { length: 41 }).notNull().unique(),
      storageBackend: varchar("storage_backend", { length: 16 })
        .$type<ImageStorageBackend>()
        .notNull()
        .default("local"),
      contentType: varchar("content_type", { length: 40 }).notNull(),
      bytes: integer("bytes").notNull(),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      check("profile_photo_object_key", sql`${t.objectKey} = ${t.id}::text || '.webp'`),
      check("profile_photo_storage_backend", sql`${t.storageBackend} in ('local','supabase')`),
      check("profile_photo_content_type", sql`${t.contentType} = 'image/webp'`),
      check("profile_photo_byte_size", sql`${t.bytes} between 1 and 2097152`),
    ],
  )
  .enableRLS();

export const categories = sliper
  .table(
    "categories",
    {
      slug: categorySlugEnum("slug").primaryKey(),
      name: varchar("name", { length: 24 }).notNull(),
      sortOrder: smallint("sort_order").notNull().unique(),
    },
    (t) => [check("categories_sort_order_range", sql`${t.sortOrder} between 0 and 11`)],
  )
  .enableRLS();

export const posts = sliper
  .table(
    "posts",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      categorySlug: categorySlugEnum("category_slug")
        .notNull()
        .references(() => categories.slug, { onDelete: "restrict" }),
      authorId: uuid("author_id").references(() => profiles.id, { onDelete: "set null" }),
      isAnonymous: boolean("is_anonymous").notNull().default(false),
      title: varchar("title", { length: 120 }).notNull(),
      kind: postKindEnum("kind").notNull().default("이야기"),
      featured: boolean("featured").notNull().default(false),
      sample: boolean("sample").notNull().default(false),
      location: varchar("location", { length: 120 }),
      eventDate: varchar("event_date", { length: 120 }),
      applicationUrl: varchar("application_url", { length: 2048 }),
      eventFee: varchar("event_fee", { length: 120 }),
      contactInfo: varchar("contact_info", { length: 300 }),
      discussionType: varchar("discussion_type", { length: 16 }).$type<DiscussionType>(),
      spoiler: boolean("spoiler").notNull().default(false),
      spoilerTitle: varchar("spoiler_title", { length: 120 }),
      spoilerSummary: varchar("spoiler_summary", { length: 200 }),
      topic: varchar("topic", { length: 64 }),
      tags: text("tags")
        .array()
        .notNull()
        .default(sql`ARRAY[]::text[]`),
      poll: jsonb("poll").$type<{ question: string; options: string[] }>(),
      bodyMarkdown: text("body_markdown").notNull(),
      bodyDocument: jsonb("body_document").$type<PostDocument>(),
      status: contentStatusEnum("status").notNull().default("published"),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
    },
    (t) => [
      check(
        "posts_discussion_type",
        sql`${t.discussionType} is null or (${t.kind}='이야기' and ${t.discussionType} in ('free','question','tip','analysis'))`,
      ),
      check(
        "posts_spoiler_title",
        sql`not ${t.spoiler} or (${t.kind}<>'모집' and ${t.spoilerTitle} is not null and char_length(btrim(${t.spoilerTitle})) between 1 and 120)`,
      ),
      index("posts_discussion_feed_idx")
        .on(t.discussionType, t.createdAt.desc(), t.id.desc())
        .where(sql`${t.status}='published'`),
      index("posts_category_feed_idx")
        .on(t.categorySlug, t.createdAt.desc(), t.id.desc())
        .where(sql`${t.status} = 'published'`),
      index("posts_latest_idx")
        .on(t.createdAt.desc(), t.id.desc())
        .where(sql`${t.status} = 'published'`),
      index("posts_author_idx").on(t.authorId),
      index("posts_topic_feed_idx")
        .on(t.categorySlug, t.topic, t.createdAt.desc(), t.id.desc())
        .where(sql`${t.status} = 'published'`),
      check(
        "posts_poll_kind",
        sql`${t.status} = 'deleted' or ((${t.kind}::text = '투표') = (${t.poll} is not null))`,
      ),
      check("posts_tags_limit", sql`cardinality(${t.tags}) <= 5`),
      check("posts_title_length", sql`char_length(btrim(${t.title})) between 1 and 120`),
      check(
        "posts_application_url",
        sql`${t.applicationUrl} is null or (${t.kind} = '모집' and ${t.applicationUrl} ~ '^https?://[^[:space:]]+$')`,
      ),
      check(
        "posts_body_length",
        sql`char_length(${t.bodyMarkdown}) <= 30000 and (${t.status} = 'deleted' or char_length(btrim(${t.bodyMarkdown})) > 0)`,
      ),
      check(
        "posts_body_document_shape",
        sql`${t.bodyDocument} is null or coalesce((jsonb_typeof(${t.bodyDocument}) = 'object' and ${t.bodyDocument}->>'version' = '1' and ${t.bodyDocument}->>'type' = 'doc' and jsonb_typeof(${t.bodyDocument}->'content') = 'array' and octet_length(${t.bodyDocument}::text) <= 262144), false)`,
      ),
      check("posts_deletion_state", sql`(${t.status} = 'deleted') = (${t.deletedAt} is not null)`),
    ],
  )
  .enableRLS();

export const comments = sliper
  .table(
    "comments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      postId: uuid("post_id")
        .notNull()
        .references(() => posts.id, { onDelete: "cascade" }),
      parentId: uuid("parent_id"),
      authorId: uuid("author_id").references(() => profiles.id, { onDelete: "set null" }),
      isAnonymous: boolean("is_anonymous").notNull().default(false),
      bodyMarkdown: text("body_markdown").notNull(),
      status: contentStatusEnum("status").notNull().default("published"),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
    },
    (t) => [
      unique("comments_id_post_unique").on(t.id, t.postId),
      foreignKey({
        name: "comments_parent_same_post_fk",
        columns: [t.parentId, t.postId],
        foreignColumns: [t.id, t.postId],
      }),
      index("comments_thread_idx").on(t.postId, t.parentId, t.createdAt, t.id),
      index("comments_parent_idx").on(t.parentId),
      index("comments_author_idx").on(t.authorId),
      check("comments_not_self_parent", sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
      check(
        "comments_body_length",
        sql`char_length(${t.bodyMarkdown}) <= 5000 and (${t.status} = 'deleted' or char_length(btrim(${t.bodyMarkdown})) > 0)`,
      ),
      check(
        "comments_deletion_state",
        sql`(${t.status} = 'deleted') = (${t.deletedAt} is not null)`,
      ),
    ],
  )
  .enableRLS();

export const questionResolutions = sliper
  .table(
    "question_resolutions",
    {
      postId: uuid("post_id")
        .primaryKey()
        .references(() => posts.id, { onDelete: "cascade" }),
      commentId: uuid("comment_id").notNull(),
      resolvedBy: uuid("resolved_by").references(() => profiles.id, { onDelete: "set null" }),
      resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      foreignKey({
        name: "question_answer_same_post_fk",
        columns: [t.commentId, t.postId],
        foreignColumns: [comments.id, comments.postId],
      }).onDelete("cascade"),
    ],
  )
  .enableRLS();

export const eventRecords = sliper
  .table(
    "event_records",
    {
      postId: uuid("post_id")
        .primaryKey()
        .references(() => posts.id, { onDelete: "restrict" }),
      ownerId: uuid("owner_id").references(() => profiles.id, { onDelete: "set null" }),
      snapshot: jsonb("snapshot").$type<EventRecordSnapshot>().notNull(),
      status: varchar("status", { length: 16 }).notNull().default("draft"),
      purpose: varchar("purpose", { length: 2000 }).notNull().default(""),
      execution: varchar("execution", { length: 2000 }).notNull().default(""),
      highlights: varchar("highlights", { length: 2000 }).notNull().default(""),
      improvements: varchar("improvements", { length: 2000 }).notNull().default(""),
      venueTips: varchar("venue_tips", { length: 2000 }).notNull().default(""),
      bodyDocument: jsonb("body_document").$type<PostDocument>(),
      bodyMarkdown: text("body_markdown").notNull().default(""),
      completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
      publishedAt: timestamp("published_at", { withTimezone: true }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      check("record_status", sql`${t.status} in ('draft','published','withdrawn')`),
      index("record_feed_idx").on(t.status, t.completedAt.desc(), t.postId),
      index("record_owner_idx").on(t.ownerId),
      check(
        "record_document_size",
        sql`${t.bodyDocument} is null or octet_length(${t.bodyDocument}::text)<=204800`,
      ),
    ],
  )
  .enableRLS();

export const mediaAssets = sliper
  .table(
    "media_assets",
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
      // UUID filename only, never an auth ID, nickname, or original filename.
      objectKey: varchar("object_key", { length: 64 }).notNull().unique(),
      storageBackend: varchar("storage_backend", { length: 16 })
        .$type<ImageStorageBackend>()
        .notNull()
        .default("local"),
      contentType: varchar("content_type", { length: 32 }).notNull(),
      byteSize: integer("byte_size").notNull(),
      status: uploadStatusEnum("status").notNull().default("pending"),
      sortOrder: smallint("sort_order").notNull().default(0),
      createdAt: createdAt(),
    },
    (t) => [
      unique("media_assets_post_order_unique").on(t.postId, t.sortOrder),
      unique("media_assets_record_order_unique").on(t.recordPostId, t.sortOrder),
      check("media_single_parent", sql`num_nonnulls(${t.postId}, ${t.recordPostId}) <= 1`),
      index("media_assets_uploader_idx").on(t.uploaderId),
      check("media_assets_size_range", sql`${t.byteSize} between 1 and 10485760`),
      check("media_assets_storage_backend", sql`${t.storageBackend} in ('local','supabase')`),
      check("media_assets_order_range", sql`${t.sortOrder} between 0 and 9`),
      check(
        "media_assets_content_type",
        sql`${t.contentType} in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')`,
      ),
      check(
        "media_assets_object_key",
        sql`${t.objectKey} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp|gif)$'`,
      ),
    ],
  )
  .enableRLS();

export const postLikes = sliper
  .table(
    "post_likes",
    {
      postId: uuid("post_id")
        .notNull()
        .references(() => posts.id, { onDelete: "cascade" }),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      createdAt: createdAt(),
    },
    (t) => [
      primaryKey({ columns: [t.postId, t.userId] }),
      index("post_likes_user_idx").on(t.userId),
      index("post_likes_period_idx").on(t.postId, t.createdAt, t.userId),
    ],
  )
  .enableRLS();

export const bookmarks = sliper
  .table(
    "bookmarks",
    {
      postId: uuid("post_id")
        .notNull()
        .references(() => posts.id, { onDelete: "cascade" }),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      createdAt: createdAt(),
    },
    (t) => [
      primaryKey({ columns: [t.postId, t.userId] }),
      index("bookmarks_user_feed_idx").on(t.userId, t.createdAt.desc(), t.postId),
    ],
  )
  .enableRLS();

export const postDailyViews = sliper
  .table(
    "post_daily_views",
    {
      postId: uuid("post_id")
        .notNull()
        .references(() => posts.id, { onDelete: "cascade" }),
      visitorHash: varchar("visitor_hash", { length: 64 }).notNull(),
      // A custom BEFORE INSERT trigger always computes this date in Asia/Seoul.
      viewedOn: date("viewed_on", { mode: "string" })
        .notNull()
        .default(sql`(statement_timestamp() at time zone 'Asia/Seoul')::date`),
      createdAt: createdAt(),
    },
    (t) => [
      primaryKey({ columns: [t.postId, t.visitorHash, t.viewedOn] }),
      index("post_daily_views_date_idx").on(t.viewedOn),
      check("post_daily_views_hash_format", sql`${t.visitorHash} ~ '^[0-9a-f]{64}$'`),
    ],
  )
  .enableRLS();

export const notifications = sliper
  .table(
    "notifications",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      recipientId: uuid("recipient_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      postId: uuid("post_id")
        .notNull()
        .references(() => posts.id, { onDelete: "cascade" }),
      commentId: uuid("comment_id").notNull(),
      kind: notificationKindEnum("kind").notNull(),
      readAt: timestamp("read_at", { withTimezone: true }),
      createdAt: createdAt(),
    },
    (t) => [
      foreignKey({
        name: "notifications_comment_post_fk",
        columns: [t.commentId, t.postId],
        foreignColumns: [comments.id, comments.postId],
      }).onDelete("cascade"),
      // A post author who also receives a direct reply gets one notification.
      unique("notifications_recipient_comment_unique").on(t.recipientId, t.commentId),
      index("notifications_inbox_idx").on(t.recipientId, t.createdAt.desc(), t.id),
      index("notifications_unread_idx")
        .on(t.recipientId, t.createdAt.desc())
        .where(sql`${t.readAt} is null`),
      index("notifications_comment_idx").on(t.commentId, t.postId),
      index("notifications_post_idx").on(t.postId),
    ],
  )
  .enableRLS();

export const pollVotes = sliper
  .table(
    "poll_votes",
    {
      postId: uuid("post_id")
        .notNull()
        .references(() => posts.id, { onDelete: "cascade" }),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      optionIndex: smallint("option_index").notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      primaryKey({ columns: [t.postId, t.userId] }),
      check("poll_votes_option_range", sql`${t.optionIndex} between 0 and 7`),
      index("poll_votes_user_idx").on(t.userId),
    ],
  )
  .enableRLS();
export const activityEvents = sliper
  .table(
    "activity_events",
    {
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      sourceKey: varchar("source_key", { length: 100 }).notNull(),
      reason: varchar("reason", { length: 16 }).notNull(),
      points: smallint("points").notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      primaryKey({ columns: [t.userId, t.sourceKey] }),
      check("activity_positive_points", sql`${t.points} between 1 and 5`),
      index("activity_user_date_idx").on(t.userId, t.createdAt.desc()),
    ],
  )
  .enableRLS();

export const eventSettings = sliper
  .table(
    "event_settings",
    {
      postId: uuid("post_id")
        .primaryKey()
        .references(() => posts.id, { onDelete: "cascade" }),
      approvalMode: varchar("approval_mode", { length: 16 }).notNull().default("manual"),
      questions: jsonb("questions")
        .$type<
          {
            id: string;
            prompt: string;
            type: "text" | "single_choice";
            required: boolean;
            options: string[];
          }[]
        >()
        .notNull()
        .default(sql`'[]'::jsonb`),
      meetupType: varchar("meetup_type", { length: 16 }).notNull().default("event"),
      activityCategory: varchar("activity_category", { length: 32 }).$type<LightningCategorySlug>(),
      venueLatitude: doublePrecision("venue_latitude"),
      venueLongitude: doublePrecision("venue_longitude"),
      startsAt: timestamp("starts_at", { withTimezone: true }),
      endsAt: timestamp("ends_at", { withTimezone: true }),
      completedAt: timestamp("completed_at", { withTimezone: true }),
      completedBy: uuid("completed_by").references(() => profiles.id, { onDelete: "set null" }),
      refundPolicy: varchar("refund_policy", { length: 24 }).notNull().default("sliper-v1"),
      amountKRW: integer("amount_krw").notNull(),
      capacity: integer("capacity").notNull(),
      open: boolean("open").notNull().default(true),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      index("event_venue_idx")
        .on(t.venueLatitude, t.venueLongitude)
        .where(sql`${t.venueLatitude} is not null`),
      index("event_reminder_schedule_idx")
        .on(t.startsAt, t.postId)
        .where(sql`${t.startsAt} is not null`),
      index("event_lightning_category_idx")
        .on(t.activityCategory, t.postId)
        .where(sql`${t.meetupType} = 'lightning'`),
      check("event_meetup_type", sql`${t.meetupType} in ('event','lightning')`),
      check(
        "event_activity_category",
        sql`${t.activityCategory} is null or (${t.meetupType} = 'lightning' and ${t.activityCategory} in (${sql.join(
          LIGHTNING_CATEGORY_SLUGS.map((slug) => sql.raw(`'${slug}'`)),
          sql`, `,
        )}))`,
      ),
      check(
        "event_questions_shape",
        sql`jsonb_typeof(${t.questions})='array' and jsonb_array_length(${t.questions})<=10`,
      ),
      check("event_venue_pair", sql`(${t.venueLatitude} is null) = (${t.venueLongitude} is null)`),
      check(
        "event_venue_range",
        sql`${t.venueLatitude} between -90 and 90 and ${t.venueLongitude} between -180 and 180`,
      ),
      check(
        "event_lightning_rules",
        sql`${t.meetupType} <> 'lightning' or (${t.capacity} between 2 and 12 and ${t.startsAt} is not null and ${t.endsAt} is not null and ${t.venueLatitude} is not null and ${t.venueLongitude} is not null and ${t.startsAt}>${t.createdAt} and ${t.startsAt}<=${t.createdAt}+interval '7 days' and ${t.endsAt}>=${t.startsAt}+interval '15 minutes' and ${t.endsAt}<=${t.startsAt}+interval '12 hours')`,
      ),
      check("event_amount_range", sql`${t.amountKRW} between 0 and 10000000`),
      check(
        "event_schedule",
        sql`${t.endsAt} is null or (${t.startsAt} is not null and ${t.endsAt}>${t.startsAt})`,
      ),
      check("event_refund_policy", sql`${t.refundPolicy}='sliper-v1'`),
      check("event_capacity_range", sql`${t.capacity} between 1 and 5000`),
    ],
  )
  .enableRLS();

export const eventApplications = sliper
  .table(
    "event_applications",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      postId: uuid("post_id")
        .notNull()
        .references(() => eventSettings.postId, { onDelete: "cascade" }),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      source: varchar("source", { length: 16 }).notNull().default("site"),
      externalReference: varchar("external_reference", { length: 160 }),
      decisionNote: varchar("decision_note", { length: 500 }).notNull().default(""),
      eventStartsAt: timestamp("event_starts_at", { withTimezone: true }),
      refundPolicy: varchar("refund_policy", { length: 24 }).notNull().default("sliper-v1"),
      refundConsentAt: timestamp("refund_consent_at", { withTimezone: true }),
      attendeeName: varchar("attendee_name", { length: 60 }).notNull(),
      contact: varchar("contact", { length: 100 }).notNull(),
      note: varchar("note", { length: 500 }).notNull().default(""),
      answers: jsonb("answers")
        .$type<
          {
            questionId: string;
            prompt: string;
            type: "text" | "single_choice";
            options: string[];
            answer: string;
          }[]
        >()
        .notNull()
        .default(sql`'[]'::jsonb`),
      questionnaireVersion: varchar("questionnaire_version", { length: 80 }),
      amountKRW: integer("amount_krw").notNull(),
      status: varchar("status", { length: 20 }).notNull().default("pending_payment"),
      expiresAt: timestamp("expires_at", { withTimezone: true }),
      confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      unique("application_identity_unique").on(t.id, t.postId, t.userId),
      index("application_user_idx").on(t.userId, t.createdAt.desc()),
      index("application_event_idx").on(t.postId, t.status),
      check(
        "application_status",
        sql`${t.status} in ('pending_payment','pending_approval','confirmed','cancelled','expired','refunded','review','rejected')`,
      ),
      check("application_amount", sql`${t.amountKRW} between 0 and 10000000`),
      check(
        "application_answers_shape",
        sql`jsonb_typeof(${t.answers})='array' and jsonb_array_length(${t.answers})<=10`,
      ),
      check("application_name", sql`char_length(btrim(${t.attendeeName})) between 1 and 60`),
      check("application_contact", sql`char_length(btrim(${t.contact})) between 3 and 100`),
    ],
  )
  .enableRLS();

export const paymentOrders = sliper
  .table(
    "payment_orders",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      applicationId: uuid("application_id")
        .notNull()
        .unique()
        .references(() => eventApplications.id, { onDelete: "restrict" }),
      provider: varchar("provider", { length: 40 }).notNull(),
      amountKRW: integer("amount_krw").notNull(),
      currency: varchar("currency", { length: 3 }).notNull().default("KRW"),
      state: varchar("state", { length: 16 }).notNull().default("pending"),
      refundedAmountKRW: integer("refunded_amount_krw"),
      paymentId: varchar("payment_id", { length: 160 }),
      checkoutUrl: varchar("checkout_url", { length: 2048 }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      unique("provider_payment_unique").on(t.provider, t.paymentId),
      check("payment_amount", sql`${t.amountKRW} between 1 and 10000000 and ${t.currency} = 'KRW'`),
      check("payment_state", sql`${t.state} in ('pending','paid','refunded')`),
    ],
  )
  .enableRLS();

export const paymentEvents = sliper
  .table(
    "payment_events",
    {
      provider: varchar("provider", { length: 40 }).notNull(),
      eventId: varchar("event_id", { length: 160 }).notNull(),
      orderId: uuid("order_id")
        .notNull()
        .references(() => paymentOrders.id, { onDelete: "restrict" }),
      digest: varchar("digest", { length: 64 }).notNull(),
      kind: varchar("kind", { length: 16 }).notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      primaryKey({ columns: [t.provider, t.eventId] }),
      index("payment_events_order_idx").on(t.orderId),
      check("payment_event_kind", sql`${t.kind} in ('paid','refunded')`),
    ],
  )
  .enableRLS();

export const roomManagers = sliper
  .table(
    "room_managers",
    {
      postId: uuid("post_id")
        .notNull()
        .references(() => eventSettings.postId, { onDelete: "cascade" }),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      createdAt: createdAt(),
    },
    (t) => [primaryKey({ columns: [t.postId, t.userId] })],
  )
  .enableRLS();

export const roomMembers = sliper
  .table(
    "room_members",
    {
      postId: uuid("post_id")
        .notNull()
        .references(() => eventSettings.postId, { onDelete: "cascade" }),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      applicationId: uuid("application_id").notNull().unique(),
      joinedAt: createdAt(),
      revokedAt: timestamp("revoked_at", { withTimezone: true }),
    },
    (t) => [
      primaryKey({ columns: [t.postId, t.userId] }),
      foreignKey({
        name: "room_application_identity_fk",
        columns: [t.applicationId, t.postId, t.userId],
        foreignColumns: [eventApplications.id, eventApplications.postId, eventApplications.userId],
      }).onDelete("cascade"),
      index("room_members_user_idx").on(t.userId),
    ],
  )
  .enableRLS();

export const roomMessages = sliper
  .table(
    "room_messages",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      postId: uuid("post_id")
        .notNull()
        .references(() => eventSettings.postId, { onDelete: "cascade" }),
      authorId: uuid("author_id").references(() => profiles.id, { onDelete: "set null" }),
      body: text("body").notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      index("room_messages_page_idx").on(t.postId, t.createdAt.desc(), t.id.desc()),
      check("room_message_length", sql`char_length(btrim(${t.body})) between 1 and 10000`),
    ],
  )
  .enableRLS();

export const externalReceipts = sliper
  .table(
    "external_receipts",
    {
      applicationId: uuid("application_id")
        .primaryKey()
        .references(() => eventApplications.id, { onDelete: "restrict" }),
      postId: uuid("post_id")
        .notNull()
        .references(() => eventSettings.postId, { onDelete: "restrict" }),
      reference: varchar("reference", { length: 160 }).notNull(),
      amountKRW: integer("amount_krw").notNull(),
      provider: varchar("provider", { length: 40 }).notNull(),
      verification: varchar("verification", { length: 16 }).notNull(),
      verifiedBy: uuid("verified_by").references(() => profiles.id, { onDelete: "set null" }),
      state: varchar("state", { length: 16 }).notNull().default("paid"),
      refundedAmountKRW: integer("refunded_amount_krw"),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      unique("event_external_receipt_unique").on(t.postId, t.reference),
      check("external_receipt_amount", sql`${t.amountKRW} between 0 and 10000000`),
      check("external_receipt_state", sql`${t.state} in ('paid','refunded')`),
      check("external_receipt_verification", sql`${t.verification} in ('manual','integration')`),
    ],
  )
  .enableRLS();
export const externalWebhookEvents = sliper
  .table(
    "external_webhook_events",
    {
      provider: varchar("provider", { length: 40 }).notNull(),
      eventId: varchar("event_id", { length: 160 }).notNull(),
      postId: uuid("post_id")
        .notNull()
        .references(() => eventSettings.postId, { onDelete: "restrict" }),
      digest: varchar("digest", { length: 64 }).notNull(),
      createdAt: createdAt(),
    },
    (t) => [primaryKey({ columns: [t.provider, t.eventId] })],
  )
  .enableRLS();

export const refundRequests = sliper
  .table(
    "refund_requests",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      applicationId: uuid("application_id").notNull(),
      postId: uuid("post_id").notNull(),
      userId: uuid("user_id").notNull(),
      cause: varchar("cause", { length: 24 }).notNull().default("participant"),
      policyVersion: varchar("policy_version", { length: 24 }).notNull().default("sliper-v1"),
      eventStartsAt: timestamp("event_starts_at", { withTimezone: true }).notNull(),
      amountKRW: integer("amount_krw").notNull(),
      rate: integer("rate").notNull(),
      refundableKRW: integer("refundable_krw").notNull(),
      reason: varchar("reason", { length: 500 }).notNull(),
      state: varchar("state", { length: 16 }).notNull().default("pending"),
      actualRefundKRW: integer("actual_refund_krw"),
      processedBy: uuid("processed_by").references(() => profiles.id, { onDelete: "set null" }),
      decisionNote: varchar("decision_note", { length: 500 }).notNull().default(""),
      requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
      processedAt: timestamp("processed_at", { withTimezone: true }),
    },
    (t) => [
      foreignKey({
        name: "refund_application_identity_fk",
        columns: [t.applicationId, t.postId, t.userId],
        foreignColumns: [eventApplications.id, eventApplications.postId, eventApplications.userId],
      }).onDelete("restrict"),
      uniqueIndex("pending_refund_unique")
        .on(t.applicationId)
        .where(sql`${t.state}='pending'`),
      check("refund_cause", sql`${t.cause} in ('participant','host_cancel','schedule_change')`),
      check("refund_state", sql`${t.state} in ('pending','completed','rejected')`),
      check("refund_policy", sql`${t.policyVersion}='sliper-v1'`),
      check(
        "refund_amounts",
        sql`${t.amountKRW} between 0 and 10000000 and ${t.rate} in (0,20,40,60,80,100) and ${t.refundableKRW}=floor(${t.amountKRW}::numeric*${t.rate}/100) and (${t.actualRefundKRW} is null or ${t.actualRefundKRW} between 0 and ${t.amountKRW})`,
      ),
      check(
        "refund_completion",
        sql`(${t.state}='pending' and ${t.processedAt} is null and ${t.actualRefundKRW} is null) or (${t.state}<>'pending' and ${t.processedAt} is not null and (${t.state}<>'completed' or ${t.actualRefundKRW} is not null))`,
      ),
      index("refund_event_idx").on(t.postId, t.requestedAt.desc(), t.id),
    ],
  )
  .enableRLS();
