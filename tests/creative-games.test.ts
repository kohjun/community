import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  newDrawing,
  startDrawing,
  actDrawing,
  tickDrawing,
  drawingView,
  controlDrawing,
} from "../src/server/drawing-game";
import {
  newClue,
  prepareClue,
  startClue,
  answerClue,
  tickClue,
  clueView,
} from "../src/server/clue-game";
import {
  normalizeDrawingAnswer,
  straightLineMetres,
  type DrawingState,
  type ClueQuestion,
} from "../src/domain/creative-games";
const roster = (count = 4) =>
  Array.from({ length: count }, (_, i) => ({ id: randomUUID(), nickname: `참가자${i}` }));
const at = 1800000000000;
function drawing(mode: "mix" | "live" | "relay" = "mix", n = 4) {
  const s = newDrawing({ mode, sets: 1, seconds: 45, scored: true });
  startDrawing(s, roster(n), at);
  return s;
}
function action(s: DrawingState, id: string, a: Record<string, unknown>, now = at) {
  actDrawing(
    s,
    id,
    { runId: s.runId!, phaseId: s.phaseId, ...a } as Parameters<typeof actDrawing>[2],
    now,
  );
}
function finishPreparation(s: DrawingState) {
  for (const p of s.roster)
    action(s, p.id, { action: "drawing-text", text: `시작 문장 ${p.nickname}` });
  for (const p of s.roster) action(s, p.id, { action: "drawing-image", assetId: randomUUID() });
  for (const p of s.roster) action(s, p.id, { action: "drawing-text", text: `해석 ${p.nickname}` });
}
test("drawing roles are four distinct people, with everyone taking each role exactly once", () => {
  for (const n of [4, 8, 12]) {
    const s = drawing("mix", n);
    for (const c of s.chains)
      assert.equal(new Set([c.author, c.painter, c.interpreter, c.finalPainter]).size, 4);
    for (const key of ["author", "painter", "interpreter", "finalPainter"] as const)
      assert.equal(new Set(s.chains.map((c) => c[key])).size, n);
  }
});
test("a mixing round cannot start below four people", () => assert.throws(() => drawing("mix", 3)));
test("private drawing projections do not leak another prompt or hidden chains", () => {
  const s = drawing();
  action(s, s.roster[0]!.id, { action: "drawing-text", text: "비밀 원문" });
  const v = drawingView(s, s.roster[1]!.id, at);
  assert.ok(!JSON.stringify(v).includes("비밀 원문"));
  assert.equal(v.revealed.length, 0);
  assert.equal(v.guesses.length, 0);
});
test("mixed game uses the final interpretation, not the starting prompt; artist and interpreter cannot guess", () => {
  const s = drawing();
  finishPreparation(s);
  const c = s.chains[0]!;
  assert.equal(s.stage, "live");
  for (const id of [c.interpreter, c.finalPainter])
    assert.throws(() => action(s, id, { action: "drawing-guess", text: c.interpretation }));
  action(s, c.author, { action: "drawing-guess", text: c.prompt });
  assert.equal(s.stage, "live");
  action(s, c.author, { action: "drawing-guess", text: c.interpretation }, at + 1100);
  assert.equal(s.stage, "judging");
  tickDrawing(s, at + 11100);
  assert.equal(s.stage, "review");
  assert.equal(s.roster.find((p) => p.id === c.author)!.score, 2);
  assert.equal(s.roster.find((p) => p.id === c.finalPainter)!.score, 1);
  tickDrawing(s, at + 11100);
  assert.equal(s.roster.find((p) => p.id === c.author)!.score, 2);
});
test("an earlier synonym can be accepted by the writer after an exact later answer", () => {
  const s = drawing();
  finishPreparation(s);
  const c = s.chains[0]!;
  action(s, c.author, { action: "drawing-guess", text: "뜻이 같은 표현" }, at);
  action(s, c.painter, { action: "drawing-guess", text: c.interpretation }, at + 100);
  action(s, c.interpreter, { action: "drawing-judge", guessId: s.guesses[0]!.id }, at + 200);
  tickDrawing(s, at + 10100);
  assert.equal(c.winner, c.author);
});
test("stale run, stale phase, paused input, duplicate sentences and non-writer judgment are rejected", () => {
  const s = drawing();
  const id = s.roster[0]!.id;
  const phase = s.phaseId;
  action(s, id, { action: "drawing-text", text: "문장" });
  assert.throws(() => action(s, id, { action: "drawing-text", text: "또 문장" }));
  assert.throws(() =>
    actDrawing(
      s,
      id,
      { action: "drawing-text", runId: randomUUID(), phaseId: phase, text: "문장" },
      at,
    ),
  );
  controlDrawing(s, "pause", at);
  assert.throws(() => action(s, s.roster[1]!.id, { action: "drawing-text", text: "문장" }));
  assert.equal(tickDrawing(s, at + 999999), false);
  controlDrawing(s, "resume", at + 1000);
  assert.equal(s.endsAt, at + 31000);
});
test("timeouts supply starting prompts and skip chains with missing material", () => {
  const s = drawing();
  tickDrawing(s, at + 30000);
  assert.equal(s.stage, "draw");
  assert.ok(s.chains.every((c) => c.prompt));
  tickDrawing(s, at + 75000);
  assert.equal(s.stage, "interpret");
  tickDrawing(s, at + 105000);
  assert.equal(s.stage, "review");
  assert.ok(s.chains.every((c) => c.skipped));
});
test("relay mode has no live guessing, refuses self-votes, and finishes after everyone votes", () => {
  const s = drawing("relay");
  finishPreparation(s);
  assert.equal(s.stage, "gallery");
  for (let i = 0; i < 4; i++) controlDrawing(s, "next", at);
  assert.equal(s.stage, "voting");
  for (const p of s.roster) {
    const own = s.chains.find((c) => c.author === p.id)!;
    assert.throws(() => action(s, p.id, { action: "drawing-vote", chainId: own.id }));
    action(s, p.id, {
      action: "drawing-vote",
      chainId: s.chains.find((c) => c.author !== p.id)!.id,
    });
  }
  assert.equal(s.stage, "result");
  assert.ok(s.roster.every((p) => p.score === 0));
});
test("live mode supports two players and the artist never submits guesses", () => {
  const s = drawing("live", 2);
  assert.equal(s.stage, "live");
  assert.throws(() =>
    action(s, s.chains[0]!.finalPainter, { action: "drawing-guess", text: "정답" }),
  );
});
test("text matching normalizes spacing and punctuation without inventing semantic matching", () => {
  assert.equal(normalizeDrawingAnswer("치킨, 든 오리!"), normalizeDrawingAnswer("치킨든오리"));
  assert.notEqual(
    normalizeDrawingAnswer("치킨을 든 오리"),
    normalizeDrawingAnswer("치킨 먹는 오리"),
  );
});
function clue(mode: "photo" | "zoom" | "quiz" | "member" = "photo") {
  const s = newClue({ mode, source: "host", rounds: 1, seconds: 60 }),
    people = roster();
  const q: ClueQuestion = {
    id: randomUUID(),
    assetId: randomUUID(),
    basicAsset: null,
    media: mode === "quiz" ? "audio" : "photo",
    authorId: null,
    label: "장소",
    story: "사진 이야기",
    point: mode === "quiz" ? null : { latitude: 37.5, longitude: 127 },
    choices: mode === "quiz" ? ["보기1", "보기2", "보기3", "보기4"] : null,
    correctChoice: mode === "quiz" ? 2 : null,
    credit: null,
  };
  if (mode === "member")
    for (const p of people) prepareClue(s, { ...q, id: randomUUID() }, p.id, false);
  else prepareClue(s, q, randomUUID(), true);
  startClue(s, people, at);
  return s;
}
test("clue projections keep answers, locations, owner and question labels private before reveal", () => {
  const s = clue();
  const v = clueView(s, s.roster[0]!.id, at);
  assert.equal(v.question?.assetId, s.deck[0]!.assetId);
  assert.ok(!JSON.stringify(v).includes('"latitude"'));
  assert.ok(!("deck" in v));
  assert.ok(!("authorId" in v.question!));
  assert.ok(!("label" in v.question!));
});
test("nearest players tied to a metre each receive one point; missing answers get no points", () => {
  const s = clue();
  for (const p of s.roster.slice(0, 2))
    answerClue(s, p.id, s.runId!, s.phaseId, { point: { latitude: 37.5, longitude: 127 } }, at);
  tickClue(s, at + 60000);
  assert.equal(s.stage, "review");
  assert.deepEqual(
    s.roster.map((p) => p.score),
    [1, 1, 0, 0],
  );
  assert.equal(s.results[0]!.answers.length, 2);
  tickClue(s, at + 75000);
  assert.equal(s.stage, "result");
  assert.deepEqual(
    s.roster.map((p) => p.score),
    [1, 1, 0, 0],
  );
});
test("member photo author is excluded and location and owner points are independent", () => {
  const s = clue("member");
  const q = s.deck[0]!,
    owner = q.authorId!;
  assert.throws(() =>
    answerClue(s, owner, s.runId!, s.phaseId, { point: q.point!, authorId: owner }, at),
  );
  const eligible = s.roster.filter((p) => p.id !== owner);
  for (const [i, p] of eligible.entries())
    answerClue(
      s,
      p.id,
      s.runId!,
      s.phaseId,
      { point: i === 0 ? q.point! : { latitude: 36, longitude: 126 }, authorId: owner },
      at,
    );
  assert.equal(s.stage, "review");
  assert.equal(s.results[0]!.answers.find((a) => a.playerId === eligible[0]!.id)!.points, 2);
  assert.equal(s.results[0]!.answers.find((a) => a.playerId === eligible[1]!.id)!.points, 1);
  assert.equal(s.roster.find((p) => p.id === owner)!.score, 0);
  assert.equal(s.deck.length, s.roster.length);
});
test("choice quizzes award every correct answer rather than only the fastest", () => {
  const s = clue("quiz");
  for (const [i, p] of s.roster.entries())
    answerClue(
      s,
      p.id,
      s.runId!,
      s.phaseId,
      { choice: i % 2 === 0 ? s.deck[0]!.correctChoice! : (s.deck[0]!.correctChoice! + 1) % 4 },
      at,
    );
  assert.equal(s.stage, "review");
  assert.deepEqual(
    s.roster.map((p) => p.score),
    [1, 0, 1, 0],
  );
});
test("clue submissions are immutable and stale phase IDs are rejected", () => {
  const s = clue();
  const p = s.roster[0]!;
  answerClue(s, p.id, s.runId!, s.phaseId, { point: { latitude: 37, longitude: 127 } }, at);
  assert.throws(() =>
    answerClue(s, p.id, s.runId!, s.phaseId, { point: { latitude: 38, longitude: 127 } }, at),
  );
  assert.throws(() =>
    answerClue(
      s,
      s.roster[1]!.id,
      s.runId!,
      randomUUID(),
      { point: { latitude: 37, longitude: 127 } },
      at,
    ),
  );
});
test("great-circle distance handles identical, nearby, and antipodal points", () => {
  assert.equal(straightLineMetres({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }), 0);
  assert.equal(
    straightLineMetres({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }),
    111195,
  );
  assert.ok(
    Number.isFinite(
      straightLineMetres({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 }),
    ),
  );
});

test("basic clue room limits match the street-view bank, while host-authored quizzes can contain twenty questions", async () => {
  const { createGameRoomSchema, gameHostActionSchema } = await import("../src/domain/game-room");
  const { CLUE_STREET_BANK } = await import("../src/server/clue-bank");
  assert.ok(CLUE_STREET_BANK.length >= 20);
  assert.ok(CLUE_STREET_BANK.every((q) => q.media === "street" && q.street?.panoId && q.point));
  const base = {
    gameType: "clue",
    title: "문제 개수 검사",
    clueMode: "quiz",
    clueRounds: 21,
  };
  assert.equal(createGameRoomSchema.safeParse(base).success, false);
  assert.equal(createGameRoomSchema.safeParse({ ...base, clueRounds: 20 }).success, true);
  assert.equal(
    createGameRoomSchema.safeParse({ ...base, clueMode: "photo", clueRounds: 20 }).success,
    true,
  );
  assert.equal(
    createGameRoomSchema.safeParse({ ...base, clueSource: "host", clueRounds: 20 }).success,
    true,
  );
  assert.equal(
    gameHostActionSchema.safeParse({
      action: "settings",
      settingsVersion: "a".repeat(64),
      settings: base,
    }).success,
    false,
  );
});
