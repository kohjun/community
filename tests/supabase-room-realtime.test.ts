import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  SupabaseRoomRealtimeHub,
  type SupabaseWakeTransport,
} from "../src/server/supabase-room-realtime-core";
import { roomRealtimeConfiguration } from "../src/server/room-realtime-config";
import { roomChannel } from "../src/server/room-realtime-core";
import { assertCloudDatabase } from "../src/server/cloud-runtime-config";
import { imageStorageConfiguration } from "../src/server/image-storage-config";
import { isLocalTestEnvironment } from "../src/server/local-test-auth";
import { healthConfiguration } from "../src/server/operations-health-service";
import { deploymentReadiness } from "../src/server/deployment-readiness";

function fixture(budget = 15, max = 200) {
  const channels = new Map<
    string,
    { receive: (value: unknown) => void; status: (ready: boolean) => void }
  >();
  const sent: { topic: string; roomId: string; signal: AbortSignal }[] = [];
  let subscriptions = 0,
    releases = 0,
    warnings = 0,
    closes = 0;
  let hang = false;
  const transport: SupabaseWakeTransport = {
    subscribe(topic, receive, status) {
      subscriptions++;
      channels.set(topic, { receive, status });
      return () => {
        releases++;
        channels.delete(topic);
      };
    },
    async publish(topic, roomId, signal) {
      sent.push({ topic, roomId, signal });
      if (hang) await new Promise<void>(() => {});
    },
    close() {
      closes++;
      channels.clear();
    },
  };
  const hub = new SupabaseRoomRealtimeHub(
    () => transport,
    () => {
      warnings++;
    },
    budget,
    max,
  );
  return {
    hub,
    channels,
    sent,
    hang: () => {
      hang = true;
    },
    counts: () => ({ subscriptions, releases, warnings, closes }),
  };
}

test("private wake hub shares one room channel, sends UUID only and ignores unrelated or oversized payloads", async () => {
  const f = fixture();
  const id = randomUUID();
  let a = 0,
    b = 0;
  const first = f.hub.subscribe(id.toUpperCase(), () => {
    a++;
  });
  const second = f.hub.subscribe(id, () => {
    b++;
  });
  const channel = f.channels.get(roomChannel(id))!;
  assert.equal(first.isReady(), false);
  channel.status(true);
  await Promise.all([first.ready, second.ready]);
  assert.equal(first.isReady(), true);
  for (const payload of [
    null,
    "private body",
    [],
    { roomId: randomUUID() },
    { roomId: id, body: "private" },
    { roomId: id.toUpperCase() },
  ])
    channel.receive(payload);
  assert.deepEqual([a, b], [0, 0]);
  channel.receive({ roomId: id });
  assert.deepEqual([a, b], [1, 1]);
  await f.hub.publish(id);
  assert.equal(f.sent[0]!.topic, roomChannel(id));
  assert.equal(f.sent[0]!.roomId, id);
  assert.equal(f.counts().subscriptions, 1);
  first.unsubscribe();
  first.unsubscribe();
  channel.receive({ roomId: id });
  assert.deepEqual([a, b], [1, 2]);
  second.unsubscribe();
  assert.equal(f.counts().releases, 1);
  channel.receive({ roomId: id });
  assert.equal(b, 2);
  assert.equal(second.isReady(), false);
  await f.hub.close();
});

test("connection budget settles, outages fall back, reconnects restore health and late callbacks cannot wake replacements", async () => {
  const f = fixture();
  const id = randomUUID();
  let changes = 0,
    wakes = 0;
  const sub = f.hub.subscribe(
    id,
    () => {
      wakes++;
    },
    () => {
      changes++;
    },
  );
  await sub.ready;
  assert.equal(sub.isReady(), false);
  const old = f.channels.get(roomChannel(id))!;
  old.status(true);
  assert.equal(sub.isReady(), true);
  old.status(false);
  assert.equal(sub.isReady(), false);
  old.status(true);
  assert.equal(changes, 3);
  sub.unsubscribe();
  const next = f.hub.subscribe(id, () => {
    wakes++;
  });
  old.receive({ roomId: id });
  old.status(true);
  assert.equal(wakes, 0);
  assert.equal(next.isReady(), false);
  await f.hub.close();
  await next.ready;
  assert.equal(next.isReady(), false);
  assert.equal(f.counts().closes, 1);
});

