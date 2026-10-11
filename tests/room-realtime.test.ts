import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { participationService } from "../src/server/participation-service";
import { AppError } from "../src/server/errors";
import {
  openRoomEventStream,
  pollingRoomWakeBus,
  roomChannel,
  RoomRealtimeHub,
  type RoomRedisConnection,
  type RoomStreamTimers,
  type RoomWakeBus,
} from "../src/server/room-realtime-core";

const roomId = "77fd7647-1e59-4a77-9c67-7964f7208bc8";
const otherRoomId = "1b2e9249-4772-4796-b7f7-1e06e82d26dc";
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
class FakeRedis extends EventEmitter implements RoomRedisConnection {
  isReady = false;
  isOpen = false;
  connectCalls = 0;
  subscribeCalls = 0;
  unsubscribeCalls = 0;
  channelListeners = new Map<string, (message: string) => void>();
  published: { channel: string; message: string }[] = [];
  connectWork: (() => Promise<void>) | undefined;
  publishWork: (() => Promise<void>) | undefined;
  async connect() {
    this.connectCalls++;
    this.isOpen = true;
    if (this.connectWork) await this.connectWork();
    this.isReady = true;
    this.emit("ready");
  }
  async subscribe(channel: string, listener: (message: string) => void) {
    this.subscribeCalls++;
    this.channelListeners.set(channel, listener);
  }
  async unsubscribe(channel: string) {
    this.unsubscribeCalls++;
    this.channelListeners.delete(channel);
  }
  async publish(channel: string, message: string) {
    this.published.push({ channel, message });
    if (this.publishWork) await this.publishWork();
  }
  deliver(room: string, message = room) {
    this.channelListeners.get(roomChannel(room))?.(message);
  }
  disconnect() {
    this.isReady = false;
    this.emit("error");
  }
  reconnect() {
    this.isReady = true;
    this.emit("ready");
  }
  destroy() {
    this.isReady = false;
    this.isOpen = false;
    this.channelListeners.clear();
    this.emit("end");
  }
}
function hubFixture(budget = 30) {
  const publisher = new FakeRedis();
  const subscriber = new FakeRedis();
  let warnings = 0;
  let connections = 0;
  const hub = new RoomRealtimeHub(
    () => {
      connections++;
      return { publisher, subscriber };
    },
    () => warnings++,
    budget,
  );
  return { hub, publisher, subscriber, warnings: () => warnings, connections: () => connections };
}
class ManualTimers implements RoomStreamTimers {
  now = 0;
  next = 0;
  pending = new Map<number, { at: number; callback: () => void }>();
  setTimeout(callback: () => void, ms: number) {
    const id = ++this.next;
    this.pending.set(id, { at: this.now + ms, callback });
    return id;
  }
  clearTimeout(handle: unknown) {
    this.pending.delete(handle as number);
  }
  async advance(ms: number) {
    const destination = this.now + ms;
    for (;;) {
      const next = [...this.pending.entries()]
        .filter(([, value]) => value.at <= destination)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.now = next[1].at;
      this.pending.delete(next[0]);
      next[1].callback();
      await flush();
    }
    this.now = destination;
    await flush();
  }
}
function manualBus(healthy = true) {
  let listener: (() => void) | undefined;
  let availabilityChanged: (() => void) | undefined;
  let subscriptions = 0;
  let removals = 0;
  let ready = Promise.resolve();
  const bus: RoomWakeBus = {
    subscribe: (_room, wake, changed) => {
      listener = wake;
      availabilityChanged = changed;
      subscriptions++;
      let removed = false;
      return {
        ready,
        isReady: () => healthy && !removed,
        unsubscribe: () => {
          if (removed) return;
          removed = true;
          listener = undefined;
          availabilityChanged = undefined;
          removals++;
        },
      };
    },
    publish: async () => listener?.(),
  };
  return {
    bus,
    wake: () => listener?.(),
    health: (value: boolean) => {
      healthy = value;
      availabilityChanged?.();
    },
    subscriptions: () => subscriptions,
    removals: () => removals,
    pendingReady: () => {
      let resolve!: () => void;
      ready = new Promise<void>((done) => {
        resolve = done;
      });
      return resolve;
    },
  };
}
async function frame(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const value = await reader.read();
  return value.done ? null : new TextDecoder().decode(value.value);
}

