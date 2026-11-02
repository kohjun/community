import "server-only";
import { createClient } from "redis";
import { pollingRoomWakeBus, RoomRealtimeHub, type RoomWakeBus } from "./room-realtime-core";

import { roomRealtimeConfiguration } from "./room-realtime-config";
import { SupabaseRoomRealtimeHub } from "./supabase-room-realtime-core";
import { supabaseWakeTransport } from "./supabase-room-realtime";

const processState = globalThis as typeof globalThis & {
  sliperRoomRealtime?: RoomWakeBus;
  sliperRoomRedisWarningAt?: number;
};
function warn() {
  const now = Date.now();
  if (now - (processState.sliperRoomRedisWarningAt ?? 0) < 30_000) return;
  processState.sliperRoomRedisWarningAt = now;
  // Error objects and connection URLs may contain credentials, so never log them.
  console.warn(
    "Sliper room realtime: wake service unavailable; database reconciliation remains active.",
  );
}
export function roomRealtime(): RoomWakeBus {
  if (processState.sliperRoomRealtime) return processState.sliperRoomRealtime;
  let config;
  try {
    config = roomRealtimeConfiguration();
  } catch {
    warn();
    return pollingRoomWakeBus;
  }
  if (config.provider === "polling") return pollingRoomWakeBus;
  if (config.provider === "supabase") {
    const hub = new SupabaseRoomRealtimeHub(() => supabaseWakeTransport(config), warn);
    processState.sliperRoomRealtime = hub;
    return hub;
  }
  const url = config.url;
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
