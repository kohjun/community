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
import { createGameRoomSchema, gamePlayerActionSchema } from "../src/domain/game-room";
import {
  newToast,
  startToast,
  askToast,
  answerToast,
  tickToast,
  nextToast,
  skipToast,
  abortToast,
  lastWordToast,
  toastView,
} from "../src/server/toast-game";
import { AppError } from "../src/server/errors";
import type { ToastMode } from "../src/domain/toast-game";
const roster = () => ["가람", "나래", "다온"].map((nickname) => ({ id: randomUUID(), nickname }));
const state = (mode: ToastMode = "basic", rounds = 1) => {
  const s = newToast({ mode, rounds, answerSeconds: 15 });
  startToast(s, roster());
  return s;
};
const question = "나는 여행 전에 일정을 미리 세우는 편이다.";
const error = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;
test("basic prediction includes the questioner, accepts zero and full counts, and rotates through everyone per round", () => {
  const s = state("basic", 2);
  for (let turn = 1; turn <= 6; turn++) {
    const q = s.roster[(turn - 1) % 3]!;
    askToast(s, q.id, turn, question, 1000);
    const expected = turn % 2 ? 3 : 0;
    for (const p of s.roster)
      answerToast(s, p.id, turn, expected === 3, p.id === q.id ? expected : undefined, 1001);
    assert.equal(s.history.at(-1)!.actual, expected);
    assert.equal(s.history.at(-1)!.points, 1);
    if (turn < 6) nextToast(s, turn);
  }
  assert.equal(s.stage, "result");
  assert.deepEqual(
    s.roster.map((p) => p.score),
    [2, 2, 2],
  );
  assert.equal(toastView(s, null, 1002).winners.length, 3);
  assert.deepEqual(
    s.history.map((h) => h.round),
    [1, 1, 1, 2, 2, 2],
  );
});
test("advanced targets are fixed for the turn, hidden from peers and host, and only exact counts score", () => {
  const s = state("target"),
    q = s.roster[0]!;
  s.target = 2;
  assert.equal(toastView(s, q.id, 0).target, 2);
  assert.equal(toastView(s, null, 0).target, null);
  assert.equal(toastView(s, s.roster[1]!.id, 0).target, null);
  assert.equal(toastView(s, q.id, 0).suggestions.length, 3);
  assert.deepEqual(toastView(s, null, 0).suggestions, []);
  askToast(s, q.id, 1, question, 0);
  assert.throws(() => answerToast(s, q.id, 1, true, 2, 1), error("CONFLICT"));
  for (const [i, p] of s.roster.entries()) answerToast(s, p.id, 1, i < 2, undefined, 1);
  assert.equal(s.history[0]!.expected, 2);
  assert.equal(s.history[0]!.actual, 2);
  assert.equal(q.score, 1);
  assert.deepEqual(s.responses, {});
  nextToast(s, 1);
  assert.ok(s.target !== null && s.target >= 0 && s.target <= 3);
});
test("timeout automatically passes unanswered players exactly once; missing basic prediction earns no points", () => {
  const s = state();
  askToast(s, s.roster[0]!.id, 1, question, 0);
  answerToast(s, s.roster[0]!.id, 1, true, 1, 1);
  assert.equal(tickToast(s, 14999), false);
  assert.equal(tickToast(s, 15000), true);
  assert.equal(s.history[0]!.actual, 1);
  assert.equal(s.history[0]!.automaticPasses, 2);
  assert.equal(s.history[0]!.points, 1);
  assert.equal(tickToast(s, 15001), false);
  assert.equal(s.roster[0]!.score, 1);
  assert.deepEqual(s.responses, {});
  nextToast(s, 1);
  askToast(s, s.roster[1]!.id, 2, question, 20000);
  tickToast(s, 35000);
  assert.equal(s.history[1]!.actual, 0);
  assert.equal(s.history[1]!.automaticPasses, 3);
  assert.equal(s.history[1]!.outcome, "no-prediction");
  assert.equal(s.history[1]!.points, 0);
});
test("only own choice is visible before tally; even final DTOs and raw settled state contain no individual answers", () => {
  const s = state(),
    q = s.roster[0]!,
    other = s.roster[1]!;
  askToast(s, q.id, 1, question, 0);
  answerToast(s, q.id, 1, true, 2, 1);
  assert.deepEqual(toastView(s, q.id, 2).myAnswer, { cheers: true, prediction: 2 });
  for (const id of [null, other.id]) {
    const v = toastView(s, id, 2);
    assert.equal(v.myAnswer, null);
    assert.equal(v.target, null);
    assert.ok(!JSON.stringify(v).includes('"cheers"'));
    assert.equal(v.submittedCount, 1);
    assert.ok(!Object.keys(v.roster[0]!).some((k) => /answer|submit|cheer/i.test(k)));
  }
  answerToast(s, other.id, 1, true, undefined, 3);
  answerToast(s, s.roster[2]!.id, 1, false, undefined, 4);
  assert.deepEqual(s.responses, {});
  for (const id of [null, q.id, other.id])
    assert.ok(!JSON.stringify(toastView(s, id, 5)).includes('"cheers"'));
});
test("outsiders, stale turns, duplicate choices, illegal predictions and expired submissions cannot alter the score", () => {
  const s = state(),
    q = s.roster[0]!;
  assert.throws(() => askToast(s, s.roster[1]!.id, 1, question, 0), error("FORBIDDEN"));
  askToast(s, q.id, 1, question, 0);
  assert.throws(() => answerToast(s, randomUUID(), 1, true, undefined, 1), error("FORBIDDEN"));
  assert.throws(() => answerToast(s, q.id, 2, true, 1, 1), error("CONFLICT"));
  for (const n of [-1, 4, 1.5, undefined])
    assert.throws(() => answerToast(s, q.id, 1, true, n, 1), error("CONFLICT"));
  assert.throws(() => answerToast(s, s.roster[1]!.id, 1, true, 1, 1), error("CONFLICT"));
  answerToast(s, q.id, 1, true, 1, 1);
  assert.throws(() => answerToast(s, q.id, 1, false, 0, 2), error("CONFLICT"));
  assert.throws(
    () => answerToast(s, s.roster[1]!.id, 1, true, undefined, 15000),
    error("CONFLICT"),
  );
  assert.equal(q.score, 0);
});
test("skip is allowed only before a question, abort erases current choices and keeps completed totals", () => {
  const s = state();
  skipToast(s, 1);
  assert.equal(s.history[0]!.outcome, "skipped");
  assert.equal(s.history[0]!.actual, null);
  nextToast(s, 1);
  askToast(s, s.roster[1]!.id, 2, question, 0);
  assert.throws(() => skipToast(s, 2), error("CONFLICT"));
  answerToast(s, s.roster[1]!.id, 2, true, 1, 1);
  abortToast(s);
  assert.equal(s.stage, "aborted");
  assert.deepEqual(s.responses, {});
  assert.equal(s.endsAt, null);
  assert.equal(s.history.length, 1);
  assert.deepEqual(toastView(s, null, 2).winners, []);
});
test("last words contain only a public question and target, are winner-only and never change points", () => {
  const s = state();
  for (let turn = 1; turn <= 3; turn++) {
    const q = s.roster[turn - 1]!;
    askToast(s, q.id, turn, question, 0);
    for (const p of s.roster)
      answerToast(
        s,
        p.id,
        turn,
        p.id === q.id,
        p.id === q.id ? (turn === 1 ? 1 : 0) : undefined,
        1,
      );
    if (turn < 3) nextToast(s, turn);
  }
  const [winner, other] = s.roster;
  const scores = s.roster.map((p) => p.score);
  assert.throws(() => lastWordToast(s, other!.id, winner!.id, 1), error("FORBIDDEN"));
  assert.throws(() => lastWordToast(s, winner!.id, winner!.id, 1), error("CONFLICT"));
  lastWordToast(s, winner!.id, other!.id, 1);
  assert.deepEqual(
    s.roster.map((p) => p.score),
    scores,
  );
  const v = toastView(s, null, 2);
  assert.equal(v.lastWords[0]!.question, question);
  assert.ok(!JSON.stringify(v).includes('"cheers"'));
  assert.throws(() => lastWordToast(s, winner!.id, s.roster[2]!.id, 2), error("CONFLICT"));
  assert.equal(s.roster[0]!.score, 1);
});
test("public schemas bound rounds, deadlines, input length, booleans and payload fields", () => {
  const base = { gameType: "toast", title: "건배의 눈치", capacity: 3, minPlayers: 3 };
  const parsed = createGameRoomSchema.parse(base);
  assert.equal(parsed.toastMode, "basic");
  assert.equal(parsed.toastRounds, 2);
  assert.equal(parsed.toastAnswerSeconds, 30);
  for (const override of [
    { toastRounds: 0 },
    { toastRounds: 11 },
    { toastAnswerSeconds: 4 },
    { toastMode: "secret" },
  ])
    assert.equal(createGameRoomSchema.safeParse({ ...base, ...override }).success, false);
  assert.equal(
    gamePlayerActionSchema.safeParse({ action: "toast-answer", turn: 1, cheers: "yes" }).success,
    false,
  );
  assert.equal(
    gamePlayerActionSchema.safeParse({ action: "toast-question", turn: 1, question: "짧음" })
      .success,
    false,
  );
  assert.equal(
    gamePlayerActionSchema.safeParse({ action: "toast-answer", turn: 1, cheers: true, score: 999 })
      .success,
    false,
  );
});
const pg = new PGlite(),
  db = drizzle(pg);
