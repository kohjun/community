import { createClient } from "redis";
import { pollingRoomWakeBus, RoomRealtimeHub, type RoomWakeBus } from "./room-realtime-core";

const processState = globalThis as typeof globalThis & {
  sliperRoomRealtime?: RoomWakeBus;
  sliperRoomRedisWarningAt?: number;
};
function warn() {
  const now = Date.now();
  if (now - (processState.sliperRoomRedisWarningAt ?? 0) < 30_000) return;
  processState.sliperRoomRedisWarningAt = now;
  // Error objects and connection URLs may contain credentials, so never log them.
  console.warn("Sliper room realtime: Redis unavailable; database reconciliation remains active.");
}
export function roomRealtime(): RoomWakeBus {
  if (processState.sliperRoomRealtime) return processState.sliperRoomRealtime;
  const url = process.env.REDIS_URL?.trim();
  if (!url) return pollingRoomWakeBus;
  const hub = new RoomRealtimeHub(() => {
    const protocol = new URL(url).protocol;
    if (protocol !== "redis:" && protocol !== "rediss:") throw new Error("Invalid Redis protocol");
    const publisher = createClient({
      url,
      disableOfflineQueue: true,
      commandsQueueMaxLength: 1_000,
      commandOptions: { timeout: 450 },
      pingInterval: 5_000,
      socket: {
        connectTimeout: 1_000,
        socketTimeout: 10_000,
        reconnectStrategy: (retries) => Math.min(250 * 2 ** Math.min(retries, 5), 5_000),
      },
    });
    return { publisher, subscriber: publisher.duplicate() };
  }, warn);
  processState.sliperRoomRealtime = hub;
  return hub;
}
export async function publishRoomWake(roomId: string): Promise<void> {
  try {
    await roomRealtime().publish(roomId);
  } catch {
    warn();
  }
}
