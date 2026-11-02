import { z } from "zod";
export const TOWN_CAPACITY = 8;
export const TOWN_CHAT_TTL = 30 * 60_000;
export const TOWN_RECONNECT_MS = 30_000;
export const TOWN_SPEED = 6;
export const TOWN_BOUNDS = 249;
export const TOWN_SEATS = [
  { id: "shade-a", x: -8, z: 5, yaw: Math.PI / 2 },
  { id: "shade-b", x: -8, z: 7, yaw: Math.PI / 2 },
  { id: "garden-a", x: 8, z: 5, yaw: -Math.PI / 2 },
  { id: "garden-b", x: 8, z: 7, yaw: -Math.PI / 2 },
] as const;
export const TOWN_OBSTACLES = [
  { x: 0, z: 0, radius: 2.7 },
  { x: -10, z: -9, radius: 2.8 },
  { x: 10, z: -9, radius: 2.3 },
  ...[-12, 12].flatMap((x) => [-3, 5, 11].map((z) => ({ x, z, radius: 1 }))),
] as const;
export type TownAvatar = {
  id: string;
  nickname: string;
  color: number;
  x: number;
  z: number;
  yaw: number;
  sequence: number;
  moving: boolean;
  online: boolean;
  seat: string | null;
  wavingUntil: number;
};
export type TownChat = {
  id: string;
  author: string;
  nickname: string;
  text: string;
  channel: "world" | "nearby";
  at: number;
};
export type TownSnapshot = {
  type: "state";
  plaza: "sunny";
  me: string;
  now: number;
  capacity: number;
  occupancy: number;
  players: TownAvatar[];
  messages: TownChat[];
};
export type TownMessage = TownSnapshot | { type: "error"; message: string };
export const townInputSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("move"),
    x: z.number().finite().min(-1).max(1),
    z: z.number().finite().min(-1).max(1),
  }),
  z.strictObject({
    type: z.literal("input"),
    sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    moveX: z.number().finite().min(-1).max(1),
    moveZ: z.number().finite().min(-1).max(1),
    rotationY: z.number().finite().min(-Math.PI).max(Math.PI),
    clientTick: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("report"),
    sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    position: z.strictObject({
      x: z.number().finite(),
      y: z.number().finite(),
      z: z.number().finite(),
    }),
    rotationY: z.number().finite().min(-Math.PI).max(Math.PI),
  }),
  z.strictObject({
    type: z.literal("chat"),
    channel: z.enum(["world", "nearby"]).default("world"),
    text: z.string().trim().min(1).max(240),
  }),
  z.strictObject({ type: z.literal("wave") }),
  z.strictObject({
    type: z.literal("sit"),
    seat: z.enum(["shade-a", "shade-b", "garden-a", "garden-b"]),
  }),
  z.strictObject({ type: z.literal("stand") }),
  z.strictObject({ type: z.literal("leave") }),
  z.strictObject({ type: z.literal("auth"), ticket: z.string().min(20).max(2048) }),
]);
export type TownInput = z.infer<typeof townInputSchema>;
export function townWalkable(x: number, z: number) {
  return (
    Math.abs(x) <= TOWN_BOUNDS &&
    Math.abs(z) <= TOWN_BOUNDS &&
    !TOWN_OBSTACLES.some((o) => Math.hypot(x - o.x, z - o.z) < o.radius)
  );
}