let now: Date, host: GamePrincipal, roomId: string, owner: string;
const who = (actor: string | null = null): GamePrincipal => ({
  actor,
  identityHash: randomBytes(32).toString("hex"),
  networkHash: randomBytes(32).toString("hex"),
});
const service = gameRoomService(db as unknown as Database, { now: () => now });
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
});
beforeEach(async () => {
  now = new Date("2026-11-01T03:00:00Z");
  owner = randomUUID();
  host = who(owner);
  await pg.query("insert into auth.users values($1)", [owner]);
  await db.insert(profiles).values({ id: owner, nickname: "건배호스트" + owner.slice(0, 5) });
});
after(async () => {
  await pg.close();
});
async function setup(mode: ToastMode = "basic") {
  roomId = (
    await service.create(owner, {
      title: "건배의 눈치",
      gameType: "toast",
      toastMode: mode,
      toastRounds: 1,
      toastAnswerSeconds: 15,
      capacity: 3,
      minPlayers: 3,
    })
  ).id;
  const guests = [who(), who(), who()];
  for (const [i, p] of guests.entries()) {
    await service.connect(roomId, p);
    await service.player(roomId, p, { action: "nickname", nickname: "건배친구" + i });
    await service.player(roomId, p, { action: "ready", ready: true });
  }
  const lobby = await service.read(roomId, host);
  await service.host(roomId, host, { action: "start", revision: lobby.revision });
  return guests;
}
const raw = async () =>
  (await db.select().from(gameRooms).where(eq(gameRooms.id, roomId)))[0]!.toast!;
