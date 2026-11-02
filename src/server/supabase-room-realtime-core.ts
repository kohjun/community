import {
  roomChannel,
  pollingRoomWakeBus,
  type RoomWakeBus,
  type RoomWakeSubscription,
} from "./room-realtime-core";

export interface SupabaseWakeTransport {
  subscribe(
    topic: string,
    receive: (payload: unknown) => void,
    status: (ready: boolean) => void,
  ): () => Promise<void> | void;
  publish(topic: string, roomId: string, signal: AbortSignal): Promise<void>;
  close(): Promise<void> | void;
}
type Listener = { wake: () => void; changed: () => void; settle: () => void };
type Entry = {
  roomId: string;
  listeners: Set<Listener>;
  healthy: boolean;
  release?: () => Promise<void> | void;
};

/** Server-only, private Broadcast hints. Every SSE reader rechecks permissions in Postgres. */
export class SupabaseRoomRealtimeHub implements RoomWakeBus {
  private entries = new Map<string, Entry>();
  private transport?: SupabaseWakeTransport;
  private closed = false;
  constructor(
    private createTransport: () => SupabaseWakeTransport,
    private warning: () => void = () => {},
    private budgetMs = 450,
    private maxChannels = 200,
  ) {}
  private connection() {
    if (this.closed) throw new Error("Realtime hub is closed.");
    return (this.transport ??= this.createTransport());
  }
  subscribe(
    roomId: string,
    wake: () => void,
    changed: () => void = () => {},
  ): RoomWakeSubscription {
    const topic = roomChannel(roomId);
    if (this.closed || (!this.entries.has(topic) && this.entries.size >= this.maxChannels))
      return pollingRoomWakeBus.subscribe(roomId, wake, changed);
    let entry = this.entries.get(topic);
    const isNew = !entry;
    if (!entry) {
      entry = { roomId: topic.slice("sliper:room:".length), listeners: new Set(), healthy: false };
      this.entries.set(topic, entry);
    }
    const current = entry;
    let resolve!: () => void;
    const ready = new Promise<void>((done) => {
      resolve = done;
    });
    const timer = setTimeout(() => resolve(), this.budgetMs);
    const listener = {
      wake,
      changed,
      settle: () => {
        clearTimeout(timer);
        resolve();
      },
    };
    current.listeners.add(listener);
    const active = () => !this.closed && this.entries.get(topic) === current;
    if (isNew) {
      try {
        current.release = this.connection().subscribe(
          topic,
          (payload) => {
            if (!active() || !payload || typeof payload !== "object" || Array.isArray(payload))
              return;
            const value = payload as Record<string, unknown>;
            if (Object.keys(value).length !== 1 || value.roomId !== current.roomId) return;
            for (const target of current.listeners) target.wake();
          },
          (healthy) => {
            if (!active()) return;
            current.healthy = healthy;
            if (!healthy) this.warning();
            for (const target of current.listeners) {
              if (healthy) target.settle();
              target.changed();
            }
          },
        );
      } catch {
        listener.settle();
        this.warning();
      }
    }
    if (current.healthy) listener.settle();
    let removed = false;
    return {
      ready,
      isReady: () => !removed && active() && current.healthy,
      unsubscribe: () => {
        if (removed) return;
        removed = true;
        listener.settle();
        current.listeners.delete(listener);
        if (!current.listeners.size && this.entries.get(topic) === current) {
          this.entries.delete(topic);
          if (current.release) void Promise.resolve(current.release()).catch(this.warning);
        }
      },
    };
  }
  async publish(roomId: string) {
    const topic = roomChannel(roomId);
    if (this.closed) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const transport = this.connection();
      await Promise.race([
        transport.publish(topic, topic.slice("sliper:room:".length), controller.signal),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            this.warning();
            resolve();
          }, this.budgetMs);
        }),
      ]);
    } catch {
      // The announcement is already committed. Database reconciliation recovers missed hints.
      this.warning();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.entries.values()) {
      entry.healthy = false;
      for (const listener of entry.listeners) {
        listener.settle();
        listener.changed();
      }
    }
    this.entries.clear();
    await this.transport?.close();
  }
}
