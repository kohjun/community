import { WORD_BANKS } from "../src/server/word-bank";
import { WORD_CATEGORY_IDS, normalizeWordGuess } from "../src/domain/word-liar";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq, sql } from "drizzle-orm";
import { profiles } from "../src/db/schema";
import { gameRooms, gamePlayers, gameRequestLimits } from "../src/db/game-room-schema";
import { memberSafety } from "../src/db/safety-schema";
import type { Database } from "../src/db/connection";
import { gameRoomService, type GamePrincipal } from "../src/server/game-room-service";
import {
  issueGameSession,
  verifyGameSession,
  gameDigest,
  gameNetworkKey,
} from "../src/server/game-session";
import {
  createGameRoomSchema,
  gameHostActionSchema,
  gamePlayerActionSchema,
  GAME_LEASE_MS,
  GAME_ROOM_TTL_MS,
} from "../src/domain/game-room";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database;
let now = new Date("2026-10-30T03:00:00Z"),
  owner: string,
  outsider: string,
  roomId: string;
const wakes: string[] = [];
const service = gameRoomService(connection, {
  now: () => now,
  wake: async (id) => {
    wakes.push(id);
  },
});
const hash = () => randomBytes(32).toString("hex"),
  sharedNetwork = hash();
const person = (actor: string | null = null): GamePrincipal => ({
  identityHash: hash(),
  networkHash: sharedNetwork,
  actor,
});
const host = () => ({ ...person(owner) });
const code = (expected: string) => (e: unknown) => e instanceof AppError && e.code === expected;
async function member() {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(profiles).values({ id, nickname: "게임호스트" });
  return id;
}
async function joinReady(who: GamePrincipal, nickname: string) {
  await service.connect(roomId, who);
  await service.player(roomId, who, { action: "nickname", nickname });
  return service.player(roomId, who, { action: "ready", ready: true });
}
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade");
  now = new Date("2026-10-30T03:00:00Z");
  owner = await member();
  outsider = await member();
  roomId = (await service.create(owner, { title: "슬리퍼 게임", capacity: 2, minPlayers: 2 })).id;
  wakes.length = 0;
});
after(() => pg.close());
test("signed sessions reject tampering, expiry and future issue times; room hashes do not correlate players", () => {
  const secret = randomBytes(32).toString("hex"),
    tick = now.getTime();
  const token = issueGameSession(secret, tick),
    id = verifyGameSession(token, secret, tick);
  assert.ok(id);
  assert.equal(verifyGameSession(token, secret, tick + GAME_ROOM_TTL_MS), null);
  assert.equal(verifyGameSession(token, secret, tick - 120000), null);
  assert.equal(
    verifyGameSession(
      token.replace(/.$/, (v) => (v === "a" ? "b" : "a")),
      secret,
      tick,
    ),
    null,
  );
  assert.equal(verifyGameSession(token + ".extra", secret, tick), null);
  assert.equal(verifyGameSession(undefined, secret, tick), null);
  assert.notEqual(gameDigest(secret, "player:one", id), gameDigest(secret, "player:two", id));
  assert.equal(
    gameNetworkKey(new Headers({ "x-real-ip": "127.0.0.1" }), secret, roomId),
    gameNetworkKey(new Headers({ "x-real-ip": "127.0.0.1" }), secret, roomId),
  );
});
test("strict inputs reject authority injection, impossible counts and invisible nicknames", () => {
  assert.equal(createGameRoomSchema.safeParse({ title: "게임", capacity: 1 }).success, false);
  assert.equal(
    createGameRoomSchema.safeParse({ title: "게임", capacity: 2, minPlayers: 3 }).success,
    false,
  );
  assert.equal(createGameRoomSchema.safeParse({ title: "게임", hostId: owner }).success, false);
  assert.equal(
    gamePlayerActionSchema.safeParse({ action: "ready", ready: true, playerId: randomUUID() })
      .success,
    false,
  );
  assert.equal(
    gamePlayerActionSchema.safeParse({ action: "nickname", nickname: "가\u200b나" }).success,
    false,
  );
  assert.equal(gameHostActionSchema.safeParse({ action: "start", revision: -1 }).success, false);
});
test("host is a non-playing moderator and shared IP devices receive separate FIFO seats", async () => {
  const moderator = await service.connect(roomId, host());
  assert.equal(moderator.viewer.status, "host");
  assert.equal(moderator.players.length, 0);
  const a = person(),
    b = person(),
    c = person();
  const first = await service.connect(roomId, a),
    second = await service.connect(roomId, b),
    third = await service.connect(roomId, c);
  assert.equal(first.viewer.status, "admitted");
  assert.equal(second.viewer.status, "admitted");
  assert.equal(third.viewer.queuePosition, 1);
  assert.notEqual(first.viewer.id, second.viewer.id);
  assert.equal(third.players.length, 2);
});
test("repeat joins and refreshes reuse one ticket and do not overfill the room", async () => {
  const a = person();
  const first = await service.connect(roomId, a);
  for (let i = 0; i < 5; i++)
    assert.equal((await service.connect(roomId, a)).viewer.id, first.viewer.id);
  const rows = await db.select().from(gamePlayers).where(eq(gamePlayers.roomId, roomId));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.ticket, 1);
});
test("leaving and kicking promote the oldest waiting device, rejoin goes to the back", async () => {
  const a = person(),
    b = person(),
    c = person(),
    d = person();
  for (const who of [a, b, c, d]) await service.connect(roomId, who);
  await service.player(roomId, a, { action: "leave" });
  assert.equal((await service.read(roomId, c)).viewer.status, "admitted");
  assert.equal((await service.read(roomId, d)).viewer.queuePosition, 1);
  assert.equal((await service.connect(roomId, a)).viewer.queuePosition, 2);
  const state = await service.read(roomId, host());
  const target = state.players.find((p) => p.id === state.players[0]?.id)!;
  await service.host(roomId, host(), {
    action: "kick",
    playerId: target.id,
    revision: state.revision,
  });
  assert.equal((await service.read(roomId, d)).viewer.status, "admitted");
});
test("start requires every admitted player to set a nickname and be ready; guests cannot start", async () => {
  const a = person(),
    b = person();
  await service.connect(roomId, a);
  await service.connect(roomId, b);
  await assert.rejects(
    service.player(roomId, a, { action: "ready", ready: true }),
    code("VALIDATION"),
  );
  let state = await service.read(roomId, host());
  await assert.rejects(
    service.host(roomId, host(), { action: "start", revision: state.revision }),
    code("CONFLICT"),
  );
  await joinReady(a, "플레이어가");
  await joinReady(b, "플레이어나");
  state = await service.read(roomId, host());
  assert.equal(state.canStart, true);
  await assert.rejects(
    service.host(roomId, a, { action: "start", revision: state.revision }),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    service.host(roomId, person(outsider), { action: "start", revision: state.revision }),
    code("FORBIDDEN"),
  );
  const started = await service.host(roomId, host(), { action: "start", revision: state.revision });
  assert.equal(started.phase, "playing");
  assert.equal(started.startedAt, now.toISOString());
});
test("stale revisions cannot start after a player unreadies, repeated start preserves the timestamp", async () => {
  const a = person(),
    b = person();
  await joinReady(a, "첫번째");
  await joinReady(b, "두번째");
  const before = await service.read(roomId, host());
  await service.player(roomId, a, { action: "ready", ready: false });
  await assert.rejects(
    service.host(roomId, host(), { action: "start", revision: before.revision }),
    code("CONFLICT"),
  );
  await service.player(roomId, a, { action: "ready", ready: true });
  const ready = await service.read(roomId, host());
  const started = await service.host(roomId, host(), { action: "start", revision: ready.revision });
  now = new Date(now.getTime() + 1000);
  const again = await service.host(roomId, host(), { action: "start", revision: ready.revision });
  assert.equal(again.startedAt, started.startedAt);
  assert.equal(again.revision, started.revision);
});
test("running rounds freeze entry; finish and reset admit queued players and clear readiness", async () => {
  const a = person(),
    b = person(),
    c = person();
  await joinReady(a, "참가가");
  await joinReady(b, "참가나");
  let state = await service.read(roomId, host());
  state = await service.host(roomId, host(), { action: "start", revision: state.revision });
  await service.player(roomId, a, { action: "leave" });
  const queued = await service.connect(roomId, c);
  assert.equal(queued.viewer.status, "waiting");
  await assert.rejects(
    service.player(roomId, b, { action: "nickname", nickname: "다른이름" }),
    code("CONFLICT"),
  );
  state = await service.read(roomId, host());
  state = await service.host(roomId, host(), { action: "finish", revision: state.revision });
  assert.equal(state.phase, "finished");
  state = await service.host(roomId, host(), { action: "reset", revision: state.revision });
  assert.equal(state.phase, "lobby");
  assert.equal(state.round, 2);
  assert.equal(state.readyCount, 0);
  assert.equal(state.startedAt, null);
  assert.equal((await service.read(roomId, c)).viewer.status, "admitted");
});
test("lobby lease expiry promotes active waiters; live round seats survive temporary disconnects", async () => {
  const a = person(),
    b = person(),
    c = person();
  await service.connect(roomId, a);
  await service.connect(roomId, b);
  await service.connect(roomId, c);
  now = new Date(now.getTime() + GAME_LEASE_MS - 1000);
  await service.player(roomId, c, { action: "heartbeat" });
  now = new Date(now.getTime() + 2000);
  const view = await service.read(roomId, c);
  assert.equal(view.viewer.status, "admitted");
  assert.equal(view.players.length, 1);
  assert.equal((await service.read(roomId, a)).viewer.status, "left");
  await service.connect(roomId, b);
  await joinReady(c, "연결유지");
  await joinReady(b, "연결중단");
  let state = await service.read(roomId, host());
  await service.host(roomId, host(), { action: "start", revision: state.revision });
  now = new Date(now.getTime() + GAME_LEASE_MS + 1);
  state = await service.read(roomId, b);
  assert.equal(state.viewer.status, "admitted");
  assert.equal(state.players.length, 2);
  assert.equal(state.players[0]!.online, false);
});
test("case-insensitive nicknames are unique; nickname edits revoke readiness", async () => {
  const a = person(),
    b = person();
  await joinReady(a, "Alice");
  await service.connect(roomId, b);
  await assert.rejects(
    service.player(roomId, b, { action: "nickname", nickname: "aLiCe" }),
    code("CONFLICT"),
  );
  const state = await service.player(roomId, a, { action: "nickname", nickname: "다른이름" });
  assert.equal(state.viewer.ready, false);
});
test("kicked browsers cannot rejoin or impersonate another player and receive no roster", async () => {
  const a = person();
  let state = await service.connect(roomId, a);
  const id = state.viewer.id!;
  state = await service.read(roomId, host());
  await service.host(roomId, host(), { action: "kick", playerId: id, revision: state.revision });
  await assert.rejects(service.connect(roomId, a), code("FORBIDDEN"));
  await assert.rejects(
    service.player(roomId, a, { action: "ready", ready: true }),
    code("FORBIDDEN"),
  );
  assert.deepEqual((await service.read(roomId, a)).players, []);
});
test("room snapshots omit IPs, hashes, account IDs and other queue identities", async () => {
  const a = person(),
    b = person(),
    c = person();
  await service.connect(roomId, a);
  await service.connect(roomId, b);
  await service.connect(roomId, c);
  const view = await service.read(roomId, c),
    json = JSON.stringify(view);
  assert.equal(view.waiting.length, 0);
  assert.equal(json.includes(a.identityHash), false);
  assert.equal(json.includes(sharedNetwork), false);
  assert.equal(json.includes(owner), false);
  assert.deepEqual((await service.read(roomId, person())).players, []);
});
test("suspended hosts and authenticated non-owners cannot read host state or mutate the room", async () => {
  await assert.rejects(service.connect(roomId, person(outsider)), code("FORBIDDEN"));
  await db.insert(memberSafety).values({
    userId: owner,
    status: "suspended",
    suspendedUntil: new Date(now.getTime() + 3600000),
  });
  await assert.rejects(service.read(roomId, host()), code("FORBIDDEN"));
  await assert.rejects(service.create(owner, { title: "새 게임" }), code("FORBIDDEN"));
});
test("closed and expired rooms cannot accept more guests", async () => {
  const a = person();
  await service.connect(roomId, a);
  let state = await service.read(roomId, host());
  state = await service.host(roomId, host(), { action: "close", revision: state.revision });
  assert.equal(state.phase, "closed");
  await assert.rejects(service.connect(roomId, person()), code("CONFLICT"));
  assert.equal((await service.read(roomId, a)).players.length, 0);
  now = new Date(now.getTime() + GAME_ROOM_TTL_MS);
  await assert.rejects(service.read(roomId, host()), code("NOT_FOUND"));
});
test("guest rate limits are durable in Postgres and reset in a new window", async () => {
  const a = person();
  await service.connect(roomId, a);
  for (let i = 0; i < 49; i++) await service.player(roomId, a, { action: "heartbeat" });
  await assert.rejects(service.player(roomId, a, { action: "heartbeat" }), code("RATE_LIMITED"));
  now = new Date(now.getTime() + 60000);
  await service.player(roomId, a, { action: "heartbeat" });
});
test("migrations enable RLS and deny browser role table access for all game state", async () => {
  const rows = await db.execute(
    sql`select relname, relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='sliper' and relname in ('game_rooms','game_players','game_request_limits')`,
  );
  assert.equal(rows.rows.length, 3);
  assert.ok(rows.rows.every((v) => (v as { relrowsecurity: boolean }).relrowsecurity));
  for (const table of ["game_rooms", "game_players", "game_request_limits"]) {
    const result = await pg.query<{ allowed: boolean }>(
      "select has_table_privilege('anon', $1, 'SELECT') as allowed",
      [`sliper.${table}`],
    );
    assert.equal(result.rows[0]!.allowed, false);
  }
  assert.ok(await db.select().from(gameRooms));
  assert.ok(
    await db
      .select()
      .from(gameRequestLimits)
      .where(
        and(eq(gameRequestLimits.roomId, roomId), eq(gameRequestLimits.subjectHash, sharedNetwork)),
      ),
  );
});

