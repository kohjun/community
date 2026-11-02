import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  primaryKey,
  timestamp,
  unique,
  uuid,
  varchar,
  text,
} from "drizzle-orm/pg-core";
import { sliper, profiles, posts, eventSettings } from "./schema";
import type { SavedSearchInput } from "../domain/community-growth";
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const savedSearches = sliper
  .table(
    "saved_searches",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      settings: jsonb("settings").notNull().$type<SavedSearchInput>(),
      createdAt: created(),
      nextScanAt: timestamp("next_scan_at", { withTimezone: true }).notNull().defaultNow(),
      lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
    },
    (t) => [
      index("saved_search_owner_idx").on(t.userId),
      index("saved_search_scan_idx").on(t.nextScanAt, t.id),
      check(
        "saved_search_shape",
        sql`jsonb_typeof(${t.settings})='object' and octet_length(${t.settings}::text)<=4096`,
      ),
    ],
  )
  .enableRLS();
export const eventWaitlist = sliper
  .table(
    "event_waitlist",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      postId: uuid("post_id")
        .notNull()
        .references(() => eventSettings.postId, { onDelete: "cascade" }),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      state: varchar("state", { length: 16 })
        .notNull()
        .$type<"waiting" | "offered" | "submitted" | "expired" | "cancelled">()
        .default("waiting"),
      createdAt: created(),
      nextScanAt: timestamp("next_scan_at", { withTimezone: true }).notNull().defaultNow(),
      offerUntil: timestamp("offer_until", { withTimezone: true }),
    },
    (t) => [
      unique("waitlist_event_member").on(t.postId, t.userId),
      index("waitlist_queue_idx").on(t.postId, t.state, t.createdAt, t.id),
      index("waitlist_member_idx").on(t.userId, t.createdAt),
      index("waitlist_scan_idx").on(t.nextScanAt, t.postId),
      check(
        "waitlist_state",
        sql`${t.state} in ('waiting','offered','submitted','expired','cancelled')`,
      ),
      check("waitlist_offer", sql`${t.state}<>'offered' or ${t.offerUntil} is not null`),
    ],
  )
  .enableRLS();
export const eventIdeas = sliper
  .table(
    "event_ideas",
    {
      postId: uuid("post_id")
        .primaryKey()
        .references(() => posts.id, { onDelete: "cascade" }),
      region: varchar("region", { length: 60 }).notNull(),
      dateFrom: date("date_from").notNull(),
      dateTo: date("date_to").notNull(),
      closed: boolean("closed").notNull().default(false),
      sourceEventId: uuid("source_event_id").references(() => posts.id, { onDelete: "set null" }),
      createdAt: created(),
    },
    (t) => [
      index("ideas_recent_idx").on(t.createdAt.desc(), t.postId),
      index("ideas_source_idx").on(t.sourceEventId),
      check("idea_dates", sql`${t.dateTo}>=${t.dateFrom}`),
    ],
  )
  .enableRLS();
export const ideaInterests = sliper
  .table(
    "idea_interests",
    {
      postId: uuid("post_id")
        .notNull()
        .references(() => eventIdeas.postId, { onDelete: "cascade" }),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      createdAt: created(),
    },
    (t) => [
      primaryKey({ columns: [t.postId, t.userId] }),
      index("idea_interest_member_idx").on(t.userId),
    ],
  )
  .enableRLS();
export const ideaEvents = sliper
  .table(
    "idea_events",
    {
      ideaId: uuid("idea_id")
        .notNull()
        .references(() => eventIdeas.postId, { onDelete: "cascade" }),
      eventId: uuid("event_id")
        .notNull()
        .references(() => posts.id, { onDelete: "cascade" }),
      createdAt: created(),
    },
    (t) => [
      primaryKey({ columns: [t.ideaId, t.eventId] }),
      index("idea_event_reverse_idx").on(t.eventId),
    ],
  )
  .enableRLS();
export const eventReflections = sliper
  .table(
    "event_reflections",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      postId: uuid("post_id")
        .notNull()
        .references(() => posts.id, { onDelete: "cascade" }),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      photos: jsonb("photos")
        .notNull()
        .$type<string[]>()
        .default(sql`'[]'::jsonb`),
      body: text("body").notNull(),
      nextWish: varchar("next_wish", { length: 500 }).notNull().default(""),
      visibility: varchar("visibility", { length: 16 })
        .notNull()
        .$type<"participants" | "members">(),
      version: integer("version").notNull().default(1),
      createdAt: created(),
    },
    (t) => [
      unique("reflection_event_member").on(t.postId, t.userId),
      index("reflection_event_page_idx").on(t.postId, t.createdAt, t.id),
      check(
        "reflection_photos",
        sql`jsonb_typeof(${t.photos})='array' and jsonb_array_length(${t.photos})<=6`,
      ),
      check("reflection_visibility", sql`${t.visibility} in ('participants','members')`),
      check("reflection_body", sql`char_length(${t.body}) between 1 and 2000 and ${t.version}>0`),
    ],
  )
  .enableRLS();
