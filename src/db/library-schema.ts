import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sliper, profiles, categorySlugEnum, categories, posts, eventRecords } from "./schema";
import type {
  LibraryInput,
  LibraryPayload,
  TemplateSnapshot,
  LibraryDiscoveryMetadata,
} from "../domain/library";
import type { PurchaseSnapshot } from "../domain/library-market";
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
export const libraryEntries = sliper
  .table(
    "library_entries",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      ownerId: uuid("owner_id").references(() => profiles.id, { onDelete: "set null" }),
      kind: varchar("kind", { length: 16 }).notNull(),
      categorySlug: categorySlugEnum("category_slug")
        .notNull()
        .references(() => categories.slug),
      title: varchar("title", { length: 120 }).notNull(),
      summary: varchar("summary", { length: 600 }).notNull(),
      eventPlan: jsonb("event_plan").$type<LibraryPayload["eventPlan"]>(),
      discoveryMetadata: jsonb("discovery_metadata").$type<LibraryDiscoveryMetadata>(),
      scenario: text("scenario").notNull(),
      rules: text("rules").notNull(),
      hostGuide: text("host_guide").notNull(),
      materials: text("materials").array().notNull(),
      rounds: jsonb("rounds").$type<LibraryPayload["rounds"]>().notNull(),
      tags: text("tags").array().notNull(),
      minPlayers: integer("min_players").notNull(),
      maxPlayers: integer("max_players").notNull(),
      durationMinutes: integer("duration_minutes").notNull(),
      priceKRW: integer("price_krw").notNull().default(0),
      purchaseUrl: varchar("purchase_url", { length: 2048 }),
      publishedVersion: integer("published_version").notNull().default(0),
      draftContent: jsonb("draft_content").$type<LibraryInput>(),
      sourceVersionId: uuid("source_version_id").references((): AnyPgColumn => libraryVersions.id, {
        onDelete: "restrict",
      }),
      sourceRecordPostId: uuid("source_record_post_id").references(() => eventRecords.postId, {
        onDelete: "restrict",
      }),
      allowDerivatives: boolean("allow_derivatives").notNull().default(false),
      allowCommercialUse: boolean("allow_commercial_use").notNull().default(false),
      usageTerms: varchar("usage_terms", { length: 2000 })
        .notNull()
        .default("작성자의 이용 조건을 확인해주세요."),
      sample: boolean("sample").notNull().default(false),
      status: varchar("status", { length: 16 }).notNull().default("published"),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      index("library_feed_idx").on(t.kind, t.createdAt.desc(), t.id.desc()),
      index("library_owner_idx").on(t.ownerId),
      uniqueIndex("library_record_owner_draft_unique")
        .on(t.sourceRecordPostId, t.ownerId)
        .where(sql`${t.sourceRecordPostId} is not null and ${t.status} <> 'deleted'`),
      check(
        "library_event_plan",
        sql`${t.eventPlan} is null or (jsonb_typeof(${t.eventPlan}) = 'object' and octet_length(${t.eventPlan}::text) <= 150000)`,
      ),
      check(
        "library_discovery_metadata",
        sql`${t.discoveryMetadata} is null or coalesce((jsonb_typeof(${t.discoveryMetadata}) = 'object'
          and ${t.discoveryMetadata} ?& array['preparationDifficulty','environment','requiredStaff']
          and (${t.discoveryMetadata} - array['preparationDifficulty','environment','requiredStaff']) = '{}'::jsonb
          and (${t.discoveryMetadata}->'preparationDifficulty' = 'null'::jsonb or ${t.discoveryMetadata}->>'preparationDifficulty' in ('easy','standard','advanced'))
          and (${t.discoveryMetadata}->'environment' = 'null'::jsonb or ${t.discoveryMetadata}->>'environment' in ('indoor','outdoor','mixed'))
          and (${t.discoveryMetadata}->'requiredStaff' = 'null'::jsonb or (jsonb_typeof(${t.discoveryMetadata}->'requiredStaff') = 'number'
            and ${t.discoveryMetadata}->'requiredStaff' >= '0'::jsonb and ${t.discoveryMetadata}->'requiredStaff' <= '100'::jsonb
            and ${t.discoveryMetadata}->>'requiredStaff' ~ '^[0-9]+$'))), false)`,
      ),
      check("library_kind", sql`${t.kind} in ('rulebook','template')`),
      check("library_status", sql`${t.status} in ('draft','published','deleted')`),
      check(
        "library_players",
        sql`${t.minPlayers} between 1 and 5000 and ${t.maxPlayers} between ${t.minPlayers} and 5000`,
      ),
      check("library_duration", sql`${t.durationMinutes} between 5 and 1440`),
      check(
        "library_content_size",
        sql`char_length(btrim(${t.title})) between 2 and 120 and char_length(${t.scenario}) between 20 and 10000 and char_length(${t.rules}) between 10 and 8000 and char_length(${t.hostGuide}) between 10 and 8000`,
      ),
      check(
        "library_arrays",
        sql`cardinality(${t.materials}) <= 40 and cardinality(${t.tags}) <= 5 and jsonb_typeof(${t.rounds}) = 'array' and jsonb_array_length(${t.rounds}) between 1 and 20`,
      ),
      check(
        "library_distribution",
        sql`${t.priceKRW} between 0 and 1000000 and ((${t.priceKRW} = 0 and ${t.purchaseUrl} is null) or (${t.priceKRW} > 0 and ${t.purchaseUrl} is not null and ${t.purchaseUrl} ~ '^https?://[^[:space:]]+$'))`,
      ),
    ],
  )
  .enableRLS();
