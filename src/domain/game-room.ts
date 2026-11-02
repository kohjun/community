import type { ToastView } from "./toast-game";
import type { AuctionView } from "./auction-game";
import { WORD_CATEGORY_IDS, WORD_MODES } from "./word-liar";
import type { IntroView } from "./mbti-intro";
import { MBTI_TYPES, type MbtiView } from "./mbti-game";
import { z } from "zod";
export const GAME_LEASE_MS = 120_000;
export const GAME_ROOM_TTL_MS = 24 * 60 * 60 * 1000;
export const GAME_MAX_QUEUE = 100;
export const gameRoomId = z.uuid().transform((s) => s.toLowerCase());
const cleanText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .normalize()
    .min(min)
    .max(max)
    .refine(
      (s) => !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(s),
      "보이지 않는 문자나 줄바꿈을 제외해주세요.",
    );
export const createGameRoomSchema = z
  .object({
    gameType: z
      .enum(["lobby", "mbti", "mbti-intro", "word-liar", "auction", "toast"])
      .default("lobby"),
    toastMode: z.enum(["basic", "target"]).default("basic"),
    toastRounds: z.number().int().min(1).max(10).default(2),
    toastAnswerSeconds: z
      .union([z.literal(15), z.literal(30), z.literal(60), z.literal(90)])
      .default(30),
    auctionRounds: z.number().int().min(4).max(120).default(12),
    auctionInitialMoney: z.number().int().min(500).max(10000).multipleOf(100).default(1000),
    auctionBidSeconds: z
      .union([z.literal(30), z.literal(60), z.literal(90), z.literal(120)])
      .default(60),
    wordCategory: z.enum(WORD_CATEGORY_IDS).default("food"),
    wordMode: z.enum(WORD_MODES).default("classic"),
    maxRounds: z.number().int().min(1).max(10).default(5),
    revealLiar: z.boolean().default(false),
    title: cleanText(2, 60),
    capacity: z.number().int().min(2).max(30).default(8),
    minPlayers: z.number().int().min(2).max(30).default(2),
  })
  .strict()
  .refine((v) => v.minPlayers <= v.capacity, "최소 인원은 정원 이하여야 해요.")
  .refine(
    (v) => v.gameType !== "auction" || v.auctionRounds > v.minPlayers,
    "경매 라운드 수는 최소 참가 인원보다 많아야 해요.",
  );
export type GameRoomSettings = z.output<typeof createGameRoomSchema>;
export const gamePlayerActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("toast-question"),
      turn: z.number().int().min(1).max(300),
      question: cleanText(5, 160),
    })
    .strict(),
  z
    .object({
      action: z.literal("toast-answer"),
      turn: z.number().int().min(1).max(300),
      cheers: z.boolean(),
      prediction: z.number().int().min(0).max(30).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("toast-last-word"),
      turn: z.number().int().min(1).max(300),
      targetId: gameRoomId,
    })
    .strict(),
  z
    .object({
      action: z.literal("auction-bid"),
      round: z.number().int().min(1).max(120),
      amount: z.number().int().min(10).max(1_000_000).multipleOf(10),
    })
    .strict(),
  z
    .object({
      action: z.literal("word-guess"),
      cycle: z.number().int().positive(),
      guess: cleanText(1, 40),
    })
    .strict(),
  z
    .object({
      action: z.literal("intro-turn-done"),
      round: z.number().int().positive(),
      turn: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      action: z.literal("intro-profile"),
      nickname: cleanText(2, 16),
      mbti: z.enum(MBTI_TYPES),
      shareAtEnd: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal("intro-submit"),
      round: z.number().int().min(1).max(10),
      guesses: z
        .array(z.object({ playerId: gameRoomId, mbti: z.enum(MBTI_TYPES) }).strict())
        .min(1)
        .max(29),
    })
    .strict(),
  z
    .object({
      action: z.literal("mbti-vote"),
      cycle: z.number().int().positive(),
      target: gameRoomId.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("mbti-guess"),
      cycle: z.number().int().positive(),
      guess: z.enum(MBTI_TYPES),
    })
    .strict(),
  z.object({ action: z.literal("nickname"), nickname: cleanText(2, 16) }).strict(),
  z.object({ action: z.literal("ready"), ready: z.boolean() }).strict(),
  z.object({ action: z.literal("leave") }).strict(),
  z.object({ action: z.literal("heartbeat") }).strict(),
]);
const revision = z.number().int().nonnegative();
export const gameHostActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("settings"),
      settingsVersion: z.string().regex(/^[a-f0-9]{64}$/),
      settings: createGameRoomSchema,
    })
    .strict(),
  z
    .object({ action: z.literal("toast-next"), revision, turn: z.number().int().min(1).max(300) })
    .strict(),
  z
    .object({ action: z.literal("toast-skip"), revision, turn: z.number().int().min(1).max(300) })
    .strict(),
  z
    .object({ action: z.literal("auction-open"), revision, round: z.number().int().positive() })
    .strict(),
  z
    .object({ action: z.literal("auction-close"), revision, round: z.number().int().positive() })
    .strict(),
  z
    .object({ action: z.literal("auction-next"), revision, round: z.number().int().positive() })
    .strict(),
  z.object({ action: z.literal("intro-next-turn"), revision }).strict(),
  z.object({ action: z.literal("intro-next"), revision }).strict(),
  z.object({ action: z.literal("intro-end-round"), revision }).strict(),
  z.object({ action: z.literal("mbti-next"), revision }).strict(),
  z.object({ action: z.literal("mbti-tally"), revision }).strict(),
  z.object({ action: z.literal("start"), revision }).strict(),
  z.object({ action: z.literal("finish"), revision }).strict(),
  z.object({ action: z.literal("reset"), revision }).strict(),
  z.object({ action: z.literal("close"), revision }).strict(),
  z.object({ action: z.literal("kick"), revision, playerId: gameRoomId }).strict(),
]);
export type GamePhase = "lobby" | "playing" | "finished" | "closed";
export type GamePlayerStatus = "waiting" | "admitted" | "left" | "kicked";
export type GameRoomView = {
  settings?: GameRoomSettings | null;
  settingsVersion?: string | null;
  gameType?: "lobby" | "mbti" | "mbti-intro" | "word-liar" | "auction" | "toast";
  toast?: ToastView | null;
  auction?: AuctionView | null;
  mbtiIntro?: IntroView | null;
  mbti?: MbtiView | null;
  id: string;
  title: string;
  capacity: number;
  minPlayers: number;
  phase: GamePhase;
  revision: number;
  round: number;
  startedAt: string | null;
  expiresAt: string;
  isHost: boolean;
  canStart: boolean;
  waitingCount: number;
  readyCount: number;
  viewer: {
    id: string | null;
    status: GamePlayerStatus | "host" | "new";
    nickname: string | null;
    ready: boolean;
    queuePosition: number | null;
  };
  players: { id: string; nickname: string | null; ready: boolean; online: boolean }[];
  waiting: { id: string; position: number }[];
};