test("host room recovery only lists the authenticated owner's unexpired rooms", async () => {
  const otherRoom = await service.create(outsider, { title: "다른 호스트의 게임" });
  assert.deepEqual(
    (await service.mine(owner)).map((v) => v.id),
    [roomId],
  );
  assert.deepEqual(
    (await service.mine(outsider)).map((v) => v.id),
    [otherRoom.id],
  );
  await assert.rejects(service.mine(null), code("UNAUTHENTICATED"));
  now = new Date(now.getTime() + GAME_ROOM_TTL_MS);
  assert.deepEqual(await service.mine(owner), []);
});

async function mbtiRoom(count = 6, revealLiar = false) {
  roomId = (
    await service.create(owner, {
      title: "MBTI 위장 게임",
      gameType: "mbti",
      revealLiar,
      capacity: count,
      minPlayers: 3,
    })
  ).id;
  const people = Array.from({ length: count }, () => person());
  for (let i = 0; i < count; i++) await joinReady(people[i]!, `플레이어${i + 1}`);
  let view = await service.read(roomId, host());
  view = await service.host(roomId, host(), { action: "start", revision: view.revision });
  const [raw] = await db.select().from(gameRooms).where(eq(gameRooms.id, roomId));
  return { people, view, state: raw!.mbti! };
}
async function mbtiVoting(count: number) {
  for (let i = 0; i < count; i++) {
    now = new Date(now.getTime() + 30_000);
    await service.read(roomId, host());
  }
  return service.read(roomId, host());
}
test("MBTI private projections expose one assignment only; host, strangers and waiting guests get no secrets", async () => {
  const { people, state } = await mbtiRoom();
  const assignments = [];
  const hostView = await service.read(roomId, host());
  assert.equal(hostView.mbti!.assignment, null);
  assert.equal(hostView.mbti!.isLiar, null);
  assert.equal(hostView.mbti!.result, null);
  assert.ok(!JSON.stringify(hostView).includes('"common"'));
  assert.ok(!JSON.stringify(hostView).includes('"odd"'));
  assert.ok(!JSON.stringify(hostView).includes('"liar"'));
  for (const p of people) {
    const v = await service.read(roomId, p);
    assignments.push(v.mbti!.assignment);
    assert.equal(v.mbti!.isLiar, null);
    assert.equal(v.mbti!.liarId, null);
    assert.equal(v.mbti!.result, null);
  }
  assert.equal(assignments.filter((x) => x === state.common).length, 5);
  assert.equal(assignments.filter((x) => x === state.odd).length, 1);
  assert.notEqual(state.common, state.odd);
  const stranger = person();
  assert.equal((await service.read(roomId, stranger)).mbti, null);
  assert.equal((await service.connect(roomId, stranger)).mbti, null);
  await assert.rejects(
    service.player(roomId, stranger, { action: "mbti-vote", cycle: 1, target: null }),
    code("FORBIDDEN"),
  );
});
test("MBTI six players require four votes; wrong suspicions eliminate nobody; only liar can make final common-MBTI guess", async () => {
  const { people, state } = await mbtiRoom();
  const liarIndex = state.roster.findIndex((p) => p.id === state.liar),
    liar = people[liarIndex]!;
  let view = await mbtiVoting(6);
  assert.equal(view.mbti!.stage, "voting");
  assert.equal(view.mbti!.majority, 4);
  const ordinary = people.filter((_, i) => i !== liarIndex);
  for (const p of ordinary.slice(0, 3))
    await service.player(roomId, p, { action: "mbti-vote", cycle: 1, target: state.liar });
  view = await service.read(roomId, host());
  view = await service.host(roomId, host(), { action: "mbti-tally", revision: view.revision });
  assert.equal(view.mbti!.tally!.outcome, "no-majority");
  assert.equal(view.mbti!.liarId, null);
  view = await service.host(roomId, host(), { action: "mbti-next", revision: view.revision });
  view = await mbtiVoting(6);
  const wrong = state.roster.find((p) => p.id !== state.liar)!.id;
  for (let i = 0; i < people.length; i++)
    if (state.roster[i]!.id !== wrong && i !== liarIndex)
      await service.player(roomId, people[i]!, { action: "mbti-vote", cycle: 2, target: wrong });
  view = await service.read(roomId, host());
  view = await service.host(roomId, host(), { action: "mbti-tally", revision: view.revision });
  assert.equal(view.mbti!.tally!.outcome, "wrong");
  assert.equal(view.players.length, 6);
  assert.equal(view.mbti!.liarId, null);
  view = await service.host(roomId, host(), { action: "mbti-next", revision: view.revision });
  await mbtiVoting(6);
  await assert.rejects(
    service.player(roomId, ordinary[0]!, { action: "mbti-vote", cycle: 2, target: state.liar }),
    code("CONFLICT"),
  );
  for (const p of ordinary.slice(0, 4))
    await service.player(roomId, p, { action: "mbti-vote", cycle: 3, target: state.liar });
  view = await service.read(roomId, host());
  view = await service.host(roomId, host(), { action: "mbti-tally", revision: view.revision });
  assert.equal(view.mbti!.stage, "guess");
  assert.equal(view.mbti!.assignment, null);
  assert.equal(view.mbti!.result, null);
  await assert.rejects(
    service.player(roomId, ordinary[0]!, { action: "mbti-guess", cycle: 3, guess: state.common }),
    code("FORBIDDEN"),
  );
  view = await service.player(roomId, liar, {
    action: "mbti-guess",
    cycle: 3,
    guess: state.common,
  });
  assert.equal(view.phase, "finished");
  assert.equal(view.mbti!.result!.winner, "liar");
  await assert.rejects(
    service.player(roomId, liar, { action: "mbti-guess", cycle: 3, guess: state.odd }),
    code("FORBIDDEN"),
  );
  view = await service.host(roomId, host(), { action: "reset", revision: view.revision });
  assert.equal(view.mbti!.stage, "lobby");
  assert.equal(view.mbti!.assignment, null);
  assert.equal(view.mbti!.result, null);
});
test("MBTI reveal mode, abstention, automatic tally and incorrect final guess award the players", async () => {
  const { people, state } = await mbtiRoom(3, true);
  const liarIndex = state.roster.findIndex((p) => p.id === state.liar);
  for (let i = 0; i < people.length; i++)
    assert.equal((await service.read(roomId, people[i]!)).mbti!.isLiar, i === liarIndex);
  await mbtiVoting(3);
  for (let i = 0; i < people.length; i++)
    await service.player(roomId, people[i]!, {
      action: "mbti-vote",
      cycle: 1,
      target: i === liarIndex ? null : state.liar,
    });
  const view = await service.player(roomId, people[liarIndex]!, {
    action: "mbti-guess",
    cycle: 1,
    guess: state.odd,
  });
  assert.equal(view.mbti!.result!.winner, "players");
});