export const libraryVersions = sliper
  .table(
    "library_versions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      entryId: uuid("entry_id")
        .notNull()
        .references((): AnyPgColumn => libraryEntries.id, { onDelete: "cascade" }),
      number: integer("number").notNull(),
      content: jsonb("content").$type<LibraryInput>().notNull(),
      changeSummary: varchar("change_summary", { length: 1000 }).notNull(),
      sourceVersionId: uuid("source_version_id").references((): AnyPgColumn => libraryVersions.id, {
        onDelete: "restrict",
      }),
      sourceRecordPostId: uuid("source_record_post_id").references(() => eventRecords.postId, {
        onDelete: "restrict",
      }),
      publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
      publisherId: uuid("publisher_id").references(() => profiles.id, { onDelete: "set null" }),
      legacy: boolean("legacy").notNull().default(false),
    },
    (t) => [
      unique("library_version_number_unique").on(t.entryId, t.number),
      index("library_version_source_idx").on(t.sourceVersionId),
      check("library_version_number", sql`${t.number} > 0`),
    ],
  )
  .enableRLS();

export const libraryAccessRequests = sliper
  .table(
    "library_access_requests",
    {
      entryId: uuid("entry_id")
        .notNull()
        .references(() => libraryEntries.id, { onDelete: "restrict" }),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      externalReference: varchar("external_reference", { length: 160 }).notNull(),
      amountKRW: integer("amount_krw").notNull(),
      note: varchar("note", { length: 500 }).notNull().default(""),
      decisionNote: varchar("decision_note", { length: 500 }).notNull().default(""),
      status: varchar("status", { length: 16 }).notNull().default("pending"),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      primaryKey({ columns: [t.entryId, t.userId] }),
      unique("library_purchase_reference_unique").on(t.entryId, t.externalReference),
      index("library_access_user_idx").on(t.userId),
      check(
        "library_access_status",
        sql`${t.status} in ('pending','approved','rejected','revoked')`,
      ),
      check("library_access_price", sql`${t.amountKRW} between 1 and 1000000`),
    ],
  )
  .enableRLS();
export const templateProvenance = sliper
  .table(
    "template_provenance",
    {
      postId: uuid("post_id")
        .primaryKey()
        .references(() => posts.id, { onDelete: "cascade" }),
      entryId: uuid("entry_id").references(() => libraryEntries.id, { onDelete: "set null" }),
      versionId: uuid("version_id").references(() => libraryVersions.id, { onDelete: "restrict" }),
      snapshot: jsonb("snapshot").$type<TemplateSnapshot>().notNull(),
      createdAt: createdAt(),
    },
    (t) => [index("template_source_idx").on(t.entryId)],
  )
  .enableRLS();

