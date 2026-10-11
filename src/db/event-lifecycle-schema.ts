import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sliper, eventSettings, eventApplications, profiles } from "./schema";
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const eventLifecycle = sliper
  .table(
    "event_lifecycle",
    {
      postId: uuid("post_id")
        .primaryKey()
        .references(() => eventSettings.postId, { onDelete: "cascade" }),
      cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
      cancellationReason: varchar("cancellation_reason", { length: 500 }).notNull().default(""),
      revision: integer("revision").notNull().default(0),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      check("lifecycle_revision", sql`${t.revision}>=0`),
      check(
        "lifecycle_cancel_reason",
        sql`${t.cancelledAt} is null or char_length(btrim(${t.cancellationReason})) between 5 and 500`,
      ),
    ],
  )
  .enableRLS();
export const eventChanges = sliper
  .table(
    "event_changes",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      postId: uuid("post_id")
        .notNull()
        .references(() => eventSettings.postId, { onDelete: "restrict" }),
      kind: varchar("kind", { length: 16 }).notNull().$type<"cancel" | "reschedule">(),
      revision: integer("revision").notNull(),
      reason: varchar("reason", { length: 500 }).notNull(),
      beforeStartsAt: timestamp("before_starts_at", { withTimezone: true }),
      beforeEndsAt: timestamp("before_ends_at", { withTimezone: true }),
      startsAt: timestamp("starts_at", { withTimezone: true }),
      endsAt: timestamp("ends_at", { withTimezone: true }),
      createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
      createdAt: created(),
    },
    (t) => [
      unique("change_event_revision").on(t.postId, t.revision),
      unique("change_event_identity").on(t.id, t.postId),
      index("change_event_time").on(t.postId, t.createdAt),
      check("event_change_kind", sql`${t.kind} in ('cancel','reschedule')`),
      check("event_change_reason", sql`char_length(btrim(${t.reason})) between 5 and 500`),
      check(
        "event_change_schedule",
        sql`${t.kind}<>'reschedule' or (${t.startsAt} is not null and ${t.endsAt}>${t.startsAt})`,
      ),
    ],
  )
  .enableRLS();
export const eventChangeRecipients = sliper
  .table(
    "event_change_recipients",
    {
      changeId: uuid("change_id").notNull(),
      applicationId: uuid("application_id").notNull(),
      postId: uuid("post_id").notNull(),
      userId: uuid("user_id").notNull(),
      readAt: timestamp("read_at", { withTimezone: true }),
      createdAt: created(),
    },
    (t) => [
      primaryKey({ columns: [t.changeId, t.applicationId] }),
      foreignKey({
        name: "change_recipient_event_fk",
        columns: [t.changeId, t.postId],
        foreignColumns: [eventChanges.id, eventChanges.postId],
      }).onDelete("cascade"),
      foreignKey({
        name: "change_recipient_application_fk",
        columns: [t.applicationId, t.postId, t.userId],
        foreignColumns: [eventApplications.id, eventApplications.postId, eventApplications.userId],
      }).onDelete("cascade"),
      index("change_recipient_inbox_idx").on(t.userId, t.createdAt),
      index("change_recipient_application_idx").on(t.applicationId),
    ],
  )
  .enableRLS();
