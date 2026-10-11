import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { categorySlugEnum, contentStatusEnum, posts, profiles, sliper } from "./schema";
import type { RegisteredVenueSnapshot } from "../domain/place-snapshot";

// Private, server-owned tables. Public routes expose explicit DTOs only.
export const communityVenues = sliper
  .table(
    "community_venues",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      ownerId: uuid("owner_id").references(() => profiles.id, { onDelete: "set null" }),
      name: varchar("name", { length: 80 }).notNull(),
      address: varchar("address", { length: 200 }).notNull(),
      description: varchar("description", { length: 2000 }).notNull(),
      latitude: doublePrecision("latitude").notNull(),
      longitude: doublePrecision("longitude").notNull(),
      categorySlug: categorySlugEnum("category_slug").notNull(),
      spaceType: varchar("space_type", { length: 8 }).notNull(),
      isFree: boolean("is_free").notNull(),
      feeNote: varchar("fee_note", { length: 160 }).notNull().default(""),
      capacity: integer("capacity"),
      tags: text("tags")
        .array()
        .notNull()
        .default(sql`ARRAY[]::text[]`),
      websiteUrl: varchar("website_url", { length: 2048 }),
      version: integer("version").notNull().default(1),
      status: contentStatusEnum("status").notNull().default("published"),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("community_venues_bounds_idx")
        .on(t.latitude, t.longitude)
        .where(sql`${t.status}='published'`),
      index("community_venues_category_idx")
        .on(t.categorySlug, t.createdAt.desc(), t.id)
        .where(sql`${t.status}='published'`),
      index("community_venues_owner_idx").on(t.ownerId),
      check("venue_name_length", sql`char_length(btrim(${t.name})) between 2 and 80`),
      check("venue_address_length", sql`char_length(btrim(${t.address})) between 5 and 200`),
      check(
        "venue_description_length",
        sql`char_length(btrim(${t.description})) between 10 and 2000`,
      ),
      check(
        "venue_coordinate_range",
        sql`${t.latitude} between -90 and 90 and ${t.longitude} between -180 and 180`,
      ),
      check(
        "venue_category",
        sql`${t.categorySlug}::text in ('travel','dating','race','mind-games','survival','music','sports','cooking','party')`,
      ),
      check("venue_space_type", sql`${t.spaceType} in ('indoor','outdoor','mixed')`),
      check("venue_capacity", sql`${t.capacity} is null or ${t.capacity} between 1 and 5000`),
      check("venue_tags_limit", sql`cardinality(${t.tags}) <= 5`),
      check(
        "venue_website_url",
        sql`${t.websiteUrl} is null or ${t.websiteUrl} ~ '^https?://[^[:space:]]+$'`,
      ),
      check("venue_version", sql`${t.version} > 0`),
      check("venue_deleted_state", sql`(${t.status}='deleted')=(${t.deletedAt} is not null)`),
    ],
  )
  .enableRLS();
export const venueRecommendations = sliper
  .table(
    "venue_recommendations",
    {
      venueId: uuid("venue_id")
        .notNull()
        .references(() => communityVenues.id, { onDelete: "cascade" }),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.venueId, t.userId] }),
      index("venue_recommendations_user_idx").on(t.userId),
    ],
  )
  .enableRLS();

// Links are created only by an explicit registered-place selection; coordinates never infer one.
export const eventVenueLinks = sliper
  .table(
    "event_venue_links",
    {
      postId: uuid("post_id")
        .primaryKey()
        .references(() => posts.id, { onDelete: "cascade" }),
      venueId: uuid("venue_id")
        .notNull()
        .references(() => communityVenues.id, { onDelete: "restrict" }),
      snapshot: jsonb("snapshot").$type<RegisteredVenueSnapshot>().notNull(),
    },
    (t) => [
      index("event_venue_links_venue_idx").on(t.venueId, t.postId),
      check(
        "event_venue_snapshot_identity",
        sql`jsonb_typeof(${t.snapshot})='object' and coalesce(${t.snapshot}->>'id'=${t.venueId}::text,false)`,
      ),
    ],
  )
  .enableRLS();
