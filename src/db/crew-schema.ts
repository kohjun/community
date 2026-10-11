import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sliper, profiles, categories, categorySlugEnum, posts } from "./schema";
import { eventResults } from "./player-schema";
import { eventAdmissions } from "./event-operations-schema";
const stamp = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const crews = sliper
  .table(
    "crews",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      ownerId: uuid("owner_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "restrict" }),
      name: varchar("name", { length: 40 }).notNull(),
      description: text("description").notNull(),
      categorySlug: categorySlugEnum("category_slug")
        .notNull()
        .references(() => categories.slug),
      region: varchar("region", { length: 80 }).notNull().default(""),
      capacity: integer("capacity").notNull().default(20),
      recruiting: boolean("recruiting").notNull().default(true),
      status: varchar("status", { length: 16 }).notNull().default("active"),
      createdAt: stamp(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("crews_feed_idx").on(t.status, t.createdAt.desc(), t.id),
      index("crews_owner_idx").on(t.ownerId),
      check(
        "crews_content",
        sql`char_length(btrim(${t.name})) between 2 and 40 and char_length(${t.description}) between 10 and 2000`,
      ),
      check("crews_capacity", sql`${t.capacity} between 2 and 100`),
      check("crews_status", sql`${t.status} in ('active','archived')`),
    ],
  )
  .enableRLS();
export const crewMembers = sliper
  .table(
    "crew_members",
    {
      crewId: uuid("crew_id")
        .notNull()
        .references(() => crews.id, { onDelete: "cascade" }),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      role: varchar("role", { length: 16 }).notNull().default("member"),
      createdAt: stamp(),
    },
    (t) => [
      primaryKey({ columns: [t.crewId, t.userId] }),
      index("crew_members_user_idx").on(t.userId, t.crewId),
      check("crew_members_role", sql`${t.role} in ('manager','member')`),
    ],
  )
  .enableRLS();
export const crewJoinRequests = sliper
  .table(
    "crew_join_requests",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      crewId: uuid("crew_id")
        .notNull()
        .references(() => crews.id, { onDelete: "cascade" }),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      message: varchar("message", { length: 500 }).notNull(),
      status: varchar("status", { length: 16 }).notNull().default("pending"),
      decisionBy: uuid("decision_by").references(() => profiles.id, { onDelete: "set null" }),
      createdAt: stamp(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      unique("crew_join_request_user").on(t.crewId, t.userId),
      index("crew_join_queue_idx").on(t.crewId, t.status, t.createdAt, t.id),
      check(
        "crew_join_request_status",
        sql`${t.status} in ('pending','approved','rejected','withdrawn')`,
      ),
      check("crew_join_message", sql`char_length(btrim(${t.message})) between 2 and 500`),
    ],
  )
  .enableRLS();
export const crewEvents = sliper
  .table(
    "crew_events",
    {
      crewId: uuid("crew_id")
        .notNull()
        .references(() => crews.id, { onDelete: "cascade" }),
      postId: uuid("post_id")
        .notNull()
        .references(() => posts.id, { onDelete: "restrict" }),
      linkedBy: uuid("linked_by").references(() => profiles.id, { onDelete: "set null" }),
      createdAt: stamp(),
    },
    (t) => [
      primaryKey({ columns: [t.crewId, t.postId] }),
      index("crew_events_post_idx").on(t.postId),
    ],
  )
  .enableRLS();
export const crewActivity = sliper
  .table(
    "crew_activity",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      crewId: uuid("crew_id")
        .notNull()
        .references(() => crews.id, { onDelete: "cascade" }),
      actorId: uuid("actor_id").references(() => profiles.id, { onDelete: "set null" }),
      kind: varchar("kind", { length: 32 }).notNull(),
      message: text("message").notNull().default(""),
      createdAt: stamp(),
    },
    (t) => [
      index("crew_activity_feed_idx").on(t.crewId, t.createdAt.desc(), t.id),
      check(
        "crew_activity_kind",
        sql`${t.kind} in ('created','joined','left','removed','role_changed','ownership_transferred','updated','announcement','event_linked','event_unlinked','contribution','archived')`,
      ),
      check("crew_activity_message", sql`char_length(${t.message}) <= 2000`),
    ],
  )
  .enableRLS();
export const crewContributions = sliper
  .table(
    "crew_contributions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      crewId: uuid("crew_id").notNull(),
      postId: uuid("post_id").notNull(),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "restrict" }),
      applicationId: uuid("application_id")
        .notNull()
        .references(() => eventResults.applicationId, { onDelete: "restrict" }),
      role: varchar("role", { length: 24 }).notNull(),
      note: varchar("note", { length: 500 }).notNull().default(""),
      checkedBy: uuid("checked_by").references(() => profiles.id, { onDelete: "set null" }),
      createdAt: stamp(),
    },
    (t) => [
      foreignKey({
        columns: [t.crewId, t.postId],
        foreignColumns: [crewEvents.crewId, crewEvents.postId],
        name: "crew_contributions_event_fk",
      }).onDelete("restrict"),
      unique("crew_contributions_once").on(t.crewId, t.postId, t.userId),
      foreignKey({
        columns: [t.applicationId, t.postId, t.userId],
        foreignColumns: [eventResults.applicationId, eventResults.postId, eventResults.userId],
        name: "crew_contribution_result_identity_fk",
      }).onDelete("restrict"),
      foreignKey({
        columns: [t.applicationId, t.postId, t.userId],
        foreignColumns: [
          eventAdmissions.applicationId,
          eventAdmissions.postId,
          eventAdmissions.userId,
        ],
        name: "crew_contribution_admission_identity_fk",
      }).onDelete("restrict"),
      check(
        "crew_contribution_no_self",
        sql`${t.checkedBy} is null or ${t.checkedBy}<>${t.userId}`,
      ),
      index("crew_contributions_user_idx").on(t.userId, t.createdAt.desc()),
      check(
        "crew_contributions_role",
        sql`${t.role} in ('MC','진행 스태프','기획 파트너','촬영·편집','디자인','공간·장비')`,
      ),
    ],
  )
  .enableRLS();
