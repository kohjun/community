import { z } from "zod";
import { AppError } from "./errors";

export const ROOM_RECONCILE_MS = 30_000;
export const ROOM_FALLBACK_MS = 5_000;
export const ROOM_HEARTBEAT_MS = 15_000;
export const ROOM_STREAM_DURATION_MS = 55_000;
export const ROOM_REDIS_BUDGET_MS = 450;

export function roomChannel(roomId: string): string {
  return `sliper:room:${z.uuid().parse(roomId).toLowerCase()}`;
}

export interface RoomWakeSubscription {
  /** Settles after SUBSCRIBE is acknowledged, or the short connection budget expires. */
  ready: Promise<void>;
  isReady(): boolean;
  unsubscribe(): void;
}
export interface RoomWakeBus {
  subscribe(
    roomId: string,
    wake: () => void,
    availabilityChanged?: () => void,
  ): RoomWakeSubscription;
  publish(roomId: string): Promise<void>;
}
export interface RoomRedisConnection {
  readonly isReady: boolean;
  readonly isOpen: boolean;
  connect(): Promise<unknown>;
  subscribe(channel: string, listener: (message: string) => void): Promise<unknown>;
  unsubscribe(channel: string, listener: (message: string) => void): Promise<unknown>;
  publish(channel: string, message: string): Promise<unknown>;
  on(event: "ready" | "error" | "reconnecting" | "end", listener: () => void): unknown;
  destroy(): void;
}
type Listener = {
  wake: () => void;
  availabilityChanged: () => void;
  settleReady: () => void;
};
type Channel = {
  name: string;
  roomId: string;
  listeners: Set<Listener>;
  dispatch: (message: string) => void;
  subscribed: boolean;
  syncing: boolean;
};

/** One publisher and one subscriber socket fan out to all SSE requests in this process. */
export class RoomRealtimeHub implements RoomWakeBus {
  private publisher: RoomRedisConnection | undefined;
  private subscriber: RoomRedisConnection | undefined;
  private subscriberAvailable = false;
  private channels = new Map<string, Channel>();
  private publisherWaiters = new Set<() => void>();
  private closed = false;
  constructor(
    private createConnections: () => {
      publisher: RoomRedisConnection;
      subscriber: RoomRedisConnection;
    },
    private warning: () => void = () => {},
    private budgetMs = ROOM_REDIS_BUDGET_MS,
  ) {}
  private initialize() {
    if (this.closed || this.publisher) return;
    try {
      const pair = this.createConnections();
      this.publisher = pair.publisher;
      this.subscriber = pair.subscriber;
      pair.publisher.on("error", this.warning);
      pair.publisher.on("ready", () => {
        for (const wake of [...this.publisherWaiters]) wake();
      });
      pair.subscriber.on("ready", () => {
        this.subscriberAvailable = true;
        for (const channel of this.channels.values()) {
          this.notifyAvailability(channel);
          this.sync(channel);
        }
      });
      const unavailable = () => {
        this.subscriberAvailable = false;
        for (const channel of this.channels.values()) this.notifyAvailability(channel);
      };
      pair.subscriber.on("reconnecting", unavailable);
      pair.subscriber.on("end", unavailable);
      pair.subscriber.on("error", () => {
        unavailable();
        this.warning();
      });
    } catch {
      this.warning();
    }
  }
  private connect(client: RoomRedisConnection) {
    if (!client.isOpen && !this.closed)
      void client.connect().catch(() => {
        this.warning();
      });
  }
  private notifyAvailability(channel: Channel) {
    for (const listener of channel.listeners) {
      if (this.subscriberAvailable && channel.subscribed) listener.settleReady();
      listener.availabilityChanged();
    }
  }
  private sync(channel: Channel) {
    const client = this.subscriber;
    if (
      channel.syncing ||
      !client?.isReady ||
      this.closed ||
      this.channels.get(channel.name) !== channel
    )
      return;
    channel.syncing = true;
    void (async () => {
      try {
        while (client.isReady && channel.subscribed !== channel.listeners.size > 0) {
          const wanted = channel.listeners.size > 0;
          if (wanted) await client.subscribe(channel.name, channel.dispatch);
          else await client.unsubscribe(channel.name, channel.dispatch);
          channel.subscribed = wanted;
          this.notifyAvailability(channel);
        }
      } catch {
        this.warning();
      } finally {
        channel.syncing = false;
        if (!channel.subscribed && channel.listeners.size === 0) this.channels.delete(channel.name);
      }
    })();
  }
  subscribe(roomId: string, wake: () => void, availabilityChanged: () => void = () => {}) {
    const name = roomChannel(roomId);
    this.initialize();
    let channel = this.channels.get(name);
    if (!channel) {
      const listeners = new Set<Listener>();
      channel = {
        name,
        roomId: name.slice("sliper:room:".length),
        listeners,
        subscribed: false,
        syncing: false,
        dispatch: (message) => {
          // The entire payload is a canonical UUID. No message text, identity, or contacts.
          if (message.length !== 36 || message !== channel!.roomId) return;
          for (const listener of listeners) listener.wake();
        },
      };
      this.channels.set(name, channel);
    }
    let settle!: () => void;
    const ready = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const timeout = setTimeout(() => settle(), this.budgetMs);
    const listener: Listener = {
      wake,
      availabilityChanged,
      settleReady: () => {
        clearTimeout(timeout);
        settle();
      },
    };
    channel.listeners.add(listener);
    if (this.subscriber) {
      this.connect(this.subscriber);
      this.sync(channel);
    } else listener.settleReady();
    if (this.subscriberAvailable && channel.subscribed) listener.settleReady();
    let removed = false;
    return {
      ready,
      isReady: () => !removed && this.subscriberAvailable && channel!.subscribed,
      unsubscribe: () => {
        if (removed) return;
        removed = true;
        listener.settleReady();
        channel!.listeners.delete(listener);
        if (!channel!.subscribed && !channel!.syncing) this.channels.delete(name);
        else this.sync(channel!);
      },
    };
  }
  async publish(roomId: string) {
    const name = roomChannel(roomId);
    this.initialize();
    const client = this.publisher;
    if (!client || this.closed) return;
    const deadline = Date.now() + this.budgetMs;
    this.connect(client);
    if (!client.isReady) {
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(timeout);
          this.publisherWaiters.delete(wake);
          resolve();
        };
        const timeout = setTimeout(wake, this.budgetMs);
        this.publisherWaiters.add(wake);
      });
    }
    const remaining = deadline - Date.now();
    if (!client.isReady || remaining <= 0 || this.closed) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        client.publish(name, name.slice("sliper:room:".length)),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, remaining);
        }),
      ]);
    } catch {
      // A committed announcement must remain successful even when its wake-up is lost.
      this.warning();
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const channel of this.channels.values()) {
      for (const listener of channel.listeners) listener.settleReady();
      channel.listeners.clear();
    }
    this.channels.clear();
    for (const wake of [...this.publisherWaiters]) wake();
    if (this.publisher?.isOpen) this.publisher.destroy();
    if (this.subscriber?.isOpen) this.subscriber.destroy();
  }
}

