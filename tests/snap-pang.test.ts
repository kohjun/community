import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Database } from "../src/db/connection";
import { profiles } from "../src/db/schema";
import { createGameRoomSchema, type GameRoomView } from "../src/domain/game-room";
import {
  DEFAULT_SNAP_PANG_SETTINGS,
  SNAP_PANG_PRESETS,
  snapPangRoundPlan,
  snapPangSlotLabel,
  type SnapPangPreset,
} from "../src/domain/snap-pang";
import { GAME_CATALOG } from "../src/domain/game-catalog";
import { getGameTutorial } from "../src/domain/game-tutorial";
import { computeColorMatchScore, rgbToHex, sampleCenterRgb } from "../src/lib/vision/color-lab";
import {
  NEUTRAL_FACE_TELEMETRY,
  scoreExpressionMatch,
  smileBurstIntensity,
} from "../src/lib/vision/mediapipe";
import { AppError } from "../src/server/errors";
import { gameRoomService, type GamePrincipal } from "../src/server/game-room-service";
import { readGameRun } from "../src/server/game-run-service";

const pg = new PGlite();
const db = drizzle(pg);
const connection = db as unknown as Database;

let now = new Date("2026-11-21T01:00:00Z");
let owner: string;
const service = gameRoomService(connection, { now: () => now });
const hash = () => randomBytes(32).toString("hex");
const network = hash();
const person = (actor: string | null = null): GamePrincipal => ({
  identityHash: hash(),
  networkHash: network,
  actor,
});
const code = (expected: string) => (e: unknown) => e instanceof AppError && e.code === expected;

async function createMember(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(profiles).values({ id, nickname });
  return id;
}

async function joinReady(roomId: string, who: GamePrincipal, nickname: string) {
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
  now = new Date("2026-11-21T01:00:00Z");
  owner = await createMember("스냅호스트");
});

after(() => pg.close());

test("CIE Lab color matcher scores exact/similar hues fairly under dim light and rejects distant hues", () => {
  assert.equal(computeColorMatchScore("#0A84FE", "#0A84FE"), 100);
  // Darker blue (dim pub lighting) should still score well above 65%
  const dimBlue = computeColorMatchScore("#0A84FE", "#0656A8");
  assert.ok(dimBlue >= 65 && dimBlue < 100, `expected dimBlue >= 65, got ${dimBlue}`);
  // Opposite color (yellow/orange vs blue) should score very low
  const opposite = computeColorMatchScore("#0A84FE", "#FACC15");
  assert.ok(opposite < 35, `expected opposite < 35, got ${opposite}`);

  // Sample center pixel buffer (solid Sliper Blue #0A84FE)
  const w = 16;
  const h = 16;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = 10;
    rgba[i * 4 + 1] = 132;
    rgba[i * 4 + 2] = 254;
    rgba[i * 4 + 3] = 255;
  }
  const sampled = sampleCenterRgb(rgba, w, h);
  assert.equal(rgbToHex(sampled.rgb), "#0A84FE");
  assert.ok(sampled.luma > 90);
});

test("expression matcher and smile burst telemetry handle all 5 target poses safely", () => {
  assert.equal(scoreExpressionMatch(NEUTRAL_FACE_TELEMETRY, "happy"), 0);
  assert.equal(smileBurstIntensity(NEUTRAL_FACE_TELEMETRY), 0);

  assert.ok(
    scoreExpressionMatch(
      { ...NEUTRAL_FACE_TELEMETRY, faceDetected: true, jawOpen: 0.75 },
      "surprise",
    ) >= 0.8,
  );
  assert.ok(
    scoreExpressionMatch(
      { ...NEUTRAL_FACE_TELEMETRY, faceDetected: true, winkLeft: 0.85, winkRight: 0.05 },
      "wink",
    ) >= 0.8,
  );
  // Both eyes closed is blinking, not winking
  assert.ok(
    scoreExpressionMatch(
      { ...NEUTRAL_FACE_TELEMETRY, faceDetected: true, winkLeft: 0.9, winkRight: 0.9 },
      "wink",
    ) < 0.2,
  );
  assert.ok(
    scoreExpressionMatch(
      { ...NEUTRAL_FACE_TELEMETRY, faceDetected: true, browDown: 0.65 },
      "angry",
    ) >= 0.8,
  );
  assert.ok(
    scoreExpressionMatch({ ...NEUTRAL_FACE_TELEMETRY, faceDetected: true, smile: 0.8 }, "happy") >=
      0.8,
  );
  assert.ok(
    scoreExpressionMatch(
      { ...NEUTRAL_FACE_TELEMETRY, faceDetected: true, pucker: 0.75 },
      "pucker",
    ) >= 0.8,
  );
  assert.ok(
    smileBurstIntensity({
      ...NEUTRAL_FACE_TELEMETRY,
      faceDetected: true,
      smile: 0.7,
      jawOpen: 0.4,
    }) > 0.6,
  );
});

