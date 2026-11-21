import { randomInt, randomUUID } from "node:crypto";
import { computeColorMatchScore, normalizeHex } from "../lib/vision/color-lab";
import {
  SNAP_ATTACK_CARDS,
  SNAP_AVATAR_COLORS,
  SNAP_COLOR_BANK,
  SNAP_FACE_COMBOS,
  SNAP_OBJECT_BANK,
  SNAP_PANG_BRIEFING_MS,
  SNAP_PANG_REVEAL_MS,
  snapPangRoundPlan,
  type SnapFaceSubMode,
  type SnapMission,
  type SnapPangPlayer,
  type SnapPangPlayerAction,
  type SnapPangSettings,
  type SnapPangState,
  type SnapPangView,
  type SnapRoundEntryResult,
  type SnapRoundResult,
} from "../domain/snap-pang";
import { AppError } from "./errors";

function shuffle<T>(items: readonly T[]): T[] {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  return list;
}

function buildDeck(settings: SnapPangSettings, roster: SnapPangPlayer[]): SnapMission[] {
  const colors = shuffle(SNAP_COLOR_BANK);
  const objects = shuffle(SNAP_OBJECT_BANK);
  const attacks = shuffle(SNAP_ATTACK_CARDS);
  const combos = shuffle(SNAP_FACE_COMBOS);
  const attackers = shuffle(roster.map((p) => p.id));
  let colorIdx = 0;
  let objIdx = 0;
  let atkIdx = 0;
  let comboIdx = 0;
  let attackerTurn = 0;

  return snapPangRoundPlan(settings.preset, settings.rounds).map((slot, index) => {
    if (slot.kind === "color") {
      const picked = colors[colorIdx % colors.length]!;
      colorIdx++;
      return { kind: "color", ...picked, id: `${picked.id}-${index + 1}` };
    }
    if (slot.kind === "object") {
      const picked = objects[objIdx % objects.length]!;
      objIdx++;
      return { kind: "object", ...picked, id: `${picked.id}-${index + 1}` };
    }
    const subMode: SnapFaceSubMode = slot.face ?? "smile-bomb";
    if (subMode === "smile-bomb") {
      const attackerId = attackers.length ? attackers[attackerTurn % attackers.length]! : null;
      attackerTurn++;
      const attackCard = attacks[atkIdx % attacks.length]!;
      atkIdx++;
      return {
        kind: "face",
        id: `smile-bomb-${index + 1}`,
        subMode: "smile-bomb",
        attackerId,
        attackCard,
        expressions: [],
        prompt: "원본 얼굴은 3D 아바타가 가려줘요. 공격자의 도발을 버티고 무표정을 지키세요!",
      };
    }
    const expressions = [...combos[comboIdx % combos.length]!];
    comboIdx++;
    return {
      kind: "face",
      id: `face-copy-${index + 1}`,
      subMode: "face-copy",
      attackerId: null,
      attackCard: null,
      expressions,
      prompt: "3D 아바타를 보며 제시된 표정 2개를 순서대로 따라 하면 콤보 클리어!",
    };
  });
}

export function newSnapPang(settings: SnapPangSettings): SnapPangState {
  return {
    settings,
    stage: "lobby",
    runId: null,
    phaseId: randomUUID(),
    round: 0,
    totalRounds: settings.rounds,
    roster: [],
    deck: [],
    roundStartedAt: null,
    endsAt: null,
    pausedRemainingMs: null,
    submissions: {},
    tensions: {},
    history: [],
    finishedAt: null,
  };
}

function currentMission(state: SnapPangState): SnapMission | null {
  if (state.round < 1 || state.round > state.deck.length) return null;
  return state.deck[state.round - 1] ?? null;
}

function enterBriefing(state: SnapPangState, round: number, now: number) {
  state.round = round;
  state.stage = "briefing";
  state.phaseId = randomUUID();
  state.roundStartedAt = null;
  state.endsAt = now + SNAP_PANG_BRIEFING_MS;
  state.pausedRemainingMs = null;
  state.submissions = {};
  state.tensions = {};
}

function enterActive(state: SnapPangState, now: number) {
  const mission = currentMission(state);
  state.stage = "active";
  state.phaseId = randomUUID();
  state.roundStartedAt = now;
  state.endsAt = now + state.settings.seconds * 1000;
  state.pausedRemainingMs = null;
  state.submissions = {};
  state.tensions = {};
  if (mission?.kind === "face" && mission.subMode === "smile-bomb") {
    for (const player of state.roster) {
      if (player.id === mission.attackerId) continue;
      state.tensions[player.id] = { tension: 0, popped: false, poppedAt: null, updatedAt: now };
    }
  }
}