export const librarySuggestions = sliper
  .table(
    "library_suggestions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      entryId: uuid("entry_id")
        .notNull()
        .references(() => libraryEntries.id, { onDelete: "cascade" }),
      baseVersionId: uuid("base_version_id")
        .notNull()
        .references(() => libraryVersions.id, { onDelete: "restrict" }),
      proposerId: uuid("proposer_id").references(() => profiles.id, { onDelete: "set null" }),
      field: varchar("field", { length: 16 }).notNull(),
      replacement: text("replacement").notNull(),
      reason: varchar("reason", { length: 1000 }).notNull(),
      status: varchar("status", { length: 16 }).notNull().default("pending"),
      decisionNote: varchar("decision_note", { length: 1000 }).notNull().default(""),
      decidedBy: uuid("decided_by").references(() => profiles.id, { onDelete: "set null" }),
      decidedAt: timestamp("decided_at", { withTimezone: true }),
      publishedVersionId: uuid("published_version_id").references(() => libraryVersions.id, {
        onDelete: "restrict",
      }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      index("library_suggestions_queue_idx").on(t.entryId, t.createdAt.desc(), t.id),
      uniqueIndex("library_pending_suggestion_unique")
        .on(t.entryId, t.baseVersionId, t.proposerId, t.field)
        .where(sql`${t.status}='pending'`),
      check(
        "library_suggestion_field",
        sql`${t.field} in ('title','summary','scenario','rules','hostGuide')`,
      ),
      check(
        "library_suggestion_state",
        sql`${t.status} in ('pending','approved','rejected','withdrawn') and (${t.status}='pending')=(${t.decidedAt} is null) and (${t.status}='approved')=(${t.publishedVersionId} is not null)`,
      ),
      check(
        "library_suggestion_size",
        sql`char_length(${t.replacement}) between 2 and 10000 and char_length(btrim(${t.reason})) between 10 and 1000`,
      ),
    ],
  )
  .enableRLS();
export const libraryDiscussionLinks = sliper
  .table(
    "library_discussion_links",
    {
      entryId: uuid("entry_id")
        .notNull()
        .references(() => libraryEntries.id, { onDelete: "cascade" }),
      postId: uuid("post_id")
        .notNull()
        .references(() => posts.id, { onDelete: "cascade" }),
      versionId: uuid("version_id")
        .notNull()
        .references(() => libraryVersions.id, { onDelete: "restrict" }),
      createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
      createdAt: createdAt(),
    },
    (t) => [
      primaryKey({ columns: [t.entryId, t.postId, t.versionId] }),
      index("library_discussion_post_idx").on(t.postId),
    ],
  )
  .enableRLS();

// Immutable purchase snapshots are financial metadata; edition bodies remain in library_versions.
export const libraryPurchases = sliper
  .table(
    "library_purchases",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      entryId: uuid("entry_id")
        .notNull()
        .references(() => libraryEntries.id, { onDelete: "restrict" }),
      versionId: uuid("version_id")
        .notNull()
        .references(() => libraryVersions.id, { onDelete: "restrict" }),
      buyerId: uuid("buyer_id").references(() => profiles.id, { onDelete: "set null" }),
      sellerId: uuid("seller_id").references(() => profiles.id, { onDelete: "set null" }),
      snapshot: jsonb("snapshot").$type<PurchaseSnapshot>().notNull(),
      externalReference: varchar("external_reference", { length: 160 }).notNull(),
      note: varchar("note", { length: 500 }).notNull().default(""),
      amountKRW: integer("amount_krw").notNull(),
      status: varchar("status", { length: 16 }).notNull().default("pending"),
      provider: varchar("provider", { length: 80 }),
      paymentId: varchar("payment_id", { length: 160 }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      unique("library_order_reference_unique").on(t.entryId, t.externalReference),
      uniqueIndex("library_order_active_unique")
        .on(t.entryId, t.buyerId)
        .where(sql`${t.status} in ('pending','paid')`),
      uniqueIndex("library_order_payment_unique")
        .on(t.provider, t.paymentId)
        .where(sql`${t.paymentId} is not null`),
      index("library_order_buyer_idx").on(t.buyerId, t.createdAt.desc(), t.id),
      index("library_order_seller_idx").on(t.sellerId, t.createdAt.desc(), t.id),
      check("library_order_price", sql`${t.amountKRW} between 1 and 1000000`),
      check(
        "library_order_status",
        sql`${t.status} in ('pending','paid','rejected','revoked','refunded')`,
      ),
      check("library_order_payment_pair", sql`(${t.provider} is null)=(${t.paymentId} is null)`),
      check(
        "library_order_reference_size",
        sql`char_length(btrim(${t.externalReference})) between 3 and 160`,
      ),
    ],
  )
  .enableRLS();