test("catalog, tutorial and schema bounds register snap-pang cleanly", () => {
  const entry = GAME_CATALOG.find((g) => g.id === "snap-pang");
  assert.ok(entry);
  assert.equal(entry.title, "스냅 팡 3D");
  const guide = getGameTutorial("snap-pang");
  assert.equal(guide.title, "스냅 팡 3D");
  assert.ok(guide.player.length >= 3);
  assert.equal(
    createGameRoomSchema.safeParse({
      gameType: "snap-pang",
      title: "스냅 팡 테스트",
      capacity: 13,
      minPlayers: 2,
    }).success,
    false,
  );
  for (const preset of SNAP_PANG_PRESETS) {
    const parsed = createGameRoomSchema.parse({
      gameType: "snap-pang",
      title: "스냅 팡 테스트",
      capacity: 12,
      minPlayers: 2,
      snapPreset: preset,
      snapRounds: 3,
      snapSeconds: 20,
    });
    assert.equal(parsed.snapPreset, preset);
  }
  // Rooms saved before the four-mode split keep working as the closest current mode.
  for (const [legacy, current] of [
    ["light", "color"],
    ["mix", "random"],
    ["pokerface", "face"],
  ] as const) {
    const parsed = createGameRoomSchema.parse({
      gameType: "snap-pang",
      title: "스냅 팡 테스트",
      capacity: 12,
      minPlayers: 2,
      snapPreset: legacy,
      snapRounds: 3,
      snapSeconds: 20,
    });
    assert.equal(parsed.snapPreset, current);
  }
  assert.equal(
    createGameRoomSchema.safeParse({
      gameType: "snap-pang",
      title: "스냅 팡 테스트",
      capacity: 12,
      minPlayers: 2,
      snapPreset: "unknown",
    }).success,
    false,
  );
  assert.equal(DEFAULT_SNAP_PANG_SETTINGS.preset, "random");
});

test("each mode plans only its own missions; random shuffles all four without back-to-back repeats", () => {
  const labels = (preset: SnapPangPreset, rounds: number, rng?: (max: number) => number) =>
    snapPangRoundPlan(preset, rounds, rng).map(snapPangSlotLabel);
  assert.deepEqual(labels("color", 3), ["🎨 색깔 찾기", "🎨 색깔 찾기", "🎨 색깔 찾기"]);
  assert.deepEqual(labels("object", 3), ["📦 물건 찾기", "📦 물건 찾기", "📦 물건 찾기"]);
  assert.deepEqual(labels("face", 5), [
    "💣 웃음 참기",
    "🎭 표정 릴레이",
    "💣 웃음 참기",
    "🎭 표정 릴레이",
    "💣 웃음 참기",
  ]);

  const all = ["🎨 색깔 찾기", "📦 물건 찾기", "💣 웃음 참기", "🎭 표정 릴레이"].sort();
  // A fixed RNG must still give every block all four missions and no repeat at block edges.
  for (const rng of [() => 0, (max: number) => max - 1, (max: number) => Math.floor(max / 2)]) {
    const plan = labels("random", 9, rng);
    assert.equal(plan.length, 9);
    assert.deepEqual(plan.slice(0, 4).sort(), all);
    assert.deepEqual(plan.slice(4, 8).sort(), all);
    for (let i = 1; i < plan.length; i++) assert.notEqual(plan[i], plan[i - 1]);
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    const plan = labels("random", 7);
    assert.deepEqual(plan.slice(0, 4).sort(), all);
    for (let i = 1; i < plan.length; i++) assert.notEqual(plan[i], plan[i - 1]);
  }
});

async function hostNext(roomId: string, host: GamePrincipal, view: GameRoomView) {
  return service.host(roomId, host, {
    action: "snap-control",
    revision: view.revision,
    phaseId: view.snapPang!.phaseId,
    command: "next",
  });
}

