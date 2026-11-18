import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { profiles } from "../src/db/schema";
import { gameAssets, gameRooms } from "../src/db/game-room-schema";
import { objectCleanupJobs } from "../src/db/object-cleanup-schema";
import type { Database } from "../src/db/connection";
import { gameRoomService, type GamePrincipal } from "../src/server/game-room-service";
import { readGameRun } from "../src/server/game-run-service";
import {
  canReadGameAsset,
  requireGameUpload,
  cleanupGameAssets,
} from "../src/server/game-media-core";
const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database;
let now = new Date("2026-11-14T03:00:00Z"),
  owner: string;
const hash = () => randomBytes(32).toString("hex"),
  sharedWifi = hash();
const person = (actor: string | null = null): GamePrincipal => ({
  actor,
  identityHash: hash(),
  networkHash: sharedWifi,
});
const service = gameRoomService(connection, { now: () => now });
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
});
after(() => pg.close());
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;truncate sliper.object_cleanup_jobs");
  now = new Date("2026-11-14T03:00:00Z");
  owner = randomUUID();
  await pg.query("insert into auth.users values($1)", [owner]);
  await db.insert(profiles).values({ id: owner, nickname: "그림호스트" });
});
async function join(id: string, who: GamePrincipal, nickname: string, host = false) {
  await service.connect(id, who, host);
  await service.player(id, who, { action: "nickname", nickname });
  return service.player(id, who, { action: "ready", ready: true });
}
test("a host can play with three guests and settings keep every ready flag", async () => {
  const host = person(owner),
    guests = [person(), person(), person()];
  const { id } = await service.create(owner, {
    gameType: "drawing",
    title: "낙서톡 테스트",
    capacity: 8,
    minPlayers: 4,
  });
  let view = await join(id, host, "호스트", true);
  for (const [i, p] of guests.entries()) view = await join(id, p, `친구${i}`);
  let h = await service.read(id, host);
  assert.equal(h.readyCount, 4);
  assert.equal(h.canStart, true);
  h = await service.host(id, host, {
    action: "settings",
    settingsVersion: h.settingsVersion,
    settings: { ...h.settings, drawingSeconds: 60 },
  });
  assert.equal(h.readyCount, 4);
  assert.ok(h.players.every((p) => p.ready));
  h = await service.host(id, host, { action: "start", revision: h.revision });
  assert.equal(h.drawing?.stage, "prompt");
  assert.equal(h.drawing?.roster.length, 4);
  assert.ok(h.drawing?.assignment);
  assert.equal(view.players.length, 4);
  const fresh = await service.read(id, person());
  assert.equal(fresh.drawing, null);
  assert.equal(fresh.players.length, 0);
});
test("drawing image IDs are bound to the submitting room, participant and phase", async () => {
  const host = person(owner),
    players = [host, person(), person(), person()];
  const { id } = await service.create(owner, {
    gameType: "drawing",
    title: "그림 소유권",
    capacity: 4,
    minPlayers: 4,
  });
  for (const [i, p] of players.entries()) await join(id, p, `닉네임${i}`, i === 0);
  let view = await service.read(id, host);
  view = await service.host(id, host, { action: "start", revision: view.revision });
  for (const p of players) {
    const v = await service.read(id, p);
    await service.player(id, p, {
      action: "drawing-text",
      runId: v.drawing!.runId,
      phaseId: v.drawing!.phaseId,
      text: "그림으로 표현할 문장",
    });
  }
  view = await service.read(id, host);
  assert.equal(view.drawing!.stage, "draw");
  const assetId = randomUUID();
  await db.insert(gameAssets).values({
    id: assetId,
    roomId: id,
    uploaderHash: players[1]!.identityHash,
    runId: view.drawing!.runId,
    phaseId: view.drawing!.phaseId,
    kind: "drawing",
    status: "ready",
    storageBackend: "local",
    objectKey: `${randomUUID()}.webp`,
    contentType: "image/webp",
    byteSize: 20,
    expiresAt: new Date(now.getTime() + 86400000),
  });
  await assert.rejects(
    service.player(id, host, {
      action: "drawing-image",
      runId: view.drawing!.runId,
      phaseId: view.drawing!.phaseId,
      assetId,
    }),
  );
  const mine = await service.read(id, players[1]!);
  await service.player(id, players[1]!, {
    action: "drawing-image",
    runId: mine.drawing!.runId,
    phaseId: mine.drawing!.phaseId,
    assetId,
  });
});
test("two-player photo games hide coordinates and finish once, extending result retention", async () => {
  const host = person(owner),
    guest = person();
  const { id } = await service.create(owner, {
    gameType: "clue",
    title: "단서각 테스트",
    capacity: 2,
    minPlayers: 2,
    clueRounds: 1,
  });
  await join(id, host, "호스트", true);
  await join(id, guest, "게스트");
  let v = await service.read(id, host);
  v = await service.host(id, host, { action: "start", revision: v.revision });
  assert.equal(v.clue!.stage, "guess");
  assert.ok(!JSON.stringify(v.clue).includes('"latitude"'));
  const [state] = await db.select().from(gameRooms).where(eq(gameRooms.id, id));
  const point = state!.clue!.deck[0]!.point!;
  now = new Date(now.getTime() + 5000);
  for (const p of [host, guest]) {
    const a = await service.read(id, p);
    await service.player(id, p, {
      action: "clue-answer",
      runId: a.clue!.runId,
      phaseId: a.clue!.phaseId,
      point,
    });
  }
  v = await service.read(id, host);
  assert.equal(v.clue!.stage, "review");
  assert.deepEqual(
    v.clue!.roster.map((p) => p.score),
    [1, 1],
  );
  now = new Date(now.getTime() + 15000);
  v = await service.read(id, host);
  assert.equal(v.phase, "finished");
  assert.equal(new Date(v.expiresAt).getTime(), now.getTime() + 86400000);
  assert.deepEqual(
    v.clue!.roster.map((p) => p.score),
    [1, 1],
  );
});
test("room media policy denies waiting/left visitors and hides another person's unrevealed media", async () => {
  const host = person(owner),
    guest = person();
  const { id } = await service.create(owner, {
    gameType: "clue",
    title: "사진 권한 테스트",
    capacity: 2,
    minPlayers: 2,
  });
  await join(id, guest, "참가자");
  const v = await service.read(id, guest),
    asset = { id: randomUUID(), uploaderHash: guest.identityHash };
  assert.equal(canReadGameAsset(v, asset, guest.identityHash), true);
  assert.equal(canReadGameAsset(v, { ...asset, uploaderHash: hash() }, guest.identityHash), false);
  assert.equal(
    canReadGameAsset({ ...v, viewer: { ...v.viewer, status: "left" } }, asset, guest.identityHash),
    false,
  );
  assert.throws(() => requireGameUpload(v, "photo", null));
  const h = await service.read(id, host);
  requireGameUpload(h, "photo", null);
});
test("expiry first enqueues durable cleanup and then removes result metadata, leaving other room data intact", async () => {
  const { id } = await service.create(owner, {
    gameType: "clue",
    title: "만료 정리",
    capacity: 2,
    minPlayers: 2,
  });
  const other = await service.create(owner, { title: "보존할 대기실", capacity: 2, minPlayers: 2 });
  const objectKey = `${randomUUID()}.webp`;
  await db.insert(gameAssets).values({
    roomId: id,
    uploaderHash: hash(),
    kind: "photo",
    status: "ready",
    storageBackend: "local",
    objectKey,
    contentType: "image/webp",
    byteSize: 10,
    expiresAt: new Date(now.getTime() - 1),
  });
  await db
    .update(gameRooms)
    .set({ expiresAt: new Date(now.getTime() - 1) })
    .where(eq(gameRooms.id, id));
  const result = await cleanupGameAssets(connection, now);
  assert.equal(result.processed, 1);
  assert.equal((await db.select().from(gameRooms).where(eq(gameRooms.id, id))).length, 0);
  assert.equal((await db.select().from(gameRooms).where(eq(gameRooms.id, other.id))).length, 1);
  const jobs = await db.select().from(objectCleanupJobs);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.objectKey, objectKey);
  assert.equal(jobs[0]!.reason, "game-expired");
});

test("completed results survive room reset, refuse outsiders, and expire exactly from completion", async () => {
  const host = person(owner),
    guest = person();
  const { id } = await service.create(owner, {
    gameType: "clue",
    title: "결과 보관 테스트",
    capacity: 2,
    minPlayers: 2,
    clueRounds: 1,
  });
  await join(id, host, "호스트", true);
  await join(id, guest, "참가자");
  let v = await service.read(id, host);
  v = await service.host(id, host, { action: "start", revision: v.revision });
  const run = v.clue!.runId!;
  now = new Date(now.getTime() + 75000);
  v = await service.read(id, host);
  assert.equal(v.phase, "finished");
  await service.host(id, host, { action: "reset", revision: v.revision });
  const result = await readGameRun(connection, id, run, guest, now);
  assert.equal(result.clue!.stage, "result");
  assert.equal(result.clue!.results.length, 1);
  assert.ok(!("members" in result));
  assert.equal(result.viewer.id, v.players.find((p) => p.nickname === "참가자")!.id);
  await assert.rejects(readGameRun(connection, id, run, person(), now));
  await assert.rejects(readGameRun(connection, id, run, guest, new Date(now.getTime() + 86400000)));
});