export const libraryPurchaseAudit = sliper
  .table(
    "library_purchase_audit",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      purchaseId: uuid("purchase_id")
        .notNull()
        .references(() => libraryPurchases.id, { onDelete: "restrict" }),
      actorId: uuid("actor_id").references(() => profiles.id, { onDelete: "set null" }),
      action: varchar("action", { length: 40 }).notNull(),
      note: varchar("note", { length: 1000 }).notNull(),
      createdAt: createdAt(),
    },
    (t) => [index("library_order_audit_idx").on(t.purchaseId, t.createdAt.desc(), t.id)],
  )
  .enableRLS();
export const libraryWebhookReceipts = sliper
  .table(
    "library_webhook_receipts",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      provider: varchar("provider", { length: 80 }).notNull(),
      eventId: varchar("event_id", { length: 160 }).notNull(),
      payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
      purchaseId: uuid("purchase_id")
        .notNull()
        .references(() => libraryPurchases.id, { onDelete: "restrict" }),
      status: varchar("status", { length: 16 }).notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      unique("library_webhook_event_unique").on(t.provider, t.eventId),
      check("library_receipt_hash", sql`${t.payloadHash} ~ '^[a-f0-9]{64}$'`),
    ],
  )
  .enableRLS();
export const libraryPurchaseDisputes = sliper
  .table(
    "library_purchase_disputes",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      purchaseId: uuid("purchase_id")
        .notNull()
        .references(() => libraryPurchases.id, { onDelete: "restrict" }),
      requesterId: uuid("requester_id").references(() => profiles.id, { onDelete: "set null" }),
      kind: varchar("kind", { length: 16 }).notNull(),
      body: text("body").notNull(),
      sellerResponse: text("seller_response").notNull().default(""),
      status: varchar("status", { length: 16 }).notNull().default("open"),
      outcome: varchar("outcome", { length: 20 }),
      resolutionNote: varchar("resolution_note", { length: 1000 }).notNull().default(""),
      resolvedBy: uuid("resolved_by").references(() => profiles.id, { onDelete: "set null" }),
      resolvedAt: timestamp("resolved_at", { withTimezone: true }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex("library_order_open_dispute_unique")
        .on(t.purchaseId)
        .where(sql`${t.status}='open'`),
      index("library_dispute_queue_idx").on(t.status, t.createdAt.desc(), t.id),
      check("library_dispute_kind", sql`${t.kind} in ('delivery','terms','payment','other')`),
      check(
        "library_dispute_state",
        sql`${t.status} in ('open','resolved','withdrawn') and (${t.status}='open')=(${t.resolvedAt} is null) and (${t.status}='resolved')=(${t.outcome} is not null)`,
      ),
      check(
        "library_dispute_outcome",
        sql`${t.outcome} in ('no_action','revoke','refund_confirmed')`,
      ),
      check(
        "library_dispute_body_size",
        sql`char_length(btrim(${t.body})) between 10 and 3000 and char_length(${t.sellerResponse}) <= 3000`,
      ),
    ],
  )
  .enableRLS();