test("snap-pang color mode runs color rounds, pause/resume, 3D podium and a 24h saved run", async () => {
  const host = person(owner);
  const { id: roomId } = await service.create(owner, {
    gameType: "snap-pang",
    title: "금요일 테이블 스냅 팡",
    capacity: 6,
    minPlayers: 2,
    snapPreset: "color",
    snapRounds: 3,
    snapSeconds: 20,
  });

  const p1 = person();
  const p2 = person();
  const p3 = person();
  const v1 = await joinReady(roomId, p1, "민수");
  const v2 = await joinReady(roomId, p2, "지연");
  const v3 = await joinReady(roomId, p3, "현우");
  assert.ok(v1.viewer.id && v2.viewer.id && v3.viewer.id);

  // Lobby settings update preserves nicknames and readiness
  const lobby = await service.read(roomId, host);
  const updated = await service.host(roomId, host, {
    action: "settings",
    settingsVersion: lobby.settingsVersion!,
    settings: { ...lobby.settings!, snapSeconds: 15 },
  });
  assert.equal(updated.readyCount, 3);
  assert.equal(updated.settings!.snapSeconds, 15);
  assert.equal(updated.settings!.snapPreset, "color");

  const started = await service.host(roomId, host, {
    action: "start",
    revision: updated.revision,
  });
  assert.equal(started.phase, "playing");
  assert.equal(started.snapPang!.stage, "briefing");
  assert.equal(started.snapPang!.round, 1);
  assert.equal(started.snapPang!.settings.preset, "color");
  assert.equal(started.snapPang!.mission!.kind, "color");
  const runId = started.snapPang!.runId!;
  const targetHex = started.snapPang!.mission!.targetHex;

  // Host pauses & resumes cleanly
  const paused = await service.host(roomId, host, {
    action: "snap-control",
    revision: started.revision,
    phaseId: started.snapPang!.phaseId,
    command: "pause",
  });
  assert.equal(paused.snapPang!.paused, true);
  const resumed = await service.host(roomId, host, {
    action: "snap-control",
    revision: paused.revision,
    phaseId: paused.snapPang!.phaseId,
    command: "resume",
  });
  assert.equal(resumed.snapPang!.paused, false);

  // Advance clock past 4s briefing -> active
  now = new Date(now.getTime() + 4_500);
  const r1Active = await service.read(roomId, p1);
  assert.equal(r1Active.snapPang!.stage, "active");

  // p1 exact match, p2 opposite color (0 pts), p3 close match
  const s1 = await service.player(roomId, p1, {
    action: "snap-color",
    runId,
    round: 1,
    hex: targetHex,
    fallback: false,
  });
  assert.equal(s1.snapPang!.mySubmission?.mode, "color");
  assert.equal(s1.snapPang!.mySubmission?.accuracy, 100);
  // Duplicate submission rejected
  await assert.rejects(
    service.player(roomId, p1, {
      action: "snap-color",
      runId,
      round: 1,
      hex: targetHex,
      fallback: false,
    }),
    code("CONFLICT"),
  );
  await service.player(roomId, p2, {
    action: "snap-color",
    runId,
    round: 1,
    hex: targetHex === "#0A84FE" ? "#FACC15" : "#000000",
    fallback: true,
  });
  // Last player submits -> immediately settles to reveal
  const r1Reveal = await service.player(roomId, p3, {
    action: "snap-color",
    runId,
    round: 1,
    hex: targetHex,
    fallback: false,
  });
  assert.equal(r1Reveal.snapPang!.stage, "reveal");
  const p1Entry = r1Reveal.snapPang!.lastResult!.entries.find((e) => e.playerId === v1.viewer.id)!;
  const p3Entry = r1Reveal.snapPang!.lastResult!.entries.find((e) => e.playerId === v3.viewer.id)!;
  assert.equal(p1Entry.points, 3);
  assert.equal(p3Entry.points, 3); // Exact tie shares 1st place points

  // Rounds 2 and 3 stay color; the host skips them through briefing -> active -> reveal.
  let state = r1Reveal;
  for (const round of [2, 3]) {
    state = await hostNext(roomId, host, state);
    assert.equal(state.snapPang!.round, round);
    assert.equal(state.snapPang!.mission!.kind, "color");
    await assert.rejects(
      service.player(roomId, p1, {
        action: "snap-object",
        runId,
        round,
        confidence: 0.9,
        fallback: false,
      }),
      code("CONFLICT"),
    );
    state = await hostNext(roomId, host, state);
    assert.equal(state.snapPang!.stage, "active");
    await assert.rejects(
      service.player(roomId, p1, {
        action: "snap-object",
        runId,
        round,
        confidence: 0.9,
        fallback: false,
      }),
      code("CONFLICT"),
    );
    state = await hostNext(roomId, host, state);
    assert.equal(state.snapPang!.stage, "reveal");
  }
  await hostNext(roomId, host, state);

  const finished = await service.read(roomId, p1);
  assert.equal(finished.phase, "finished");
  assert.equal(finished.snapPang!.stage, "result");
  assert.equal(finished.snapPang!.history.length, 3);

  // Verify 24h replay via readGameRun
  const replay = await readGameRun(connection, roomId, runId, p1, now);
  assert.equal(replay.gameType, "snap-pang");
  assert.equal(replay.snapPang!.stage, "result");
  assert.equal(replay.snapPang!.history.length, 3);

  // Reset room for next match
  const reset = await service.host(roomId, host, {
    action: "reset",
    revision: finished.revision,
  });
  assert.equal(reset.phase, "lobby");
  assert.equal(reset.snapPang!.stage, "lobby");
  assert.equal(reset.round, 2);
});

