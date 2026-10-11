import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sliper, profiles, eventSettings, eventApplications } from "./schema";
const stamp = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
// Private tables: APIs expose explicit public IDs and aggregate scores only.
export const playerPreferences = sliper
  .table(
    "player_preferences",
    {
      userId: uuid("user_id")
        .primaryKey()
        .references(() => profiles.id, { onDelete: "cascade" }),
      preferredRole: varchar("preferred_role", { length: 16 }),
      matchingVisible: boolean("matching_visible").notNull().default(false),
      historyPublic: boolean("history_public").notNull().default(false),
      updatedAt: updated(),
    },
    (t) => [
      check(
        "player_preference_role",
        sql`${t.preferredRole} is null or ${t.preferredRole} in ('brain','physical','strategist','trickster')`,
      ),
    ],
  )
  .enableRLS();
export const eventResults = sliper
  .table(
    "event_results",
    {
      applicationId: uuid("application_id").primaryKey(),
      postId: uuid("post_id")
        .notNull()
        .references(() => eventSettings.postId, { onDelete: "cascade" }),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      recorderId: uuid("recorder_id").references(() => profiles.id, { onDelete: "set null" }),
      presence: varchar("presence", { length: 16 }).notNull(),
      outcome: varchar("outcome", { length: 16 }).notNull().default("participated"),
      observedRole: varchar("observed_role", { length: 16 }),
      reason: varchar("reason", { length: 500 }).notNull().default(""),
      createdAt: stamp(),
      updatedAt: updated(),
    },
    (t) => [
      unique("player_event_result_identity").on(t.postId, t.userId),
      unique("player_event_result_application_identity").on(t.applicationId, t.postId, t.userId),
      foreignKey({
        name: "player_application_identity_fk",
        columns: [t.applicationId, t.postId, t.userId],
        foreignColumns: [eventApplications.id, eventApplications.postId, eventApplications.userId],
      }).onDelete("cascade"),
      index("player_result_user_idx").on(t.userId, t.createdAt.desc()),
      check("player_result_presence", sql`${t.presence} in ('attended','no_show')`),
      check("player_result_outcome", sql`${t.outcome} in ('participated','won')`),
      check(
        "player_result_role",
        sql`${t.observedRole} is null or ${t.observedRole} in ('brain','physical','strategist','trickster')`,
      ),
      check(
        "player_result_no_show",
        sql`${t.presence}='attended' or (${t.outcome}='participated' and ${t.observedRole} is null)`,
      ),
      check(
        "player_result_no_self",
        sql`${t.recorderId} is null or ${t.recorderId} <> ${t.userId}`,
      ),
    ],
  )
  .enableRLS();
export const mannerReviews = sliper
  .table(
    "manner_reviews",
    {
      postId: uuid("post_id").notNull(),
      reviewerId: uuid("reviewer_id").notNull(),
      targetId: uuid("target_id").notNull(),
      sentiment: varchar("sentiment", { length: 12 }).notNull(),
      tags: text("tags").array().notNull(),
      createdAt: stamp(),
    },
    (t) => [
      primaryKey({ columns: [t.postId, t.reviewerId, t.targetId] }),
      foreignKey({
        name: "manner_reviewer_result_fk",
        columns: [t.postId, t.reviewerId],
        foreignColumns: [eventResults.postId, eventResults.userId],
      }).onDelete("cascade"),
      foreignKey({
        name: "manner_target_result_fk",
        columns: [t.postId, t.targetId],
        foreignColumns: [eventResults.postId, eventResults.userId],
      }).onDelete("cascade"),
      index("manner_reviews_target_idx").on(t.targetId),
      check("manner_review_no_self", sql`${t.reviewerId} <> ${t.targetId}`),
      check("manner_review_sentiment", sql`${t.sentiment} in ('positive','negative')`),
      check(
        "manner_review_tags",
        sql`cardinality(${t.tags}) between 1 and 2 and ((${t.sentiment}='positive' and ${t.tags}<@ARRAY['규칙 준수','배려']::text[]) or (${t.sentiment}='negative' and ${t.tags}=ARRAY['진행 방해']::text[]))`,
      ),
    ],
  )
  .enableRLS();