export function startSnapPang(
  state: SnapPangState,
  participants: { id: string; nickname: string }[],
  now: number,
) {
  state.roster = participants.map((player, index) => ({
    id: player.id,
    nickname: player.nickname,
    score: 0,
    color: SNAP_AVATAR_COLORS[index % SNAP_AVATAR_COLORS.length]!,
  }));
  state.runId = randomUUID();
  state.totalRounds = state.settings.rounds;
  state.deck = buildDeck(state.settings, state.roster);
  state.history = [];
  state.finishedAt = null;
  enterBriefing(state, 1, now);
}

function settleCurrentRound(state: SnapPangState, now: number) {
  const mission = currentMission(state);
  if (!mission) return;
  const entries: SnapRoundEntryResult[] = [];

  if (mission.kind === "color") {
    const scored = state.roster.map((player) => {
      const sub = state.submissions[player.id];
      if (sub?.mode === "color") {
        return {
          player,
          submitted: true,
          hex: sub.hex,
          accuracy: sub.accuracy,
          submittedAt: sub.submittedAt,
          fallback: sub.fallback,
        };
      }
      return {
        player,
        submitted: false,
        hex: null,
        accuracy: -1,
        submittedAt: Number.MAX_SAFE_INTEGER,
        fallback: false,
      };
    });
    const qualifying = scored
      .filter((item) => item.submitted && item.accuracy >= 35)
      .sort((a, b) => b.accuracy - a.accuracy || a.submittedAt - b.submittedAt);

    const rankMap = new Map<string, { rank: number; points: number }>();
    let prevAccuracy = -1;
    let currentRank = 0;
    qualifying.forEach((item, index) => {
      if (item.accuracy !== prevAccuracy) {
        currentRank = index + 1;
        prevAccuracy = item.accuracy;
      }
      const points = currentRank === 1 ? 3 : currentRank === 2 ? 2 : currentRank === 3 ? 1 : 0;
      rankMap.set(item.player.id, { rank: currentRank, points });
    });

    for (const item of scored) {
      const award = rankMap.get(item.player.id);
      const points = award?.points ?? 0;
      item.player.score += points;
      entries.push({
        playerId: item.player.id,
        nickname: item.player.nickname,
        color: item.player.color,
        points,
        rank: award?.rank ?? null,
        hex: item.hex,
        accuracy: item.submitted ? item.accuracy : null,
        fallback: item.fallback,
        detail: item.submitted
          ? `일치도 ${item.accuracy}%${item.fallback ? " (대체)" : ""}`
          : "미제출",
      });
    }
    entries.sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1));
  } else if (
    mission.kind === "object" ||
    (mission.kind === "face" && mission.subMode === "face-copy")
  ) {
    const mode = mission.kind === "object" ? "object" : "face-copy";
    const completed = state.roster
      .map((player) => {
        const sub = state.submissions[player.id];
        if (sub && sub.mode === mode) {
          return { player, elapsedMs: sub.elapsedMs, fallback: sub.fallback };
        }
        return null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.elapsedMs - b.elapsedMs);

    const awardMap = new Map<
      string,
      { rank: number; points: number; elapsedMs: number; fallback: boolean }
    >();
    completed.forEach((item, index) => {
      const rank = index + 1;
      const points = rank === 1 ? 3 : rank === 2 ? 2 : 1;
      awardMap.set(item.player.id, {
        rank,
        points,
        elapsedMs: item.elapsedMs,
        fallback: item.fallback,
      });
    });

    for (const player of state.roster) {
      const award = awardMap.get(player.id);
      const points = award?.points ?? 0;
      player.score += points;
      entries.push({
        playerId: player.id,
        nickname: player.nickname,
        color: player.color,
        points,
        rank: award?.rank ?? null,
        elapsedMs: award?.elapsedMs ?? null,
        fallback: award?.fallback ?? false,
        detail: award
          ? `${(award.elapsedMs / 1000).toFixed(1)}초 클리어${award.fallback ? " (대체)" : ""}`
          : "시간 초과",
      });
    }
    entries.sort(
      (a, b) => (a.elapsedMs ?? Number.MAX_SAFE_INTEGER) - (b.elapsedMs ?? Number.MAX_SAFE_INTEGER),
    );
  } else {
    // smile-bomb
    const defenders = state.roster.filter((p) => p.id !== mission.attackerId);
    const poppedCount = defenders.filter((p) => state.tensions[p.id]?.popped).length;
    const allPopped = defenders.length >= 2 && poppedCount === defenders.length;
    for (const player of state.roster) {
      if (player.id === mission.attackerId) {
        const points = allPopped ? 4 : Math.min(3, poppedCount);
        player.score += points;
        entries.push({
          playerId: player.id,
          nickname: player.nickname,
          color: player.color,
          points,
          rank: poppedCount > 0 ? 1 : null,
          isAttacker: true,
          detail:
            poppedCount > 0
              ? `공격 성공! ${poppedCount}명 폭탄 폭발`
              : "공격 실패 · 모두 포커페이스 사수",
        });
      } else {
        const live = state.tensions[player.id];
        const popped = !!live?.popped;
        const points = popped ? 0 : 2;
        player.score += points;
        entries.push({
          playerId: player.id,
          nickname: player.nickname,
          color: player.color,
          points,
          rank: popped ? null : 1,
          popped,
          detail: popped
            ? "웃음 폭발! 3D 폭탄 팡!"
            : `포커페이스 생존! (최대 긴장 ${live?.tension ?? 0}%)`,
        });
      }
    }
    entries.sort((a, b) => b.points - a.points);
  }

  const result: SnapRoundResult = { round: state.round, mission, entries };
  state.history.push(result);
  state.stage = "reveal";
  state.phaseId = randomUUID();
  state.endsAt = now + SNAP_PANG_REVEAL_MS;
  state.pausedRemainingMs = null;
}