test("object mode only plans object rounds and scores captures by speed", async () => {
  const host = person(owner);
  const { id: roomId } = await service.create(owner, {
    gameType: "snap-pang",
    title: "물건 찾기",
    capacity: 6,
    minPlayers: 2,
    snapPreset: "object",
    snapRounds: 3,
    snapSeconds: 20,
  });
  const p1 = person();
  const p2 = person();
  const p3 = person();
  const v1 = await joinReady(roomId, p1, "민수");
  const v2 = await joinReady(roomId, p2, "지연");
  const v3 = await joinReady(roomId, p3, "현우");
  const started = await service.host(roomId, host, {
    action: "start",
    revision: (await service.read(roomId, host)).revision,
  });
  assert.equal(started.snapPang!.mission!.kind, "object");
  const runId = started.snapPang!.runId!;
  const active = await hostNext(roomId, host, started);
  assert.equal(active.snapPang!.stage, "active");

  now = new Date(now.getTime() + 1_200);
  await service.player(roomId, p2, {
    action: "snap-object",
    runId,
    round: 1,
    confidence: 0.88,
    fallback: false,
  });
  await assert.rejects(
    service.player(roomId, p2, {
      action: "snap-object",
      runId,
      round: 1,
      confidence: 0.88,
      fallback: false,
    }),
    code("CONFLICT"),
  );
  now = new Date(now.getTime() + 1_500);
  await service.player(roomId, p1, {
    action: "snap-object",
    runId,
    round: 1,
    confidence: 0.72,
    fallback: false,
  });
  now = new Date(now.getTime() + 1_500);
  const reveal = await service.player(roomId, p3, {
    action: "snap-object",
    runId,
    round: 1,
    confidence: 0.85,
    fallback: true,
  });
  assert.equal(reveal.snapPang!.stage, "reveal");
  const points = (id: string | null) =>
    reveal.snapPang!.lastResult!.entries.find((e) => e.playerId === id)!.points;
  assert.equal(points(v2.viewer.id), 3);
  assert.equal(points(v1.viewer.id), 2);
  assert.equal(points(v3.viewer.id), 1);

  let state = reveal;
  for (const round of [2, 3]) {
    state = await hostNext(roomId, host, state);
    assert.equal(state.snapPang!.round, round);
    assert.equal(state.snapPang!.mission!.kind, "object");
    state = await hostNext(roomId, host, state);
    state = await hostNext(roomId, host, state);
  }
  state = await hostNext(roomId, host, state);
  assert.equal(state.phase, "finished");
});

