import type { RoomWakeBus } from "./room-realtime-core";
/** Defer server credentials until an announcement has actually committed. */
export async function publishRoomWake(roomId: string): Promise<void> {
  try {
    const state = globalThis as typeof globalThis & { sliperRoomRealtime?: RoomWakeBus };
    const bus =
      state.sliperRoomRealtime ?? (await import("./room-realtime-runtime")).roomRealtime();
    await bus.publish(roomId);
  } catch {
    // Never include connection URLs or broker exceptions in application logs.
    console.warn("Sliper room realtime: wake unavailable; database reconciliation remains active.");
  }
}
