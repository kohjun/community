import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sliper, profiles, posts, eventApplications, eventSettings } from "./schema";
import { libraryEntries } from "./library-schema";
const stamp = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const admissionTickets = sliper
  .table(
    "admission_tickets",
    {
      applicationId: uuid("application_id")
        .primaryKey()
        .references(() => eventApplications.id, { onDelete: "cascade" }),
      codeHash: varchar("code_hash", { length: 64 }).notNull().unique(),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      createdAt: stamp(),
    },
    (t) => [check("ticket_hash_format", sql`${t.codeHash} ~ '^[a-f0-9]{64}$'`)],
  )
  .enableRLS();
export const eventAdmissions = sliper
  .table(
    "event_admissions",
    {
      applicationId: uuid("application_id").primaryKey(),
      postId: uuid("post_id").notNull(),
      userId: uuid("user_id").notNull(),
      checkedBy: uuid("checked_by").references(() => profiles.id, { onDelete: "set null" }),
      checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      foreignKey({
        name: "admission_application_identity_fk",
        columns: [t.applicationId, t.postId, t.userId],
        foreignColumns: [eventApplications.id, eventApplications.postId, eventApplications.userId],
      }).onDelete("cascade"),
      unique("admission_event_member").on(t.postId, t.userId),
      unique("admission_identity_unique").on(t.applicationId, t.postId, t.userId),
      index("admission_event_time_idx").on(t.postId, t.checkedAt),
      check("admission_no_self", sql`${t.checkedBy} is null or ${t.checkedBy}<>${t.userId}`),
    ],
  )
  .enableRLS();
export const paymentReviews = sliper
  .table(
    "event_payment_reviews",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      applicationId: uuid("application_id")
        .notNull()
        .references(() => eventApplications.id, { onDelete: "cascade" }),
      fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
      note: varchar("note", { length: 1000 }).notNull(),
      reviewedBy: uuid("reviewed_by").references(() => profiles.id, { onDelete: "set null" }),
      createdAt: stamp(),
    },
    (t) => [
      index("payment_review_application_idx").on(t.applicationId, t.createdAt),
      check("payment_review_note", sql`char_length(btrim(${t.note})) between 5 and 1000`),
    ],
  )
  .enableRLS();
export const verifiedEventReviews = sliper
  .table(
    "verified_event_reviews",
    {
      reviewPostId: uuid("review_post_id")
        .primaryKey()
        .references(() => posts.id, { onDelete: "cascade" }),
      eventPostId: uuid("event_post_id")
        .notNull()
        .references(() => eventSettings.postId, { onDelete: "restrict" }),
      applicationId: uuid("application_id")
        .notNull()
        .unique()
        .references(() => eventAdmissions.applicationId, { onDelete: "restrict" }),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "restrict" }),
      hostId: uuid("host_id").references(() => profiles.id, { onDelete: "set null" }),
      templateEntryId: uuid("template_entry_id").references(() => libraryEntries.id, {
        onDelete: "set null",
      }),
      eventTitle: varchar("event_title", { length: 120 }).notNull(),
      rating: integer("rating").notNull(),
      createdAt: stamp(),
    },
    (t) => [
      unique("verified_review_event_member").on(t.eventPostId, t.userId),
      foreignKey({
        name: "verified_review_admission_identity_fk",
        columns: [t.applicationId, t.eventPostId, t.userId],
        foreignColumns: [
          eventAdmissions.applicationId,
          eventAdmissions.postId,
          eventAdmissions.userId,
        ],
      }).onDelete("restrict"),
      index("verified_review_event_idx").on(t.eventPostId, t.createdAt),
      check("verified_review_rating", sql`${t.rating} between 1 and 5`),
    ],
  )
  .enableRLS();