test("face mode alternates 웃음 참기 and 표정 릴레이 and scores both", async () => {
  const host = person(owner);
  const { id: roomId } = await service.create(owner, {
    gameType: "snap-pang",
    title: "웃참 스페셜",
    capacity: 6,
    minPlayers: 2,
    snapPreset: "face",
    snapRounds: 3,
    snapSeconds: 20,
  });
  const p1 = person();
  const p2 = person();
  const p3 = person();
  const v1 = await joinReady(roomId, p1, "민수");
  const v2 = await joinReady(roomId, p2, "지연");
  const v3 = await joinReady(roomId, p3, "현우");
  const started = await service.host(roomId, host, {
    action: "start",
    revision: (await service.read(roomId, host)).revision,
  });
  const runId = started.snapPang!.runId!;
  const r1 = started.snapPang!.mission!;
  assert.equal(r1.kind, "face");
  assert.equal(r1.kind === "face" && r1.subMode, "smile-bomb");

  // Round 1: 웃음 참기
  const r1Active = await hostNext(roomId, host, started);
  const attackerId = r1.kind === "face" ? r1.attackerId : null;
  const playersById = new Map([
    [v1.viewer.id!, p1],
    [v2.viewer.id!, p2],
    [v3.viewer.id!, p3],
  ]);
  const attacker = playersById.get(attackerId!)!;
  const defenders = [...playersById.entries()]
    .filter(([id]) => id !== attackerId)
    .map(([, who]) => who);

  // Attacker cannot submit tension
  await assert.rejects(
    service.player(roomId, attacker, {
      action: "snap-tension",
      runId,
      round: 1,
      tension: 50,
      popped: false,
    }),
    code("FORBIDDEN"),
  );
  // Expression relay results are rejected during 웃음 참기
  await assert.rejects(
    service.player(roomId, defenders[0]!, {
      action: "snap-face-copy",
      runId,
      round: 1,
      fallback: false,
    }),
    code("CONFLICT"),
  );

  // Defender 0 raises tension then pops; a repeated pop (client retry) is harmless.
  const mid = await service.player(roomId, defenders[0]!, {
    action: "snap-tension",
    runId,
    round: 1,
    tension: 65,
    popped: false,
  });
  assert.equal(mid.snapPang!.stage, "active");
  for (let i = 0; i < 2; i++) {
    const popped = await service.player(roomId, defenders[0]!, {
      action: "snap-tension",
      runId,
      round: 1,
      tension: 100,
      popped: true,
    });
    assert.equal(popped.snapPang!.stage, "active");
    assert.equal(popped.snapPang!.submittedCount, 1);
  }
  // Expire round 1 active timer -> settles 웃음 참기
  now = new Date(now.getTime() + 21_000);
  const r1Reveal = await service.read(roomId, host);
  assert.equal(r1Active.snapPang!.stage, "active");
  assert.equal(r1Reveal.snapPang!.stage, "reveal");
  const attackerResult = r1Reveal.snapPang!.lastResult!.entries.find((e) => e.isAttacker)!;
  assert.equal(attackerResult.points, 1); // 1 defender popped
  assert.equal(
    r1Reveal.snapPang!.lastResult!.entries.filter((e) => !e.isAttacker && !e.popped)[0]!.points,
    2,
  );

  // Round 2: 표정 릴레이
  const r2Brief = await hostNext(roomId, host, r1Reveal);
  const r2 = r2Brief.snapPang!.mission!;
  assert.equal(r2.kind === "face" && r2.subMode, "face-copy");
  assert.equal(r2.kind === "face" && r2.expressions.length, 2);
  await hostNext(roomId, host, r2Brief);
  now = new Date(now.getTime() + 1_000);
  await service.player(roomId, p3, { action: "snap-face-copy", runId, round: 2, fallback: false });
  now = new Date(now.getTime() + 1_000);
  await service.player(roomId, p1, { action: "snap-face-copy", runId, round: 2, fallback: true });
  now = new Date(now.getTime() + 1_000);
  const r2Reveal = await service.player(roomId, p2, {
    action: "snap-face-copy",
    runId,
    round: 2,
    fallback: false,
  });
  assert.equal(r2Reveal.snapPang!.stage, "reveal");
  const points = (id: string | null) =>
    r2Reveal.snapPang!.lastResult!.entries.find((e) => e.playerId === id)!.points;
  assert.equal(points(v3.viewer.id), 3);
  assert.equal(points(v1.viewer.id), 2);
  assert.equal(points(v2.viewer.id), 1);

  // Round 3 goes back to 웃음 참기
  const r3Brief = await hostNext(roomId, host, r2Reveal);
  const r3 = r3Brief.snapPang!.mission!;
  assert.equal(r3.kind === "face" && r3.subMode, "smile-bomb");
});

test("random mode deals all four missions within the first four rounds", async () => {
  const host = person(owner);
  const { id: roomId } = await service.create(owner, {
    gameType: "snap-pang",
    title: "랜덤 스냅 팡",
    capacity: 6,
    minPlayers: 2,
    snapPreset: "random",
    snapRounds: 5,
    snapSeconds: 15,
  });
  await joinReady(roomId, person(), "하나");
  await joinReady(roomId, person(), "두리");
  let state = await service.host(roomId, host, {
    action: "start",
    revision: (await service.read(roomId, host)).revision,
  });
  const seen: string[] = [];
  for (let round = 1; round <= 5; round++) {
    const mission = state.snapPang!.mission!;
    seen.push(
      snapPangSlotLabel(
        mission.kind === "face" ? { kind: "face", face: mission.subMode } : { kind: mission.kind },
      ),
    );
    for (let step = 0; step < 3; step++) state = await hostNext(roomId, host, state);
  }
  assert.equal(state.phase, "finished");
  assert.deepEqual(
    seen.slice(0, 4).sort(),
    ["🎨 색깔 찾기", "📦 물건 찾기", "💣 웃음 참기", "🎭 표정 릴레이"].sort(),
  );
  assert.notEqual(seen[4], seen[3]);
});
