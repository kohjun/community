import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { profiles, sliper } from "./schema";
const stamp = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const memberSafety = sliper
  .table(
    "member_safety",
    {
      userId: uuid("user_id")
        .primaryKey()
        .references(() => profiles.id, { onDelete: "cascade" }),
      status: varchar("status", { length: 16 }).notNull().default("active"),
      reason: varchar("reason", { length: 1000 }).notNull().default(""),
      suspendedUntil: timestamp("suspended_until", { withTimezone: true }),
      policyVersion: varchar("policy_version", { length: 20 }),
      consentAt: timestamp("consent_at", { withTimezone: true }),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [check("member_safety_status", sql`${t.status} in ('active','suspended','closed')`)],
  )
  .enableRLS();
export const staffRoles = sliper
  .table(
    "staff_roles",
    {
      userId: uuid("user_id")
        .primaryKey()
        .references(() => profiles.id, { onDelete: "cascade" }),
      role: varchar("role", { length: 16 }).notNull(),
      createdAt: stamp(),
    },
    (t) => [check("staff_role_values", sql`${t.role} in ('moderator','admin')`)],
  )
  .enableRLS();
export const safetyReports = sliper
  .table(
    "safety_reports",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      reporterId: uuid("reporter_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      targetType: varchar("target_type", { length: 16 }).notNull(),
      targetId: uuid("target_id").notNull(),
      reason: varchar("reason", { length: 24 }).notNull(),
      detail: varchar("detail", { length: 2000 }).notNull().default(""),
      snapshot: text("snapshot").notNull(),
      status: varchar("status", { length: 16 }).notNull().default("open"),
      resolution: varchar("resolution", { length: 1000 }).notNull().default(""),
      resolvedBy: uuid("resolved_by").references(() => profiles.id, { onDelete: "set null" }),
      resolvedAt: timestamp("resolved_at", { withTimezone: true }),
      createdAt: stamp(),
    },
    (t) => [
      unique("report_member_target").on(t.reporterId, t.targetType, t.targetId),
      index("report_queue_idx").on(t.status, t.createdAt),
      check(
        "report_target_type",
        sql`${t.targetType} in ('post','comment','venue','crew','player','record','library')`,
      ),
      check("report_status", sql`${t.status} in ('open','actioned','dismissed')`),
    ],
  )
  .enableRLS();
export const contentRestrictions = sliper
  .table(
    "content_restrictions",
    {
      targetType: varchar("target_type", { length: 16 }).notNull(),
      targetId: uuid("target_id").notNull(),
      hidden: boolean("hidden").notNull().default(true),
      reason: varchar("reason", { length: 1000 }).notNull(),
      updatedBy: uuid("updated_by").references(() => profiles.id, { onDelete: "set null" }),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.targetType, t.targetId] }),
      check(
        "restriction_target_type",
        sql`${t.targetType} in ('post','comment','venue','crew','record','library')`,
      ),
    ],
  )
  .enableRLS();
export const memberBlocks = sliper
  .table(
    "member_blocks",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      blockerId: uuid("blocker_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      blockedId: uuid("blocked_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      displayLabel: varchar("display_label", { length: 40 }).notNull(),
      createdAt: stamp(),
    },
    (t) => [
      unique("block_member_pair").on(t.blockerId, t.blockedId),
      check("block_not_self", sql`${t.blockerId}<>${t.blockedId}`),
    ],
  )
  .enableRLS();
export const moderationAudit = sliper
  .table(
    "moderation_audit",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      actorId: uuid("actor_id").references(() => profiles.id, { onDelete: "set null" }),
      action: varchar("action", { length: 24 }).notNull(),
      targetType: varchar("target_type", { length: 16 }).notNull(),
      targetId: uuid("target_id").notNull(),
      reason: varchar("reason", { length: 1000 }).notNull(),
      createdAt: stamp(),
    },
    (t) => [index("moderation_audit_target_idx").on(t.targetType, t.targetId, t.createdAt)],
  )
  .enableRLS();
export const requestLimits = sliper
  .table(
    "request_limits",
    {
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      action: varchar("action", { length: 24 }).notNull(),
      windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
      count: integer("count").notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.userId, t.action] }),
      check("request_limit_count", sql`${t.count}>0`),
    ],
  )
  .enableRLS();
export const supportTickets = sliper
  .table(
    "support_tickets",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      category: varchar("category", { length: 16 }).notNull(),
      subject: varchar("subject", { length: 100 }).notNull(),
      body: varchar("body", { length: 3000 }).notNull(),
      status: varchar("status", { length: 16 }).notNull().default("open"),
      createdAt: stamp(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("support_queue_idx").on(t.status, t.createdAt),
      check("support_status", sql`${t.status} in ('open','answered','closed')`),
    ],
  )
  .enableRLS();
export const supportReplies = sliper
  .table(
    "support_replies",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      ticketId: uuid("ticket_id")
        .notNull()
        .references(() => supportTickets.id, { onDelete: "cascade" }),
      authorId: uuid("author_id").references(() => profiles.id, { onDelete: "set null" }),
      body: varchar("body", { length: 3000 }).notNull(),
      createdAt: stamp(),
    },
    (t) => [index("support_reply_ticket_idx").on(t.ticketId, t.createdAt)],
  )
  .enableRLS();