function advanceAfterReveal(state: SnapPangState, now: number) {
  if (state.round >= state.totalRounds) {
    state.stage = "result";
    state.phaseId = randomUUID();
    state.endsAt = null;
    state.pausedRemainingMs = null;
    state.finishedAt = now;
  } else {
    enterBriefing(state, state.round + 1, now);
  }
}

export function tickSnapPang(state: SnapPangState, now: number): boolean {
  if (state.pausedRemainingMs !== null || state.endsAt === null || now < state.endsAt) return false;
  if (state.stage === "briefing") {
    enterActive(state, now);
    return true;
  }
  if (state.stage === "active") {
    settleCurrentRound(state, now);
    return true;
  }
  if (state.stage === "reveal") {
    advanceAfterReveal(state, now);
    return true;
  }
  return false;
}

export function controlSnapPang(
  state: SnapPangState,
  command: "next" | "pause" | "resume",
  now: number,
) {
  if (!["briefing", "active", "reveal"].includes(state.stage))
    throw new AppError("CONFLICT", "현재 단계에서는 진행을 제어할 수 없어요.");
  if (command === "pause") {
    if (state.pausedRemainingMs !== null || state.endsAt === null)
      throw new AppError("CONFLICT", "이미 일시정지 상태예요.");
    state.pausedRemainingMs = Math.max(1_000, state.endsAt - now);
    state.endsAt = null;
    state.phaseId = randomUUID();
    return;
  }
  if (command === "resume") {
    if (state.pausedRemainingMs === null)
      throw new AppError("CONFLICT", "일시정지 상태가 아니에요.");
    state.endsAt = now + state.pausedRemainingMs;
    state.pausedRemainingMs = null;
    state.phaseId = randomUUID();
    return;
  }
  // command === "next"
  if (state.stage === "briefing") enterActive(state, now);
  else if (state.stage === "active") settleCurrentRound(state, now);
  else if (state.stage === "reveal") advanceAfterReveal(state, now);
}

