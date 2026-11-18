import type { DrawingState, ClueState } from "../domain/creative-games";
import type { TemperatureState } from "../domain/temperature-game";
import type { ToastState } from "../domain/toast-game";
import type { AuctionState } from "../domain/auction-game";
import { sql } from "drizzle-orm";
import {
  jsonb,
  check,
  index,
  integer,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  boolean,
} from "drizzle-orm/pg-core";
import { sliper, profiles } from "./schema";
import type { GamePhase, GamePlayerStatus } from "../domain/game-room";
import type { IntroState } from "../domain/mbti-intro";
import type { MbtiState } from "../domain/mbti-game";
const stamp = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();
export const gameRooms = sliper
  .table(
    "game_rooms",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      hostId: uuid("host_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      drawing: jsonb("drawing").$type<DrawingState>(),
      clue: jsonb("clue").$type<ClueState>(),
      temperature: jsonb("temperature").$type<TemperatureState>(),
      toast: jsonb("toast").$type<ToastState>(),
      auction: jsonb("auction").$type<AuctionState>(),
      intro: jsonb("mbti_intro").$type<IntroState>(),
      mbti: jsonb("mbti").$type<MbtiState>(),
      title: varchar("title", { length: 60 }).notNull(),
      capacity: integer("capacity").notNull(),
      minPlayers: integer("min_players").notNull(),
      phase: varchar("phase", { length: 12 }).$type<GamePhase>().notNull().default("lobby"),
      revision: integer("revision").notNull().default(0),
      round: integer("round").notNull().default(1),
      nextTicket: integer("next_ticket").notNull().default(1),
      startedAt: timestamp("started_at", { withTimezone: true }),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      createdAt: stamp("created_at"),
    },
    (t) => [
      index("game_rooms_host_created").on(t.hostId, t.createdAt),
      index("game_rooms_expiry").on(t.expiresAt),
      check(
        "game_room_bounds",
        sql`${t.capacity} between 2 and 30 and ${t.minPlayers} between 2 and ${t.capacity} and ${t.revision} >= 0 and ${t.round} > 0 and ${t.nextTicket} > 0`,
      ),
      check("game_room_phase", sql`${t.phase} in ('lobby','playing','finished','closed')`),
      check(
        "game_room_start",
        sql`${t.phase} not in ('playing','finished') or ${t.startedAt} is not null`,
      ),
    ],
  )
  .enableRLS();
export const gamePlayers = sliper
  .table(
    "game_players",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      roomId: uuid("room_id")
        .notNull()
        .references(() => gameRooms.id, { onDelete: "cascade" }),
      identityHash: varchar("identity_hash", { length: 64 }).notNull(),
      ticket: integer("ticket").notNull(),
      status: varchar("status", { length: 12 }).$type<GamePlayerStatus>().notNull(),
      nickname: varchar("nickname", { length: 16 }),
      ready: boolean("ready").notNull().default(false),
      lastSeenAt: stamp("last_seen_at"),
      joinedAt: stamp("joined_at"),
    },
    (t) => [
      uniqueIndex("game_player_identity").on(t.roomId, t.identityHash),
      uniqueIndex("game_player_ticket").on(t.roomId, t.ticket),
      uniqueIndex("game_player_nickname")
        .on(t.roomId, sql`lower(${t.nickname})`)
        .where(sql`${t.status} = 'admitted' and ${t.nickname} is not null`),
      index("game_player_queue").on(t.roomId, t.status, t.ticket),
      check("game_player_status", sql`${t.status} in ('waiting','admitted','left','kicked')`),
      check(
        "game_player_ready",
        sql`not ${t.ready} or (${t.status} = 'admitted' and ${t.nickname} is not null)`,
      ),
      check("game_player_hash", sql`${t.identityHash} ~ '^[a-f0-9]{64}$'`),
      check("game_player_ticket_positive", sql`${t.ticket} > 0`),
    ],
  )
  .enableRLS();
// Separate guest limits have no account FK. Raw IPs, device IDs and cookie tokens are never stored.
export const gameRequestLimits = sliper
  .table(
    "game_request_limits",
    {
      roomId: uuid("room_id")
        .notNull()
        .references(() => gameRooms.id, { onDelete: "cascade" }),
      subjectHash: varchar("subject_hash", { length: 64 }).notNull(),
      windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
      count: integer("count").notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.roomId, t.subjectHash] }),
      check("game_limit_count", sql`${t.count} > 0`),
    ],
  )
  .enableRLS();

// Room-scoped media stays separate from public posts; orphaned parents are cleaned durably.
export const gameRuns = sliper
  .table(
    "game_runs",
    {
      id: uuid("id").primaryKey(),
      roomId: uuid("room_id").references(() => gameRooms.id, { onDelete: "set null" }),
      hostId: uuid("host_id").references(() => profiles.id, { onDelete: "set null" }),
      title: varchar("title", { length: 60 }).notNull(),
      members: jsonb("members").$type<Record<string, string>>().notNull(),
      content: jsonb("content")
        .$type<{ drawing: DrawingState | null; clue: ClueState | null }>()
        .notNull(),
      startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
      endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    },
    (t) => [
      index("game_runs_expiry").on(t.expiresAt),
      index("game_runs_room").on(t.roomId, t.endedAt),
    ],
  )
  .enableRLS();
export const gameAssets = sliper
  .table(
    "game_assets",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      roomId: uuid("room_id").references(() => gameRooms.id, { onDelete: "set null" }),
      runId: uuid("run_id"),
      uploaderHash: varchar("uploader_hash", { length: 64 }).notNull(),
      phaseId: uuid("phase_id"),
      kind: varchar("kind", { length: 12 })
        .$type<"drawing" | "photo" | "audio" | "video">()
        .notNull(),
      status: varchar("status", { length: 12 })
        .$type<"ready" | "queued" | "processing" | "failed">()
        .notNull(),
      storageBackend: varchar("storage_backend", { length: 12 })
        .$type<"local" | "supabase">()
        .notNull(),
      objectKey: varchar("object_key", { length: 48 }).notNull(),
      sourceKey: varchar("source_key", { length: 48 }),
      contentType: varchar("content_type", { length: 40 }).notNull(),
      byteSize: integer("byte_size").notNull(),
      attempts: integer("attempts").notNull().default(0),
      lockToken: uuid("lock_token"),
      leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      createdAt: stamp("created_at"),
    },
    (t) => [
      index("game_assets_room_owner").on(t.roomId, t.uploaderHash),
      index("game_assets_cleanup").on(t.expiresAt),
      index("game_assets_jobs").on(t.status, t.createdAt),
      check("game_assets_kind", sql`${t.kind} in ('drawing','photo','audio','video')`),
      check("game_assets_status", sql`${t.status} in ('ready','queued','processing','failed')`),
      check("game_assets_backend", sql`${t.storageBackend} in ('local','supabase')`),
      check(
        "game_assets_size",
        sql`${t.byteSize}>0 and ${t.byteSize}<=26214400 and ${t.attempts}>=0`,
      ),
      check("game_assets_owner", sql`${t.uploaderHash} ~ '^[a-f0-9]{64}$'`),
    ],
  )
  .enableRLS();