test("shared room subscriptions isolate canonical UUID hints and release the last listener", async () => {
  const fixture = hubFixture();
  try {
    let first = 0,
      second = 0,
      other = 0;
    const one = fixture.hub.subscribe(roomId.toUpperCase(), () => first++);
    const two = fixture.hub.subscribe(roomId, () => second++);
    const three = fixture.hub.subscribe(otherRoomId, () => other++);
    await Promise.all([one.ready, two.ready, three.ready]);
    assert.equal(fixture.connections(), 1);
    assert.equal(fixture.subscriber.connectCalls, 1);
    assert.equal(fixture.subscriber.subscribeCalls, 2);
    fixture.subscriber.deliver(roomId, JSON.stringify({ body: "private announcement" }));
    fixture.subscriber.deliver(roomId, otherRoomId);
    fixture.subscriber.deliver(roomId, "x".repeat(100_000));
    assert.deepEqual([first, second, other], [0, 0, 0]);
    fixture.subscriber.deliver(roomId);
    assert.deepEqual([first, second, other], [1, 1, 0]);
    one.unsubscribe();
    await flush();
    assert.equal(fixture.subscriber.unsubscribeCalls, 0);
    fixture.subscriber.deliver(roomId);
    assert.deepEqual([first, second], [1, 2]);
    two.unsubscribe();
    three.unsubscribe();
    await flush();
    assert.equal(fixture.subscriber.unsubscribeCalls, 2);
    assert.equal(fixture.subscriber.channelListeners.size, 0);
    assert.throws(() => roomChannel("room:*"));
  } finally {
    fixture.hub.close();
  }
});

test("publishing contains only the room UUID and is bounded during a broker outage or stalled command", async () => {
  const fixture = hubFixture();
  try {
    await fixture.hub.publish(roomId);
    assert.deepEqual(fixture.publisher.published, [
      { channel: roomChannel(roomId), message: roomId },
    ]);
    fixture.publisher.publishWork = () => new Promise(() => {});
    const stalledAt = Date.now();
    await fixture.hub.publish(roomId);
    assert.ok(Date.now() - stalledAt < 250);
  } finally {
    fixture.hub.close();
  }
  const offline = hubFixture();
  offline.publisher.connectWork = () => new Promise(() => {});
  try {
    const started = Date.now();
    await offline.hub.publish(roomId);
    assert.ok(Date.now() - started < 250);
    assert.equal(offline.publisher.published.length, 0);
  } finally {
    offline.hub.close();
  }
});

test("failed initial authorization releases the subscription before returning an HTTP error", async () => {
  const fixture = manualBus();
  const timers = new ManualTimers();
  await assert.rejects(
    openRoomEventStream({
      roomId,
      signal: new AbortController().signal,
      bus: fixture.bus,
      timers,
      readRoom: async () => {
        assert.equal(fixture.subscriptions(), 1);
        throw new AppError("FORBIDDEN", "private");
      },
    }),
    (error: unknown) => error instanceof AppError && error.code === "FORBIDDEN",
  );
  assert.equal(fixture.removals(), 1);
  assert.equal(timers.pending.size, 0);
});

test("a hint arriving during the initial DB snapshot triggers a catch-up after the first frame", async () => {
  const fixture = manualBus();
  const timers = new ManualTimers();
  let reads = 0;
  const stream = await openRoomEventStream({
    roomId,
    bus: fixture.bus,
    timers,
    signal: new AbortController().signal,
    readRoom: async () => {
      reads++;
      if (reads === 1) fixture.wake();
      return { messages: reads === 1 ? ["older"] : ["newer"] };
    },
  });
  const reader = stream.getReader();
  assert.match((await frame(reader))!, /older/);
  assert.match((await frame(reader))!, /newer/);
  assert.equal(reads, 2);
  await reader.cancel();
  assert.equal(fixture.removals(), 1);
  assert.equal(timers.pending.size, 0);
});

test("bursts coalesce DB reads and another hint during a read queues one authorized follow-up", async () => {
  const fixture = manualBus();
  const timers = new ManualTimers();
  let reads = 0,
    concurrent = 0,
    maximum = 0;
  let resolve!: (value: { messages: string[] }) => void;
  const stream = await openRoomEventStream({
    roomId,
    bus: fixture.bus,
    timers,
    signal: new AbortController().signal,
    readRoom: async () => {
      reads++;
      concurrent++;
      maximum = Math.max(maximum, concurrent);
      try {
        if (reads === 2)
          return await new Promise<{ messages: string[] }>((done) => {
            resolve = done;
          });
        return { messages: [String(reads)] };
      } finally {
        concurrent--;
      }
    },
  });
  const reader = stream.getReader();
  await frame(reader);
  for (let i = 0; i < 100; i++) fixture.wake();
  await flush();
  assert.equal(reads, 2);
  for (let i = 0; i < 100; i++) fixture.wake();
  resolve({ messages: ["2"] });
  await flush();
  assert.equal(reads, 3);
  assert.equal(maximum, 1);
  assert.match((await frame(reader))!, /"2"/);
  assert.match((await frame(reader))!, /"3"/);
  await reader.cancel();
});