const introWords = ["ENFP", "ISTJ", "ENTP", "ISFJ"] as const;
async function introRoom(maxRounds = 2) {
  roomId = (
    await service.create(owner, {
      title: "MBTI 자기소개 게임",
      gameType: "mbti-intro",
      maxRounds,
      capacity: 4,
      minPlayers: 3,
    })
  ).id;
  const people = Array.from({ length: 4 }, () => person());
  for (let i = 0; i < 4; i++) {
    await service.connect(roomId, people[i]!);
    await service.player(roomId, people[i]!, {
      action: "intro-profile",
      nickname: `소개배우${i + 1}`,
      mbti: introWords[i],
      shareAtEnd: true,
    });
    await service.player(roomId, people[i]!, { action: "ready", ready: true });
  }
  let v = await service.read(roomId, host());
  v = await service.host(roomId, host(), { action: "start", revision: v.revision });
  const [raw] = await db.select().from(gameRooms).where(eq(gameRooms.id, roomId));
  return { people, view: v, roster: raw!.intro!.roster };
}
async function explainIntro(people: GamePrincipal[], round: number) {
  for (let i = 0; i < people.length; i++)
    await service.player(roomId, people[i]!, { action: "intro-turn-done", round, turn: i });
}
test("intro registration requires explicit end sharing and MBTI before ready; host and strangers see no personal answers", async () => {
  roomId = (
    await service.create(owner, {
      title: "MBTI 자기소개",
      gameType: "mbti-intro",
      capacity: 3,
      minPlayers: 3,
    })
  ).id;
  const p = person();
  await service.connect(roomId, p);
  await service.player(roomId, p, { action: "nickname", nickname: "소개참가자" });
  await assert.rejects(
    service.player(roomId, p, { action: "ready", ready: true }),
    code("VALIDATION"),
  );
  assert.throws(() =>
    service.player(roomId, p, {
      action: "intro-profile",
      nickname: "소개참가자",
      mbti: "ENFP",
      shareAtEnd: false,
    }),
  );
  const own = await service.player(roomId, p, {
    action: "intro-profile",
    nickname: "소개참가자",
    mbti: "ENFP",
    shareAtEnd: true,
  });
  assert.equal(own.mbtiIntro!.myMbti, "ENFP");
  const admin = await service.read(roomId, host());
  assert.equal(admin.mbtiIntro!.myMbti, null);
  assert.equal(admin.mbtiIntro!.answers, null);
  assert.ok(!Object.hasOwn(admin.mbtiIntro!, "registered"));
  assert.equal((await service.read(roomId, person())).mbtiIntro, null);
  await service.player(roomId, p, { action: "leave" });
  const [raw] = await db.select().from(gameRooms).where(eq(gameRooms.id, roomId));
  assert.deepEqual(raw!.intro!.registered, {});
});
test("intro speaking turns gate submission, reject another speaker and stale completion; counts-only feedback precedes a new full round", async () => {
  const { people, roster } = await introRoom();
  const answers = (id: string) =>
    roster.filter((p) => p.id !== id).map((p) => ({ playerId: p.id, mbti: p.mbti }));
  await assert.rejects(
    service.player(roomId, people[0]!, {
      action: "intro-submit",
      round: 1,
      guesses: answers(roster[0]!.id),
    }),
    code("CONFLICT"),
  );
  await assert.rejects(
    service.player(roomId, people[1]!, { action: "intro-turn-done", round: 1, turn: 0 }),
    code("FORBIDDEN"),
  );
  await service.player(roomId, people[0]!, { action: "intro-turn-done", round: 1, turn: 0 });
  await assert.rejects(
    service.player(roomId, people[0]!, { action: "intro-turn-done", round: 1, turn: 0 }),
    code("CONFLICT"),
  );
  for (let i = 1; i < 4; i++)
    await service.player(roomId, people[i]!, { action: "intro-turn-done", round: 1, turn: i });
  const partial = answers(roster[0]!.id);
  partial[2]!.mbti = "INFJ";
  let v = await service.player(roomId, people[0]!, {
    action: "intro-submit",
    round: 1,
    guesses: partial,
  });
  assert.equal(v.mbtiIntro!.history[0]!.correct, 2);
  assert.equal(v.mbtiIntro!.history[0]!.incorrect, 1);
  assert.equal(v.mbtiIntro!.answers, null);
  await assert.rejects(
    service.player(roomId, people[0]!, { action: "intro-submit", round: 1, guesses: partial }),
    code("CONFLICT"),
  );
  for (let i = 1; i < 4; i++)
    await service.player(roomId, people[i]!, {
      action: "intro-submit",
      round: 1,
      guesses: answers(roster[i]!.id).map((g) => ({ ...g, mbti: "INFJ" })),
    });
  v = await service.read(roomId, host());
  assert.equal(v.mbtiIntro!.stage, "review");
  assert.deepEqual(v.mbtiIntro!.history, []);
  assert.ok(v.mbtiIntro!.roster.every((p) => !Object.hasOwn(p, "mbti")));
  v = await service.host(roomId, host(), { action: "intro-next", revision: v.revision });
  assert.equal(v.mbtiIntro!.round, 2);
  assert.equal(v.mbtiIntro!.stage, "acting");
  assert.equal(v.mbtiIntro!.speakerId, roster[0]!.id);
  await explainIntro(people, 2);
  v = await service.player(roomId, people[0]!, {
    action: "intro-submit",
    round: 2,
    guesses: answers(roster[0]!.id),
  });
  assert.equal(v.phase, "finished");
  assert.equal(v.mbtiIntro!.winner, roster[0]!.id);
  assert.equal(v.mbtiIntro!.answers!.length, 4);
  await assert.rejects(
    service.player(roomId, people[1]!, {
      action: "intro-submit",
      round: 2,
      guesses: answers(roster[1]!.id),
    }),
    code("FORBIDDEN"),
  );
});
test("intro validates complete non-self guesses, freezes personal MBTI and reveals all only at the round limit; reset clears registration", async () => {
  const { people, roster } = await introRoom(1);
  await explainIntro(people, 1);
  await assert.rejects(
    service.player(roomId, people[0]!, {
      action: "intro-profile",
      nickname: "변경시도",
      mbti: "INTJ",
      shareAtEnd: true,
    }),
    code("CONFLICT"),
  );
  await assert.rejects(
    service.player(roomId, people[0]!, {
      action: "intro-submit",
      round: 1,
      guesses: [{ playerId: roster[0]!.id, mbti: "INFJ" }],
    }),
    code("VALIDATION"),
  );
  await assert.rejects(
    service.player(roomId, people[0]!, {
      action: "intro-submit",
      round: 1,
      guesses: roster.slice(1).map(() => ({ playerId: roster[1]!.id, mbti: "INFJ" })),
    }),
    code("VALIDATION"),
  );
  let v = await service.read(roomId, host());
  v = await service.host(roomId, host(), { action: "intro-end-round", revision: v.revision });
  assert.equal(v.phase, "finished");
  assert.equal(v.mbtiIntro!.stage, "result");
  assert.equal(v.mbtiIntro!.winner, null);
  assert.deepEqual(
    v.mbtiIntro!.answers!.map((p) => p.mbti),
    [...introWords],
  );
  v = await service.host(roomId, host(), { action: "reset", revision: v.revision });
  assert.equal(v.mbtiIntro!.answers, null);
  assert.equal(v.mbtiIntro!.myMbti, null);
  assert.equal(v.canStart, false);
});