test("SQL service guards questioner/host permissions and hides secrets from host, queue, outsiders and refreshed peers", async () => {
  const guests = await setup("target"),
    q = guests[0]!,
    peer = guests[1]!;
  const qv = (await service.read(roomId, q)).toast!;
  assert.ok(qv.target !== null);
  assert.equal((await service.read(roomId, host)).toast!.target, null);
  const waiting = who();
  await service.connect(roomId, waiting);
  assert.equal((await service.read(roomId, waiting)).toast, null);
  assert.equal((await service.read(roomId, who())).toast, null);
  await assert.rejects(
    service.player(roomId, peer, { action: "toast-question", turn: 1, question }),
    error("FORBIDDEN"),
  );
  await service.player(roomId, q, { action: "toast-question", turn: 1, question });
  await service.player(roomId, q, { action: "toast-answer", turn: 1, cheers: true });
  assert.equal((await service.read(roomId, peer)).toast!.myAnswer, null);
  assert.deepEqual((await service.read(roomId, q)).toast!.myAnswer, {
    cheers: true,
    prediction: null,
  });
  assert.ok(!JSON.stringify((await service.read(roomId, host)).toast).includes('"cheers"'));
  await assert.rejects(
    service.player(roomId, waiting, { action: "toast-answer", turn: 1, cheers: true }),
    error("FORBIDDEN"),
  );
});
test("serialized simultaneous final submissions score once; repeated reads and stale host actions do not advance twice", async () => {
  const guests = await setup();
  await service.player(roomId, guests[0]!, { action: "toast-question", turn: 1, question });
  await service.player(roomId, guests[0]!, {
    action: "toast-answer",
    turn: 1,
    cheers: true,
    prediction: 1,
  });
  await service.player(roomId, guests[1]!, { action: "toast-answer", turn: 1, cheers: false });
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      service.player(roomId, guests[2]!, { action: "toast-answer", turn: 1, cheers: false }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await raw()).roster[0]!.score, 1);
  assert.equal((await raw()).history.length, 1);
  assert.deepEqual((await raw()).responses, {});
  const view = await service.read(roomId, host);
  const again = await service.read(roomId, host);
  assert.equal(again.revision, view.revision);
  await service.host(roomId, host, { action: "toast-next", turn: 1, revision: view.revision });
  await assert.rejects(
    service.host(roomId, host, { action: "toast-next", turn: 1, revision: view.revision }),
    error("CONFLICT"),
  );
  assert.equal((await raw()).turn, 2);
});
test("SQL timeout uses server time, auto-passes unanswered players and persists only aggregates", async () => {
  const guests = await setup();
  await service.player(roomId, guests[0]!, { action: "toast-question", turn: 1, question });
  await service.player(roomId, guests[0]!, {
    action: "toast-answer",
    turn: 1,
    cheers: true,
    prediction: 1,
  });
  now = new Date(now.getTime() + 15000);
  const result = await service.read(roomId, host);
  assert.equal(result.toast!.history[0]!.automaticPasses, 2);
  assert.equal(result.toast!.history[0]!.points, 1);
  assert.deepEqual((await raw()).responses, {});
  assert.equal(result.toast!.history[0]!.actual, 1);
  assert.equal((await service.read(roomId, guests[0]!)).toast!.myAnswer, null);
});
test("SQL custom questions follow the existing content policy; finish, reset and close do not expose or retain pending choices", async () => {
  const guests = await setup();
  await assert.rejects(
    async () =>
      service.player(roomId, guests[0]!, {
        action: "toast-question",
        turn: 1,
        question: "너는 씨발이라는 말을 좋아하니",
      }),
    error("VALIDATION"),
  );
  await service.player(roomId, guests[0]!, { action: "toast-question", turn: 1, question });
  await service.player(roomId, guests[0]!, {
    action: "toast-answer",
    turn: 1,
    cheers: true,
    prediction: 1,
  });
  let v = await service.read(roomId, host);
  v = await service.host(roomId, host, { action: "finish", revision: v.revision });
  assert.equal(v.toast!.stage, "aborted");
  assert.deepEqual((await raw()).responses, {});
  v = await service.host(roomId, host, { action: "reset", revision: v.revision });
  assert.equal(v.toast!.stage, "lobby");
  assert.equal(v.toast!.settings.rounds, 1);
  assert.deepEqual(v.toast!.roster, []);
  assert.equal(v.readyCount, 0);
  v = await service.host(roomId, host, { action: "close", revision: v.revision });
  assert.equal(v.toast, null);
});