test("healthy Redis uses 30-second DB reconciliation, outages use 5 seconds, and recovery catches up", async () => {
  const fixture = manualBus();
  const timers = new ManualTimers();
  let reads = 0;
  const stream = await openRoomEventStream({
    roomId,
    bus: fixture.bus,
    timers,
    signal: new AbortController().signal,
    readRoom: async () => ({ read: ++reads }),
  });
  const reader = stream.getReader();
  await frame(reader);
  await timers.advance(29_000);
  assert.equal(reads, 1);
  await timers.advance(1_000);
  assert.equal(reads, 2);
  fixture.health(false);
  await timers.advance(5_000);
  assert.equal(reads, 3);
  fixture.health(true);
  await flush();
  assert.equal(reads, 4);
  await reader.cancel();
  assert.equal(timers.pending.size, 0);
});

test("missing Redis falls back to DB polling and sends independent heartbeats", async () => {
  const timers = new ManualTimers();
  let reads = 0;
  const stream = await openRoomEventStream({
    roomId,
    bus: pollingRoomWakeBus,
    timers,
    signal: new AbortController().signal,
    readRoom: async () => {
      reads++;
      return { messages: [] };
    },
  });
  const reader = stream.getReader();
  assert.match((await frame(reader))!, /event: room/);
  await timers.advance(15_000);
  assert.equal(reads, 4);
  assert.equal(await frame(reader), "event: heartbeat\ndata: {}\n\n");
  await reader.cancel();
  assert.equal(timers.pending.size, 0);
});

for (const code of ["FORBIDDEN", "NOT_FOUND", "UNAUTHENTICATED"] as const) {
  test(`an authorized read rejects a ${code} membership before transmitting a wake-up's content`, async () => {
    const fixture = manualBus();
    const timers = new ManualTimers();
    let reads = 0;
    const stream = await openRoomEventStream({
      roomId,
      bus: fixture.bus,
      timers,
      signal: new AbortController().signal,
      readRoom: async () => {
        if (++reads > 1) throw new AppError(code, "sensitive details");
        return { messages: ["old authorized message"] };
      },
    });
    const reader = stream.getReader();
    await frame(reader);
    fixture.wake();
    assert.equal(await frame(reader), "event: revoked\ndata: {}\n\n");
    assert.equal(await frame(reader), null);
    assert.equal(fixture.removals(), 1);
    assert.equal(timers.pending.size, 0);
  });
}

test("revocation without a hint is discovered by the safety reconciliation", async () => {
  const fixture = manualBus();
  const timers = new ManualTimers();
  let reads = 0;
  const stream = await openRoomEventStream({
    roomId,
    bus: fixture.bus,
    timers,
    signal: new AbortController().signal,
    readRoom: async () => {
      if (++reads > 1) throw new AppError("FORBIDDEN", "revoked");
      return { messages: [] };
    },
  });
  const reader = stream.getReader();
  await frame(reader);
  await timers.advance(30_000);
  assert.equal(await frame(reader), "event: heartbeat\ndata: {}\n\n");
  assert.equal(await frame(reader), "event: revoked\ndata: {}\n\n");
  assert.equal(await frame(reader), null);
  assert.equal(timers.pending.size, 0);
});

test("request abort releases a pending subscription immediately and never starts a DB read", async () => {
  const fixture = manualBus();
  const finishReady = fixture.pendingReady();
  const abort = new AbortController();
  const timers = new ManualTimers();
  let reads = 0;
  const opening = openRoomEventStream({
    roomId,
    bus: fixture.bus,
    timers,
    signal: abort.signal,
    readRoom: async () => {
      reads++;
      return {};
    },
  });
  abort.abort();
  assert.equal(fixture.removals(), 1);
  finishReady();
  const reader = (await opening).getReader();
  assert.equal(await frame(reader), null);
  assert.equal(reads, 0);
  assert.equal(timers.pending.size, 0);
});

test("abort or stream expiry drops an in-flight DB result and clears every timer", async () => {
  for (const reason of ["abort", "expiry"]) {
    const fixture = manualBus();
    const timers = new ManualTimers();
    const abort = new AbortController();
    let reads = 0;
    let resolve!: (value: { messages: string[] }) => void;
    const stream = await openRoomEventStream({
      roomId,
      bus: fixture.bus,
      timers,
      signal: abort.signal,
      readRoom: async () => {
        if (++reads === 1) return { messages: ["first"] };
        return new Promise<{ messages: string[] }>((done) => {
          resolve = done;
        });
      },
    });
    const reader = stream.getReader();
    await frame(reader);
    fixture.wake();
    await flush();
    if (reason === "abort") abort.abort();
    else await timers.advance(55_000);
    resolve({ messages: ["must not be sent"] });
    await flush();
    if (reason === "expiry")
      for (let i = 0; i < 3; i++) assert.match((await frame(reader))!, /event: heartbeat/);
    assert.equal(await frame(reader), null);
    assert.equal(fixture.removals(), 1);
    assert.equal(timers.pending.size, 0);
  }
});