export const pollingRoomWakeBus: RoomWakeBus = {
  subscribe: () => ({
    ready: Promise.resolve(),
    isReady: () => false,
    unsubscribe: () => {},
  }),
  publish: async () => {},
};

export interface RoomStreamTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
const systemTimers: RoomStreamTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Subscribe before the first authorized DB snapshot; every hint causes another authorized read. */
export async function openRoomEventStream<T>(options: {
  roomId: string;
  signal: AbortSignal;
  readRoom: () => Promise<T>;
  bus: RoomWakeBus;
  timers?: RoomStreamTimers;
}): Promise<ReadableStream<Uint8Array>> {
  const timers = options.timers ?? systemTimers;
  const encoder = new TextEncoder();
  const handles = new Set<unknown>();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let subscription: RoomWakeSubscription | undefined;
  let stopped = false;
  let initialized = false;
  let revision = 0;
  let dirty = false;
  let running = false;
  let queued = false;
  let previous = "";
  let reconcileTimer: unknown;
  function timer(callback: () => void, ms: number) {
    const handle = timers.setTimeout(() => {
      handles.delete(handle);
      callback();
    }, ms);
    handles.add(handle);
    return handle;
  }
  function stop(close = true) {
    if (stopped) return;
    stopped = true;
    for (const handle of handles) timers.clearTimeout(handle);
    handles.clear();
    options.signal.removeEventListener("abort", onAbort);
    subscription?.unsubscribe();
    if (close) controller?.close();
  }
  function onAbort() {
    stop();
  }
  function write(event: string, value: string) {
    if (!stopped) controller?.enqueue(encoder.encode(`event: ${event}\ndata: ${value}\n\n`));
  }
  function refresh() {
    revision++;
    dirty = true;
    if (!initialized || stopped || running || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      void drain();
    });
  }
  async function drain() {
    if (running || stopped) return;
    running = true;
    try {
      while (dirty && !stopped) {
        dirty = false;
        const next = JSON.stringify(await options.readRoom());
        if (stopped) return;
        if (next !== previous) {
          write("room", next);
          previous = next;
        }
      }
    } catch (error) {
      if (
        error instanceof AppError &&
        ["FORBIDDEN", "NOT_FOUND", "UNAUTHENTICATED"].includes(error.code)
      )
        write("revoked", "{}");
      stop();
    } finally {
      running = false;
    }
  }
  function scheduleReconcile() {
    if (!initialized || stopped) return;
    if (reconcileTimer !== undefined) {
      timers.clearTimeout(reconcileTimer);
      handles.delete(reconcileTimer);
    }
    reconcileTimer = timer(
      () => {
        refresh();
        scheduleReconcile();
      },
      subscription?.isReady() ? ROOM_RECONCILE_MS : ROOM_FALLBACK_MS,
    );
  }
  options.signal.addEventListener("abort", onAbort, { once: true });
  try {
    subscription = options.bus.subscribe(options.roomId, refresh, () => {
      // Reconcile immediately on recovery because Pub/Sub cannot replay missed hints.
      if (subscription?.isReady()) refresh();
      scheduleReconcile();
    });
    if (options.signal.aborted || stopped) {
      subscription.unsubscribe();
      stop();
    } else {
      await subscription.ready;
      if (!stopped) {
        const snapshotRevision = revision;
        previous = JSON.stringify(await options.readRoom());
        dirty = revision !== snapshotRevision;
      }
    }
  } catch (error) {
    stop();
    throw error;
  }
  return new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      if (stopped) {
        controller.close();
        return;
      }
      initialized = true;
      write("room", previous);
      scheduleReconcile();
      const heartbeat = () => {
        if (stopped) return;
        write("heartbeat", "{}");
        timer(heartbeat, ROOM_HEARTBEAT_MS);
      };
      timer(heartbeat, ROOM_HEARTBEAT_MS);
      timer(() => stop(), ROOM_STREAM_DURATION_MS);
      if (dirty) refresh();
    },
    cancel() {
      stop(false);
    },
  });
}