test("word categories contain distinct server-owned pools and invalid category/mode/guess inputs are rejected", () => {
  assert.equal(WORD_CATEGORY_IDS.length, 8);
  let count = 0;
  for (const category of WORD_CATEGORY_IDS) {
    const words = WORD_BANKS[category];
    assert.equal(words.length, 20);
    assert.equal(new Set(words.map(normalizeWordGuess)).size, 20);
    assert.ok(words.every((w) => w.length > 0 && w.length <= 40));
    count += words.length;
  }
  assert.equal(count, 160);
  assert.equal(
    createGameRoomSchema.safeParse({
      title: "라이어 게임",
      gameType: "word-liar",
      wordCategory: "forged",
    }).success,
    false,
  );
  assert.equal(
    gamePlayerActionSchema.safeParse({ action: "word-guess", cycle: 1, guess: " " }).success,
    false,
  );
});
async function wordRoom(mode: "classic" | "undercover" | "undercover-reveal" = "classic") {
  roomId = (
    await service.create(owner, {
      title: "제시어 라이어 게임",
      gameType: "word-liar",
      wordCategory: "food",
      wordMode: mode,
      capacity: 3,
      minPlayers: 3,
    })
  ).id;
  const people = Array.from({ length: 3 }, () => person());
  for (let i = 0; i < 3; i++) await joinReady(people[i]!, `단어배우${i + 1}`);
  let v = await service.read(roomId, host());
  v = await service.host(roomId, host(), { action: "start", revision: v.revision });
  const [raw] = await db.select().from(gameRooms).where(eq(gameRooms.id, roomId));
  return { people, state: raw!.mbti!, view: v };
}
test("classic word liar receives no common word, only the liar role; guests and host cannot see answers; final guess tolerates spacing", async () => {
  const { people, state, view } = await wordRoom();
  assert.equal(view.gameType, "word-liar");
  assert.equal(view.mbti!.assignment, null);
  assert.equal(view.mbti!.result, null);
  assert.equal(view.mbti!.liarId, null);
  assert.ok(!Object.hasOwn(view.mbti!, "common"));
  assert.ok(WORD_BANKS.food.includes(state.common!));
  let liarIndex = -1;
  for (let i = 0; i < 3; i++) {
    const v = await service.read(roomId, people[i]!);
    if (v.viewer.id === state.liar) {
      liarIndex = i;
      assert.equal(v.mbti!.assignment, "라이어");
      assert.equal(v.mbti!.isLiar, true);
    } else {
      assert.equal(v.mbti!.assignment, state.common);
      assert.equal(v.mbti!.isLiar, false);
    }
  }
  const waiting = await service.connect(roomId, person());
  assert.equal(waiting.mbti, null);
  await mbtiVoting(3);
  for (let i = 0; i < 3; i++)
    await service.player(roomId, people[i]!, {
      action: "mbti-vote",
      cycle: 1,
      target: i === liarIndex ? null : state.liar,
    });
  await assert.rejects(
    service.player(roomId, people[(liarIndex + 1) % 3]!, {
      action: "word-guess",
      cycle: 1,
      guess: state.common,
    }),
    code("FORBIDDEN"),
  );
  const final = await service.player(roomId, people[liarIndex]!, {
    action: "word-guess",
    cycle: 1,
    guess: state.common!.split("").join(" "),
  });
  assert.equal(final.phase, "finished");
  assert.equal(final.mbti!.result!.winner, "liar");
  const reset = await service.host(roomId, host(), { action: "reset", revision: final.revision });
  assert.deepEqual(reset.mbti!.words, { category: "food", mode: "classic" });
  assert.equal(reset.mbti!.assignment, null);
});
test("undercover word modes give a distinct category word, respect hidden roles, and award players for an incorrect final guess", async () => {
  for (const mode of ["undercover", "undercover-reveal"] as const) {
    const { people, state } = await wordRoom(mode);
    assert.notEqual(state.common, state.odd);
    assert.ok(WORD_BANKS.food.includes(state.odd!));
    const liarIndex = state.roster.findIndex((p) => p.id === state.liar);
    for (let i = 0; i < 3; i++) {
      const v = await service.read(roomId, people[i]!);
      assert.equal(v.mbti!.assignment, i === liarIndex ? state.odd : state.common);
      assert.equal(v.mbti!.isLiar, mode === "undercover" ? null : i === liarIndex);
    }
    await mbtiVoting(3);
    for (let i = 0; i < 3; i++)
      await service.player(roomId, people[i]!, {
        action: "mbti-vote",
        cycle: 1,
        target: i === liarIndex ? null : state.liar,
      });
    const final = await service.player(roomId, people[liarIndex]!, {
      action: "word-guess",
      cycle: 1,
      guess: state.odd,
    });
    assert.equal(final.mbti!.result!.winner, "players");
  }
});
