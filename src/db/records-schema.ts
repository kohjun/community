import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sliper, profiles, posts, eventRecords } from "./schema";
import { libraryEntries } from "./library-schema";
import type { CreditRole, CreditStatus } from "../domain/records";
const stamp = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export { eventRecords } from "./schema";
export const eventCredits = sliper
  .table(
    "event_credits",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      postId: uuid("post_id")
        .notNull()
        .references(() => posts.id, { onDelete: "restrict" }),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "restrict" }),
      role: varchar("role", { length: 24 }).$type<CreditRole>().notNull(),
      note: varchar("note", { length: 500 }).notNull().default(""),
      confirmedBy: uuid("confirmed_by").references(() => profiles.id, { onDelete: "set null" }),
      status: varchar("status", { length: 24 }).$type<CreditStatus>().notNull().default("pending"),
      acceptedAt: timestamp("accepted_at", { withTimezone: true }),
      correctionNote: varchar("correction_note", { length: 500 }).notNull().default(""),
      legacyContributionId: uuid("legacy_contribution_id"),
      createdAt: stamp(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      unique("event_credit_role_once").on(t.postId, t.userId, t.role),
      check("event_credit_no_self", sql`${t.confirmedBy} is null or ${t.confirmedBy}<>${t.userId}`),
      check(
        "event_credit_role",
        sql`${t.role} in ('기획자','MC','진행 스태프','촬영·편집','디자인','공간·장비')`,
      ),
      check(
        "event_credit_status",
        sql`${t.status} in ('pending','accepted','rejected','withdrawn','correction_requested')`,
      ),
      check("event_credit_acceptance", sql`(${t.status}='accepted')=(${t.acceptedAt} is not null)`),
      index("event_credit_member_idx").on(t.userId, t.createdAt.desc()),
    ],
  )
  .enableRLS();
export const portfolioPreferences = sliper
  .table(
    "portfolio_preferences",
    {
      userId: uuid("user_id")
        .primaryKey()
        .references(() => profiles.id, { onDelete: "cascade" }),
      visible: boolean("visible").notNull().default(false),
      featuredEventIds: uuid("featured_event_ids")
        .array()
        .notNull()
        .default(sql`ARRAY[]::uuid[]`),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [check("portfolio_featured_limit", sql`cardinality(${t.featuredEventIds})<=3`)],
  )
  .enableRLS();
export const eventResultRevisions = sliper
  .table(
    "event_result_revisions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      applicationId: uuid("application_id").notNull(),
      postId: uuid("post_id")
        .notNull()
        .references(() => posts.id, { onDelete: "restrict" }),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "restrict" }),
      recorderId: uuid("recorder_id").references(() => profiles.id, { onDelete: "set null" }),
      before: jsonb("before"),
      after: jsonb("after").notNull(),
      reason: text("reason").notNull(),
      legacy: boolean("legacy").notNull().default(false),
      createdAt: stamp(),
    },
    (t) => [index("result_revision_identity_idx").on(t.postId, t.userId, t.createdAt)],
  )
  .enableRLS();
export const eventRecordLinks = sliper
  .table(
    "event_record_links",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      recordPostId: uuid("record_post_id")
        .notNull()
        .references(() => eventRecords.postId, { onDelete: "cascade" }),
      relatedPostId: uuid("related_post_id").references(() => posts.id, { onDelete: "restrict" }),
      libraryEntryId: uuid("library_entry_id").references(() => libraryEntries.id, {
        onDelete: "restrict",
      }),
    },
    (t) => [
      check("record_link_one_target", sql`num_nonnulls(${t.relatedPostId},${t.libraryEntryId})=1`),
      unique("record_link_post_once").on(t.recordPostId, t.relatedPostId),
      unique("record_link_library_once").on(t.recordPostId, t.libraryEntryId),
    ],
  )
  .enableRLS();