export function actSnapPang(
  state: SnapPangState,
  playerId: string,
  action: SnapPangPlayerAction,
  now: number,
) {
  if (state.runId !== action.runId) throw new AppError("CONFLICT", "새 게임이 시작됐어요.");
  if (!state.roster.some((p) => p.id === playerId))
    throw new AppError("FORBIDDEN", "이 게임을 함께 시작한 참가자만 참여할 수 있어요.");
  if (state.stage !== "active" || state.round !== action.round)
    throw new AppError("CONFLICT", "현재 진행 중인 라운드에서만 제출할 수 있어요.");
  if (state.pausedRemainingMs !== null) throw new AppError("CONFLICT", "게임이 일시정지 상태예요.");
  const mission = currentMission(state);
  if (!mission) throw new AppError("CONFLICT", "현재 라운드 정보를 찾을 수 없어요.");

  if (action.action === "snap-color") {
    if (mission.kind !== "color")
      throw new AppError("CONFLICT", "지금은 컬러 스나이퍼 라운드가 아니에요.");
    const hex = normalizeHex(action.hex);
    const accuracy = computeColorMatchScore(mission.targetHex, hex);
    const prev = state.submissions[playerId];
    // Allow improving shot within the 15s window or locking once — only keep higher accuracy if re-submitted?
    // Keeping single lock makes every shutter click tense and authentic!
    if (prev) throw new AppError("CONFLICT", "이번 라운드 셔터를 이미 눌렀어요.");
    state.submissions[playerId] = {
      mode: "color",
      hex,
      accuracy,
      fallback: action.fallback,
      submittedAt: now,
    };
    if (Object.keys(state.submissions).length >= state.roster.length) {
      settleCurrentRound(state, now);
    }
    return;
  }

  if (action.action === "snap-object") {
    if (mission.kind !== "object")
      throw new AppError("CONFLICT", "지금은 테이블 헌터 라운드가 아니에요.");
    if (state.submissions[playerId]) throw new AppError("CONFLICT", "이미 사물 포착을 완료했어요.");
    const elapsedMs = Math.max(250, now - (state.roundStartedAt ?? now));
    state.submissions[playerId] = {
      mode: "object",
      matched: true,
      elapsedMs,
      confidence: Math.max(0, Math.min(1, Number(action.confidence.toFixed(2)))),
      fallback: action.fallback,
      submittedAt: now,
    };
    if (Object.keys(state.submissions).length >= state.roster.length) {
      settleCurrentRound(state, now);
    }
    return;
  }

  if (action.action === "snap-face-copy") {
    if (mission.kind !== "face" || mission.subMode !== "face-copy")
      throw new AppError("CONFLICT", "지금은 표정 카피 라운드가 아니에요.");
    if (state.submissions[playerId]) throw new AppError("CONFLICT", "이미 표정 콤보를 완료했어요.");
    const elapsedMs = Math.max(250, now - (state.roundStartedAt ?? now));
    state.submissions[playerId] = {
      mode: "face-copy",
      completed: true,
      elapsedMs,
      fallback: action.fallback,
      submittedAt: now,
    };
    if (Object.keys(state.submissions).length >= state.roster.length) {
      settleCurrentRound(state, now);
    }
    return;
  }

  // action.action === "snap-tension"
  if (mission.kind !== "face" || mission.subMode !== "smile-bomb")
    throw new AppError("CONFLICT", "지금은 웃음 참기 폭탄 라운드가 아니에요.");
  if (playerId === mission.attackerId)
    throw new AppError("FORBIDDEN", "공격자는 폭탄 게이지를 제출하지 않아요.");
  const existing = state.tensions[playerId] ?? {
    tension: 0,
    popped: false,
    poppedAt: null,
    updatedAt: now,
  };
  if (existing.popped) return; // Once popped, stays popped for the round
  const popped = action.popped || action.tension >= 100;
  state.tensions[playerId] = {
    tension: popped ? 100 : Math.max(existing.tension, action.tension),
    popped,
    poppedAt: popped ? now : null,
    updatedAt: now,
  };
  const defenders = state.roster.filter((p) => p.id !== mission.attackerId);
  if (defenders.length > 0 && defenders.every((p) => state.tensions[p.id]?.popped)) {
    settleCurrentRound(state, now);
  }
}

export function abortSnapPang(state: SnapPangState, now: number) {
  state.stage = "aborted";
  state.endsAt = null;
  state.pausedRemainingMs = null;
  state.finishedAt = now;
}

export function snapPangView(
  state: SnapPangState,
  playerId: string | null,
  now: number,
): SnapPangView {
  const mission = currentMission(state);
  const isSmileBomb = mission?.kind === "face" && mission.subMode === "smile-bomb";
  const expectedCount = isSmileBomb
    ? Math.max(0, state.roster.length - (mission.attackerId ? 1 : 0))
    : state.roster.length;
  const submittedCount = isSmileBomb
    ? Object.values(state.tensions).filter((t) => t.popped).length
    : Object.keys(state.submissions).length;

  return {
    settings: state.settings,
    stage: state.stage,
    runId: state.runId,
    phaseId: state.phaseId,
    round: state.round,
    totalRounds: state.totalRounds,
    roster: [...state.roster].sort((a, b) => b.score - a.score),
    mission,
    roundStartedAt: state.roundStartedAt,
    endsAt: state.endsAt,
    paused: state.pausedRemainingMs !== null,
    serverNow: now,
    mySubmission: playerId ? (state.submissions[playerId] ?? null) : null,
    submittedCount,
    expectedCount,
    tensions: isSmileBomb ? state.tensions : {},
    lastResult: state.history.at(-1) ?? null,
    history: state.stage === "result" ? state.history : state.history.slice(-1),
  };
}
