import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Database } from "../src/db/connection";
import { profiles } from "../src/db/schema";
import { createGameRoomSchema } from "../src/domain/game-room";
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
  assert.equal(
    createGameRoomSchema.safeParse({
      gameType: "snap-pang",
      title: "스냅 팡 테스트",
      capacity: 12,
      minPlayers: 2,
      snapPreset: "light",
      snapRounds: 3,
      snapSeconds: 20,
    }).success,
    true,
  );
});

test("snap-pang full 3-round mix game runs color, object, smile-bomb, 3D podium and 24h saved run", async () => {
  const host = person(owner);
  const { id: roomId } = await service.create(owner, {
    gameType: "snap-pang",
    title: "금요일 테이블 스냅 팡",
    capacity: 6,
    minPlayers: 2,
    snapPreset: "mix",
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

  // Start game -> Round 1 briefing (always Color Sniper in mix preset)
  const started = await service.host(roomId, host, {
    action: "start",
    revision: updated.revision,
  });
  assert.equal(started.phase, "playing");
  assert.equal(started.snapPang!.stage, "briefing");
  assert.equal(started.snapPang!.round, 1);
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

  // Host skips reveal -> Round 2 briefing (Object Hunt)
  const r2Brief = await service.host(roomId, host, {
    action: "snap-control",
    revision: r1Reveal.revision,
    phaseId: r1Reveal.snapPang!.phaseId,
    command: "next",
  });
  assert.equal(r2Brief.snapPang!.round, 2);
  assert.equal(r2Brief.snapPang!.mission!.kind, "object");

  // Host skips briefing -> Round 2 active
  const r2Active = await service.host(roomId, host, {
    action: "snap-control",
    revision: r2Brief.revision,
    phaseId: r2Brief.snapPang!.phaseId,
    command: "next",
  });
  assert.equal(r2Active.snapPang!.stage, "active");

  now = new Date(now.getTime() + 1_200);
  await service.player(roomId, p2, {
    action: "snap-object",
    runId,
    round: 2,
    confidence: 0.88,
    fallback: false,
  });
  now = new Date(now.getTime() + 1_500);
  await service.player(roomId, p1, {
    action: "snap-object",
    runId,
    round: 2,
    confidence: 0.72,
    fallback: false,
  });
  now = new Date(now.getTime() + 1_500);
  const r2Reveal = await service.player(roomId, p3, {
    action: "snap-object",
    runId,
    round: 2,
    confidence: 0.85,
    fallback: true,
  });
  assert.equal(r2Reveal.snapPang!.stage, "reveal");
  assert.equal(
    r2Reveal.snapPang!.lastResult!.entries.find((e) => e.playerId === v2.viewer.id)!.points,
    3,
  );
  assert.equal(
    r2Reveal.snapPang!.lastResult!.entries.find((e) => e.playerId === v1.viewer.id)!.points,
    2,
  );
  assert.equal(
    r2Reveal.snapPang!.lastResult!.entries.find((e) => e.playerId === v3.viewer.id)!.points,
    1,
  );

  // Round 3: Smile Bomb
  const r3Brief = await service.host(roomId, host, {
    action: "snap-control",
    revision: r2Reveal.revision,
    phaseId: r2Reveal.snapPang!.phaseId,
    command: "next",
  });
  assert.equal(r3Brief.snapPang!.round, 3);
  assert.equal(r3Brief.snapPang!.mission!.kind, "face");
  assert.equal(r3Brief.snapPang!.mission!.subMode, "smile-bomb");

  const r3Active = await service.host(roomId, host, {
    action: "snap-control",
    revision: r3Brief.revision,
    phaseId: r3Brief.snapPang!.phaseId,
    command: "next",
  });
  const attackerId =
    r3Active.snapPang!.mission!.kind === "face" ? r3Active.snapPang!.mission!.attackerId : null;
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
      round: 3,
      tension: 50,
      popped: false,
    }),
    code("FORBIDDEN"),
  );

  // Defender 0 raises tension then pops; Defender 1 stays stone-faced until timer ends
  const mid = await service.player(roomId, defenders[0]!, {
    action: "snap-tension",
    runId,
    round: 3,
    tension: 65,
    popped: false,
  });
  assert.equal(mid.snapPang!.stage, "active");
  await service.player(roomId, defenders[0]!, {
    action: "snap-tension",
    runId,
    round: 3,
    tension: 100,
    popped: true,
  });
  // Expire round 3 active timer -> settles smile-bomb
  now = new Date(now.getTime() + 16_000);
  const r3Reveal = await service.read(roomId, host);
  assert.equal(r3Reveal.snapPang!.stage, "reveal");
  const attackerResult = r3Reveal.snapPang!.lastResult!.entries.find((e) => e.isAttacker)!;
  assert.equal(attackerResult.points, 1); // 1 defender popped
  assert.equal(
    r3Reveal.snapPang!.lastResult!.entries.filter((e) => !e.isAttacker && !e.popped)[0]!.points,
    2,
  );

  // Advance past reveal -> final 3D podium & room phase "finished" + 24h saved gameRun
  now = new Date(now.getTime() + 7_000);
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

test("light preset never schedules face rounds and pokerface preset runs face-copy cleanly", async () => {
  const host = person(owner);
  const { id: lightRoom } = await service.create(owner, {
    gameType: "snap-pang",
    title: "첫 만남 라이트",
    capacity: 4,
    minPlayers: 2,
    snapPreset: "light",
    snapRounds: 5,
    snapSeconds: 15,
  });
  const a = person();
  const b = person();
  await joinReady(lightRoom, a, "하나");
  await joinReady(lightRoom, b, "두리");
  let state = await service.host(lightRoom, host, {
    action: "start",
    revision: (await service.read(lightRoom, host)).revision,
  });
  for (let round = 1; round <= 5; round++) {
    assert.notEqual(state.snapPang!.mission!.kind, "face");
    // Skip briefing -> active -> reveal -> next
    state = await service.host(lightRoom, host, {
      action: "snap-control",
      revision: state.revision,
      phaseId: state.snapPang!.phaseId,
      command: "next",
    });
    state = await service.host(lightRoom, host, {
      action: "snap-control",
      revision: state.revision,
      phaseId: state.snapPang!.phaseId,
      command: "next",
    });
    state = await service.host(lightRoom, host, {
      action: "snap-control",
      revision: state.revision,
      phaseId: state.snapPang!.phaseId,
      command: "next",
    });
  }
  assert.equal(state.phase, "finished");

  // Pokerface preset: Round 2 is face-copy
  const { id: pokerRoom } = await service.create(owner, {
    gameType: "snap-pang",
    title: "웃참 스페셜",
    capacity: 4,
    minPlayers: 2,
    snapPreset: "pokerface",
    snapRounds: 3,
    snapSeconds: 20,
  });
  const c = person();
  const d = person();
  await joinReady(pokerRoom, c, "세찌");
  await joinReady(pokerRoom, d, "네찌");
  let pState = await service.host(pokerRoom, host, {
    action: "start",
    revision: (await service.read(pokerRoom, host)).revision,
  });
  assert.equal(pState.snapPang!.mission!.kind, "face");
  assert.equal(pState.snapPang!.mission!.subMode, "smile-bomb");
  // Skip R1 briefing -> active -> reveal -> R2 briefing (face-copy)
  for (let i = 0; i < 3; i++) {
    pState = await service.host(pokerRoom, host, {
      action: "snap-control",
      revision: pState.revision,
      phaseId: pState.snapPang!.phaseId,
      command: "next",
    });
  }
  assert.equal(pState.snapPang!.mission!.kind, "face");
  assert.equal(pState.snapPang!.mission!.subMode, "face-copy");
  pState = await service.host(pokerRoom, host, {
    action: "snap-control",
    revision: pState.revision,
    phaseId: pState.snapPang!.phaseId,
    command: "next",
  });
  now = new Date(now.getTime() + 1_000);
  await service.player(pokerRoom, c, {
    action: "snap-face-copy",
    runId: pState.snapPang!.runId!,
    round: 2,
    fallback: false,
  });
  now = new Date(now.getTime() + 1_000);
  const done = await service.player(pokerRoom, d, {
    action: "snap-face-copy",
    runId: pState.snapPang!.runId!,
    round: 2,
    fallback: true,
  });
  assert.equal(done.snapPang!.stage, "reveal");
  assert.equal(done.snapPang!.lastResult!.entries[0]!.points, 3);
  assert.equal(done.snapPang!.lastResult!.entries[1]!.points, 2);
});