test("hanging broadcast is aborted within its budget; channel cap keeps DB fallback usable", async () => {
  const f = fixture(15, 1);
  const first = f.hub.subscribe(randomUUID(), () => {});
  const overflow = f.hub.subscribe(randomUUID(), () => {
    assert.fail("fallback must not dispatch");
  });
  await overflow.ready;
  assert.equal(overflow.isReady(), false);
  assert.equal(f.counts().subscriptions, 1);
  f.hang();
  await Promise.race([
    f.hub.publish(randomUUID()),
    delay(300).then(() => assert.fail("publish blocked")),
  ]);
  assert.equal(f.sent[0]!.signal.aborted, true);
  assert.equal(f.counts().warnings, 1);
  first.unsubscribe();
  overflow.unsubscribe();
  await f.hub.close();
  assert.throws(() => f.hub.subscribe("../room", () => {}));
});

const secret = `sb_secret_${randomBytes(32).toString("hex")}`;
const cloud = {
  NODE_ENV: "production" as const,
  SLIPER_CLOUD_ONLY: "true",
  SLIPER_AUTH_MODE: "supabase",
  LOCAL_DATABASE: "0",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_STORAGE_URL: "https://project.supabase.co",
  SUPABASE_STORAGE_SECRET_KEY: secret,
  SUPABASE_STORAGE_BUCKET: "sliper-private-images",
};

test("Supabase provider uses server credentials, ignores unused Redis, and health/readiness agree", () => {
  const env = { ...cloud, SUPABASE_REALTIME_SECRET_KEY: "", REDIS_URL: "redis://127.0.0.1:6380" };
  assert.equal(roomRealtimeConfiguration(env).provider, "supabase");
  assert.equal(healthConfiguration(env).roomProvider, "supabase");
  assert.equal(healthConfiguration(env).roomUpdates, "configured");
  const row = deploymentReadiness(env).find((entry) => entry.id === "room-realtime")!;
  assert.equal(row.status, "pass");
  assert.equal(JSON.stringify(row).includes(secret), false);
  assert.equal(JSON.stringify(healthConfiguration(env)).includes(secret), false);
  for (const patch of [
    { ROOM_REALTIME_PROVIDER: "redis" },
    { ROOM_REALTIME_PROVIDER: "typo" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://127.0.0.1" },
    { SUPABASE_STORAGE_SECRET_KEY: "sb_publishable_browser" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://secret@project.supabase.co" },
  ]) {
    assert.throws(
      () => roomRealtimeConfiguration({ ...cloud, ...patch }),
      (error: unknown) => error instanceof Error && !error.message.includes(secret),
    );
    assert.equal(healthConfiguration({ ...cloud, ...patch }).roomUpdates, "invalid");
  }
  assert.equal(roomRealtimeConfiguration({}).provider, "polling");
  assert.equal(
    roomRealtimeConfiguration({ REDIS_URL: "redis://127.0.0.1:6380" }).provider,
    "redis",
  );
});

test("cloud-only mode rejects local storage, local identity, owner DB, wrong project and missing TLS", () => {
  assert.equal(imageStorageConfiguration(undefined, cloud).backend, "supabase");
  assert.throws(() => imageStorageConfiguration("local", cloud));
  assert.throws(() =>
    imageStorageConfiguration(undefined, {
      ...cloud,
      SUPABASE_STORAGE_URL: "https://other.supabase.co",
    }),
  );
  assert.equal(
    isLocalTestEnvironment({
      ...cloud,
      NODE_ENV: "development",
      LOCAL_DATABASE: "1",
      SLIPER_AUTH_MODE: "development",
      DATABASE_URL: "postgres://dev:pw@127.0.0.1:55432/sliper_dev",
    }),
    false,
  );
  const url = `postgres://sliper_app.project:${randomBytes(16).toString("hex")}@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?sslmode=require`;
  assert.doesNotThrow(() => assertCloudDatabase(url, cloud));
  for (const value of [
    url.replace("sliper_app", "postgres"),
    url.replace("?sslmode=require", ""),
    url.replace("aws-0-ap-southeast-2.pooler.supabase.com", "127.0.0.1"),
  ])
    assert.throws(() => assertCloudDatabase(value, cloud));
  assert.throws(() => assertCloudDatabase(url, { ...cloud, LOCAL_DATABASE: "1" }));
});
