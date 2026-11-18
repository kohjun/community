import { randomInt, randomUUID } from "node:crypto";
import {
  DRAWING_MODES,
  normalizeDrawingAnswer,
  type CreativePlayerAction,
  type DrawingSettings,
  type DrawingState,
  type DrawingView,
} from "../domain/creative-games";
import { AppError } from "./errors";
const prompts = [
  "떡볶이를 먹는 펭귄",
  "비 오는 한강에서 치킨을 지키는 사람",
  "노래방에서 탬버린을 흔드는 고양이",
  "단체 사진에서 혼자 눈을 감은 토끼",
  "지하철을 놓친 공룡",
  "컵라면을 기다리는 우주인",
  "보드게임 규칙을 모르는 왕",
  "첫 모임에 늦게 온 곰",
  "라면을 끓이는 로봇",
  "피자를 배달하는 외계인",
  "우산을 나눠 쓰는 강아지",
  "사막에서 눈사람 만드는 사람",
  "한강에서 기타 치는 문어",
  "수영장에 간 산타",
  "커피를 쏟은 마법사",
  "노트북으로 일하는 원숭이",
  "시장에 장 보러 간 유령",
  "풍선을 타고 출근하는 사람",
  "운동회에서 달리는 나무늘보",
  "캠핑장에서 요리하는 햄스터",
];
export function shuffle<T>(values: readonly T[]) {
  const a = [...values];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
export function newDrawing(settings: DrawingSettings): DrawingState {
  return {
    settings,
    stage: "lobby",
    runId: null,
    phaseId: randomUUID(),
    roster: [],
    chains: [],
    history: [],
    finishedAt: null,
    set: 0,
    index: 0,
    endsAt: null,
    paused: null,
    guesses: [],
    votes: {},
    tallies: {},
  };
}
const current = (s: DrawingState) => s.chains[s.index];
function enter(s: DrawingState, stage: DrawingState["stage"], now: number, seconds: number | null) {
  s.stage = stage;
  if (stage === "result" || stage === "aborted") s.finishedAt = now;
  s.phaseId = randomUUID();
  s.endsAt = seconds === null ? null : now + seconds * 1000;
  s.paused = null;
}
function beginSet(s: DrawingState, now: number) {
  s.set++;
  s.index = 0;
  s.guesses = [];
  s.votes = {};
  const ids = shuffle(s.roster.map((p) => p.id)),
    n = ids.length;
  s.chains = ids.map((id, i) => ({
    id: randomUUID(),
    author: id,
    painter: ids[(i + 1) % n]!,
    interpreter: ids[(i + 2) % n]!,
    finalPainter: ids[(i + 3) % n]!,
    prompt: null,
    image: null,
    interpretation: null,
    finalImage: null,
    skipped: false,
    winner: null,
  }));
  if (s.settings.mode === "live") {
    for (const c of s.chains) {
      c.finalPainter = c.author;
      c.prompt = prompts[randomInt(prompts.length)]!;
      c.interpretation = c.prompt;
    }
    enter(s, "live", now, s.settings.seconds);
  } else enter(s, "prompt", now, 30);
}
export function startDrawing(
  s: DrawingState,
  players: { id: string; nickname: string }[],
  now: number,
) {
  if (players.length < DRAWING_MODES[s.settings.mode].minimum || players.length > 12)
    throw new AppError(
      "VALIDATION",
      `이 모드는 ${DRAWING_MODES[s.settings.mode].minimum}~12명이 필요해요.`,
    );
  Object.assign(s, newDrawing(s.settings));
  s.runId = randomUUID();
  s.roster = players.map((p) => ({ ...p, score: 0 }));
  beginSet(s, now);
}
export function drawingAssignment(s: DrawingState, id: string | null) {
  if (!id || !s.runId) return null;
  const chain =
    s.stage === "prompt"
      ? s.chains.find((c) => c.author === id)
      : s.stage === "draw"
        ? s.chains.find((c) => c.painter === id)
        : s.stage === "interpret"
          ? s.chains.find((c) => c.interpreter === id)
          : ["live", "judging"].includes(s.stage) && current(s)?.finalPainter === id
            ? current(s)
            : undefined;
  if (!chain) return null;
  return {
    chainId: chain.id,
    canvasId: `${s.runId}:${s.set}:${chain.id}:${s.stage === "draw" ? "first" : "final"}`,
    prompt:
      s.stage === "draw"
        ? chain.prompt
        : ["live", "judging"].includes(s.stage)
          ? chain.interpretation
          : null,
    image: s.stage === "interpret" ? chain.image : null,
  };
}
function review(s: DrawingState, now: number) {
  const c = current(s);
  if (!c) return;
  const winner = [...s.guesses]
    .filter((g) => g.accepted)
    .sort((a, b) => a.receivedAt - b.receivedAt)[0];
  c.winner = winner?.playerId ?? null;
  if (winner && s.settings.scored) {
    s.roster.find((p) => p.id === winner.playerId)!.score += 2;
    s.roster.find((p) => p.id === c.finalPainter)!.score++;
  }
  enter(s, "review", now, 15);
}
function nextChain(s: DrawingState, now: number) {
  s.guesses = [];
  s.index++;
  if (s.index >= s.chains.length) {
    if (s.settings.mode === "relay") {
      enter(s, "voting", now, 30);
      return;
    }
    finishSet(s, now);
    return;
  }
  if (s.settings.mode === "relay") enter(s, "gallery", now, 15);
  else if (current(s)!.skipped) enter(s, "review", now, 5);
  else enter(s, "live", now, s.settings.seconds);
}
function finishSet(s: DrawingState, now: number) {
  for (const c of s.chains)
    s.tallies[c.id] = Object.values(s.votes).filter((v) => v === c.id).length;
  s.history.push(...s.chains);
  if (s.set < s.settings.sets) beginSet(s, now);
  else enter(s, "result", now, null);
}
function advance(s: DrawingState, now: number) {
  if (s.stage === "prompt") {
    for (const c of s.chains) c.prompt ??= prompts[randomInt(prompts.length)]!;
    enter(s, "draw", now, s.settings.seconds);
  } else if (s.stage === "draw") enter(s, "interpret", now, 30);
  else if (s.stage === "interpret") {
    for (const c of s.chains) c.skipped = !c.image || !c.interpretation;
    s.index = 0;
    enter(
      s,
      s.settings.mode === "relay" ? "gallery" : current(s)?.skipped ? "review" : "live",
      now,
      current(s)?.skipped ? 5 : s.settings.mode === "relay" ? 15 : s.settings.seconds,
    );
  } else if (s.stage === "live") enter(s, "judging", now, 10);
  else if (s.stage === "judging") review(s, now);
  else if (s.stage === "review" || s.stage === "gallery") nextChain(s, now);
  else if (s.stage === "voting") finishSet(s, now);
}
export function tickDrawing(s: DrawingState, now: number) {
  let changed = false;
  for (let i = 0; i < 200 && !s.paused && s.endsAt !== null && s.endsAt <= now; i++) {
    advance(s, s.endsAt);
    changed = true;
  }
  return changed;
}
export function controlDrawing(s: DrawingState, action: "next" | "pause" | "resume", now: number) {
  if (["lobby", "result", "aborted"].includes(s.stage))
    throw new AppError("CONFLICT", "진행 중인 게임에서 눌러주세요.");
  if (action === "pause") {
    if (s.paused === null) {
      s.paused = Math.max(1, (s.endsAt ?? now) - now);
      s.endsAt = null;
    }
    return;
  }
  if (action === "resume") {
    if (s.paused !== null) {
      s.endsAt = now + s.paused;
      s.paused = null;
    }
    return;
  }
  if (s.paused !== null) throw new AppError("CONFLICT", "일시정지를 해제한 뒤 진행해주세요.");
  advance(s, now);
}
export function actDrawing(s: DrawingState, id: string, action: CreativePlayerAction, now: number) {
  if (!("runId" in action) || s.runId !== action.runId || s.phaseId !== action.phaseId)
    throw new AppError("CONFLICT", "단계가 바뀌었어요. 현재 화면을 확인해주세요.");
  if (!s.roster.some((p) => p.id === id))
    throw new AppError("FORBIDDEN", "함께 시작한 참가자만 참여할 수 있어요.");
  if (s.paused !== null) throw new AppError("CONFLICT", "잠시 쉬는 중이에요.");
  const assignment = drawingAssignment(s, id),
    c = current(s);
  if (action.action === "drawing-text") {
    if (!assignment || !["prompt", "interpret"].includes(s.stage))
      throw new AppError("FORBIDDEN", "지금은 문장을 제출할 차례가 아니에요.");
    const chain = s.chains.find((c) => c.id === assignment.chainId)!;
    const key = s.stage === "prompt" ? "prompt" : "interpretation";
    if (chain[key]) throw new AppError("CONFLICT", "이미 문장을 제출했어요.");
    chain[key] = action.text;
    if (s.chains.every((c) => !!c[key])) advance(s, now);
    return;
  }
  if (action.action === "drawing-image") {
    if (!assignment || !["draw", "live", "judging"].includes(s.stage))
      throw new AppError("FORBIDDEN", "그림을 제출할 차례가 아니에요.");
    const chain = s.chains.find((c) => c.id === assignment.chainId)!;
    const key = s.stage === "draw" ? "image" : "finalImage";
    if (chain[key]) throw new AppError("CONFLICT", "이미 그림을 제출했어요.");
    chain[key] = action.assetId;
    if (s.stage === "draw" && s.chains.every((c) => !!c.image)) advance(s, now);
    return;
  }
  if (action.action === "drawing-guess") {
    if (
      s.stage !== "live" ||
      !c ||
      id === c.finalPainter ||
      (s.settings.mode === "mix" && id === c.interpreter)
    )
      throw new AppError("FORBIDDEN", "이번 정답을 알고 있는 사람은 추리하지 않아요.");
    const mine = s.guesses.filter((g) => g.playerId === id);
    if (mine.length >= 20 || now - (mine.at(-1)?.receivedAt ?? 0) < 1000)
      throw new AppError("RATE_LIMITED", "잠시 생각한 뒤 다시 제출해주세요.");
    const accepted =
      normalizeDrawingAnswer(action.text) === normalizeDrawingAnswer(c.interpretation ?? "");
    s.guesses.push({
      id: randomUUID(),
      playerId: id,
      text: action.text,
      accepted,
      receivedAt: now,
    });
    if (accepted) enter(s, "judging", now, 10);
    return;
  }
  if (action.action === "drawing-judge") {
    const judge = s.settings.mode === "mix" ? c?.interpreter : c?.finalPainter;
    if (!["live", "judging"].includes(s.stage) || id !== judge)
      throw new AppError("FORBIDDEN", "이번 문장 담당자만 정답을 인정할 수 있어요.");
    const guess = s.guesses.find((g) => g.id === action.guessId);
    if (!guess) throw new AppError("NOT_FOUND", "답변을 찾을 수 없어요.");
    guess.accepted = true;
    if (s.stage === "live") enter(s, "judging", now, 10);
    return;
  }
  if (action.action === "drawing-vote") {
    if (s.stage !== "voting" || s.settings.mode !== "relay")
      throw new AppError("CONFLICT", "마지막 투표에서 선택해주세요.");
    const chain = s.chains.find((c) => c.id === action.chainId);
    if (!chain || chain.author === id)
      throw new AppError("VALIDATION", "다른 사람의 릴레이를 골라주세요.");
    if (s.votes[id]) throw new AppError("CONFLICT", "이미 투표했어요.");
    s.votes[id] = chain.id;
    if (Object.keys(s.votes).length === s.roster.length) finishSet(s, now);
    return;
  }
  throw new AppError("VALIDATION", "현재 게임의 동작을 사용해주세요.");
}
export function drawingView(s: DrawingState, id: string | null, now: number): DrawingView {
  const c = current(s),
    judge = s.settings.mode === "mix" ? c?.interpreter : c?.finalPainter;
  const final = ["result", "aborted"].includes(s.stage),
    publicStage = ["review", "gallery", "voting"].includes(s.stage);
  const revealed = final
    ? [...s.history, ...(s.stage === "aborted" ? s.chains : [])]
    : publicStage
      ? s.chains.slice(0, s.stage === "voting" ? undefined : s.index + 1)
      : [];
  const assignment = drawingAssignment(s, id),
    key =
      s.stage === "prompt"
        ? "prompt"
        : s.stage === "draw"
          ? "image"
          : s.stage === "interpret"
            ? "interpretation"
            : null;
  return {
    settings: s.settings,
    stage: s.stage,
    runId: s.runId,
    phaseId: s.phaseId,
    roster: s.roster.map((p) => ({ ...p })),
    finishedAt: s.finishedAt,
    set: s.set,
    index: s.index,
    endsAt: s.endsAt,
    serverNow: now,
    paused: s.paused !== null,
    assignment,
    liveCanvasId:
      s.runId && c && ["live", "judging"].includes(s.stage)
        ? `${s.runId}:${s.set}:${c.id}:final`
        : null,
    artistId: ["live", "judging"].includes(s.stage) ? (c?.finalPainter ?? null) : null,
    judgeId: ["live", "judging"].includes(s.stage) ? (judge ?? null) : null,
    canGuess:
      s.stage === "live" &&
      !!id &&
      s.roster.some((p) => p.id === id) &&
      id !== c?.finalPainter &&
      (s.settings.mode !== "mix" || id !== c?.interpreter),
    canJudge: !!id && id === judge && ["live", "judging"].includes(s.stage),
    guesses: (id === judge || publicStage || final
      ? s.guesses
      : s.guesses.filter((g) => g.playerId === id)
    ).map((g) => ({ ...g })),
    revealed,
    submitted: !!(assignment && key && s.chains.find((c) => c.id === assignment.chainId)?.[key]),
    submittedCount: key ? s.chains.filter((c) => !!c[key]).length : 0,
    expected: s.roster.length,
    voteCounts: {
      ...s.tallies,
      ...Object.fromEntries(
        s.chains.map((c) => [c.id, Object.values(s.votes).filter((v) => v === c.id).length]),
      ),
    },
    myVote: id ? (s.votes[id] ?? null) : null,
  };
}