test("Redis disconnect and recovery notify local subscribers without duplicating channel listeners", async () => {
  const fixture = hubFixture();
  let changes = 0;
  try {
    const subscription = fixture.hub.subscribe(
      roomId,
      () => {},
      () => changes++,
    );
    await subscription.ready;
    assert.equal(subscription.isReady(), true);
    fixture.subscriber.disconnect();
    assert.equal(subscription.isReady(), false);
    fixture.subscriber.reconnect();
    assert.equal(subscription.isReady(), true);
    assert.equal(fixture.subscriber.subscribeCalls, 1);
    assert.ok(changes >= 3);
    subscription.unsubscribe();
    await flush();
    assert.equal(fixture.subscriber.channelListeners.size, 0);
  } finally {
    fixture.hub.close();
  }
});

test("announcement hints run after durable commit; broker failure preserves the saved room and rollbacks publish nothing", async () => {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  let inTransaction = false;
  let rollback = false;
  const database = new Proxy(db, {
    get(target, property) {
      if (property === "transaction")
        return async (work: (tx: unknown) => Promise<unknown>) => {
          inTransaction = true;
          try {
            return await db.transaction(async (tx) => {
              const result = await work(tx);
              if (rollback) throw new Error("forced rollback");
              return result;
            });
          } finally {
            inTransaction = false;
          }
        };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as Database;
  const state = globalThis as typeof globalThis & { sliperRoomRealtime?: RoomWakeBus };
  const prior = state.sliperRoomRealtime;
  let publications = 0;
  let publishedDuringTransaction: boolean | undefined;
  let publishedRoomId: string | undefined;
  let committedBodies: string[] | undefined;
  const owner = randomUUID();
  const postId = randomUUID();
  try {
    await pg.exec(
      "create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated;",
    );
    await migrate(db, { migrationsFolder: "./drizzle" });
    await db.insert(schema.categories).values([...CATEGORIES]);
    await pg.query("insert into auth.users values ($1)", [owner]);
    await pg.query("insert into sliper.profiles (id,nickname) values ($1,'host')", [owner]);
    await pg.query(
      "insert into sliper.posts (id,author_id,category_slug,kind,title,body_markdown,event_fee) values ($1,$2,'party','모집','Redis test room','welcome','무료')",
      [postId, owner],
    );
    await pg.query(
      "insert into sliper.event_settings (post_id,amount_krw,capacity) values ($1,0,20)",
      [postId],
    );
    state.sliperRoomRealtime = {
      ...pollingRoomWakeBus,
      publish: async (id) => {
        publications++;
        publishedRoomId = id;
        publishedDuringTransaction = inTransaction;
        if (!inTransaction) {
          const saved = await pg.query<{ body: string }>(
            "select body from sliper.room_messages where post_id=$1",
            [id],
          );
          committedBodies = saved.rows.map((row) => row.body);
        }
        throw new Error("broker unavailable with sensitive connection details");
      },
    };
    const service = participationService(database);
    const room = await service.send(owner, postId, { body: "durable announcement" });
    assert.equal(room.messages[0]!.body, "durable announcement");
    assert.equal(publishedRoomId, postId);
    assert.equal(
      publishedDuringTransaction,
      false,
      "Redis must never publish inside the DB transaction",
    );
    assert.deepEqual(committedBodies, ["durable announcement"]);
    assert.equal(publications, 1);

    await assert.rejects(
      service.send(randomUUID(), postId, { body: "forbidden announcement" }),
      (error: unknown) => error instanceof AppError && error.code === "FORBIDDEN",
    );
    assert.equal(publications, 1);
    const rollbackPostId = randomUUID();
    await pg.query(
      "insert into sliper.posts (id,author_id,category_slug,kind,title,body_markdown,event_fee) values ($1,$2,'party','모집','Rollback room','welcome','무료')",
      [rollbackPostId, owner],
    );
    await pg.query(
      "insert into sliper.event_settings (post_id,amount_krw,capacity) values ($1,0,20)",
      [rollbackPostId],
    );
    rollback = true;
    await assert.rejects(
      service.send(owner, rollbackPostId, { body: "rolled-back announcement" }),
      /forced rollback/,
    );
    assert.equal(publications, 1);
    const saved = await pg.query<{ body: string }>(
      "select body from sliper.room_messages where post_id=$1",
      [postId],
    );
    assert.deepEqual(
      saved.rows.map((row) => row.body),
      ["durable announcement"],
    );
    const rolledBack = await pg.query("select id from sliper.room_messages where post_id=$1", [
      rollbackPostId,
    ]);
    assert.equal(rolledBack.rows.length, 0);
  } finally {
    if (prior) state.sliperRoomRealtime = prior;
    else delete state.sliperRoomRealtime;
    await pg.close();
  }
});
