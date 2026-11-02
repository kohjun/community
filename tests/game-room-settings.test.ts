import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { before, beforeEach, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import type { Database } from "../src/db/connection";
import { profiles } from "../src/db/schema";
import { gameRooms } from "../src/db/game-room-schema";
import { gameRoomService, type GamePrincipal } from "../src/server/game-room-service";
import type { GameRoomSettings, GameRoomView } from "../src/domain/game-room";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg);
let owner: string, host: GamePrincipal, now: Date, roomId: string;
const who = (actor: string | null = null): GamePrincipal => ({
  actor,
  identityHash: randomBytes(32).toString("hex"),
  networkHash: randomBytes(32).toString("hex"),
});
const service = gameRoomService(db as unknown as Database, { now: () => now });
const code = (expected: string) => (e: unknown) => e instanceof AppError && e.code === expected;
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
});
beforeEach(async () => {
  now = new Date("2026-11-01T09:00:00Z");
  owner = randomUUID();
  host = who(owner);
  await pg.query("insert into auth.users values($1)", [owner]);
  await db.insert(profiles).values({ id: owner, nickname: "설정" + owner.slice(0, 8) });
});
after(async () => {
  await pg.close();
});
async function setup(gameType: GameRoomSettings["gameType"] = "toast", capacity = 3) {
  roomId = (
    await service.create(owner, {
      title: "게임 설정 검사",
      gameType,
      capacity,
      minPlayers: gameType === "lobby" ? 2 : 3,
    })
  ).id;
  const guests = [who(), who(), who()];
  for (const [i, p] of guests.entries()) {
    await service.connect(roomId, p);
    if (gameType === "mbti-intro")
      await service.player(roomId, p, {
        action: "intro-profile",
        nickname: "참가자" + i,
        mbti: i === 0 ? "ENFP" : "ISTJ",
        shareAtEnd: true,
      });
    else await service.player(roomId, p, { action: "nickname", nickname: "참가자" + i });
    await service.player(roomId, p, { action: "ready", ready: true });
  }
  return guests;
}
const read = () => service.read(roomId, host);
const raw = async () => (await db.select().from(gameRooms).where(eq(gameRooms.id, roomId)))[0]!;
const save = (v: GameRoomView, patch: Partial<GameRoomSettings>) =>
  service.host(roomId, host, {
    action: "settings",
    settingsVersion: v.settingsVersion,
    settings: { ...v.settings!, ...patch },
  });
test("every game supports its creation options in the lobby while all existing participants stay ready", async () => {
  for (const game of ["toast", "auction", "word-liar", "mbti-intro", "mbti", "lobby"] as const) {
    await setup(game);
    const previous = await read();
    const next = await save(previous, {
      title: "수정한 게임방",
      ...(game === "toast"
        ? { toastMode: "target", toastRounds: 3, toastAnswerSeconds: 60 }
        : game === "auction"
          ? { auctionRounds: 20, auctionInitialMoney: 2000, auctionBidSeconds: 90 }
          : game === "word-liar"
            ? { wordCategory: "animals", wordMode: "undercover-reveal" }
            : game === "mbti-intro"
              ? { maxRounds: 9 }
              : game === "mbti"
                ? { revealLiar: true }
                : {}),
    });
    assert.equal(next.title, "수정한 게임방");
    assert.equal(next.readyCount, 3);
    assert.equal(next.canStart, true);
    assert.notEqual(next.settingsVersion, previous.settingsVersion);
    assert.deepEqual(next.players, previous.players);
    assert.equal(next.phase, "lobby");
    const started = await service.host(roomId, host, { action: "start", revision: next.revision });
    assert.equal(started.phase, "playing");
    if (game === "toast") {
      assert.equal(started.toast!.settings.mode, "target");
      assert.equal(started.toast!.settings.rounds, 3);
      assert.equal(started.toast!.settings.answerSeconds, 60);
    }
    if (game === "auction") {
      assert.equal(started.auction!.settings.maxRounds, 20);
      assert.equal(started.auction!.myCash, null);
      assert.equal(started.auction!.settings.initialMoney, 2000);
      assert.equal(started.auction!.settings.bidSeconds, 90);
    }
    if (game === "word-liar") {
      assert.equal(started.mbti!.words!.category, "animals");
      assert.equal(started.mbti!.words!.mode, "undercover-reveal");
      assert.equal(started.mbti!.assignment, null);
    }
    if (game === "mbti-intro") assert.equal(started.mbtiIntro!.maxRounds, 9);
    if (game === "mbti") assert.equal(started.mbti!.revealLiar, true);
    // Separate test hosts avoid the existing five-room creation quota.
    owner = randomUUID();
    host = who(owner);
    await pg.query("insert into auth.users values($1)", [owner]);
    await db.insert(profiles).values({ id: owner, nickname: "설定" + owner.slice(0, 8) });
  }
});
test("MBTI profile registrations and nickname/readiness survive settings changes and a refresh", async () => {
  const guests = await setup("mbti-intro");
  const before = (await raw()).intro!.registered;
  await save(await read(), { maxRounds: 8 });
  assert.deepEqual((await raw()).intro!.registered, before);
  assert.equal((await service.read(roomId, guests[0]!)).mbtiIntro!.myMbti, "ENFP");
  assert.equal((await service.read(roomId, guests[0]!)).viewer.ready, true);
  assert.equal((await read()).readyCount, 3);
});
test("increasing capacity promotes the FIFO queue without resetting admitted players or making new players ready", async () => {
  await setup();
  const fourth = who();
  await service.connect(roomId, fourth);
  assert.equal((await service.read(roomId, fourth)).viewer.status, "waiting");
  const next = await save(await read(), { capacity: 4 });
  assert.equal(next.players.length, 4);
  assert.equal(next.readyCount, 3);
  assert.equal(next.waitingCount, 0);
  assert.equal(next.players[3]!.ready, false);
  assert.equal(next.canStart, false);
  assert.equal((await service.read(roomId, fourth)).viewer.status, "admitted");
  await assert.rejects(save(next, { capacity: 3 }), code("CONFLICT"));
  assert.equal((await read()).players.length, 4);
});
test("joins, readiness and heartbeat changes do not invalidate an otherwise unchanged settings draft", async () => {
  const guests = await setup();
  const draft = await read();
  await service.player(roomId, guests[0]!, { action: "ready", ready: false });
  await service.player(roomId, guests[1]!, { action: "heartbeat" });
  const nowView = await read();
  assert.equal(nowView.settingsVersion, draft.settingsVersion);
  assert.notEqual(nowView.revision, draft.revision);
  const saved = await save(draft, { toastRounds: 5 });
  assert.equal(saved.settings!.toastRounds, 5);
  assert.equal(saved.readyCount, 2);
  assert.equal(saved.players[0]!.ready, false);
});
test("two competing host settings saves cannot overwrite one another, and repeated identical saves do not change revisions", async () => {
  await setup();
  const v = await read();
  const results = await Promise.allSettled([
    save(v, { toastRounds: 4 }),
    save(v, { toastRounds: 7 }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  const current = await read();
  assert.notEqual(current.settingsVersion, v.settingsVersion);
  const same = await save(current, {});
  assert.equal(same.revision, current.revision);
  assert.equal(same.readyCount, 3);
});
test("guest/other host, midgame, finished and closed modifications fail; game kind changes are not accepted", async () => {
  const guests = await setup();
  let v = await read();
  const payload = {
    action: "settings",
    settingsVersion: v.settingsVersion,
    settings: { ...v.settings!, toastRounds: 3 },
  };
  await assert.rejects(service.host(roomId, guests[0]!, payload), code("FORBIDDEN"));
  await assert.rejects(service.host(roomId, who(randomUUID()), payload), code("FORBIDDEN"));
  await assert.rejects(save(v, { gameType: "auction" }), code("VALIDATION"));
  v = await service.host(roomId, host, { action: "start", revision: v.revision });
  await assert.rejects(save(v, { toastRounds: 4 }), code("CONFLICT"));
  v = await service.host(roomId, host, { action: "finish", revision: v.revision });
  await assert.rejects(save(v, { toastRounds: 4 }), code("CONFLICT"));
  v = await service.host(roomId, host, { action: "reset", revision: v.revision });
  v = await save(v, { toastRounds: 4 });
  assert.equal(v.settings!.toastRounds, 4);
  v = await service.host(roomId, host, { action: "close", revision: v.revision });
  await assert.rejects(save(v, { toastRounds: 5 }), code("CONFLICT"));
});
test("bounds, policy and current participant auction constraints are checked before mutating any setting", async () => {
  await setup("auction", 4);
  const fourth = who();
  await service.connect(roomId, fourth);
  let v = await read();
  await assert.rejects(save(v, { auctionRounds: 4 }), code("VALIDATION"));
  await assert.rejects(save(v, { minPlayers: 2 }), code("VALIDATION"));
  await assert.rejects(async () => save(v, { title: "씨발 설정" }), code("VALIDATION"));
  await assert.rejects(async () =>
    save(v, { auctionBidSeconds: 5 as GameRoomSettings["auctionBidSeconds"] }),
  );
  assert.equal((await read()).settingsVersion, v.settingsVersion);
  assert.equal((await read()).readyCount, 3);
  v = await save(v, { auctionRounds: 5 });
  assert.equal(v.settings!.auctionRounds, 5);
});
test("public settings and their fingerprint expose no private role, target, registered MBTI or player answers", async () => {
  const guests = await setup("toast");
  const before = await read();
  assert.equal((await service.read(roomId, who())).settings, null);
  assert.deepEqual((await service.read(roomId, guests[0]!)).settings, before.settings);
  const updated = await save(before, { toastMode: "target" });
  await service.host(roomId, host, { action: "start", revision: updated.revision });
  const active = await read();
  assert.equal(active.settingsVersion, updated.settingsVersion);
  const text = JSON.stringify(active.settings);
  for (const key of [
    "questionerId",
    "responses",
    "registered",
    "target",
    "liar",
    "common",
    "assignment",
  ])
    assert.ok(!Object.hasOwn(active.settings!, key));
  assert.ok(!text.includes(guests[0]!.identityHash));
  assert.equal(active.toast!.target, null);
});
