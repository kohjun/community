import { randomUUID } from "node:crypto";
import {
  straightLineMetres,
  type ClueAnswer,
  type ClueQuestion,
  type ClueSettings,
  type ClueState,
  type ClueView,
} from "../domain/creative-games";
import { CLUE_STREET_BANK } from "./clue-bank";
import { shuffle } from "./drawing-game";
import { AppError } from "./errors";
export function newClue(settings: ClueSettings): ClueState {
  return {
    settings,
    stage: "lobby",
    runId: null,
    phaseId: randomUUID(),
    roster: [],
    finishedAt: null,
    prepared: [],
    deck: [],
    index: 0,
    endsAt: null,
    paused: null,
    answers: {},
    results: [],
    startedQuestionAt: null,
  };
}
function enter(s: ClueState, stage: ClueState["stage"], now: number, seconds: number | null) {
  s.stage = stage;
  if (stage === "result" || stage === "aborted") s.finishedAt = now;
  s.phaseId = randomUUID();
  s.endsAt = seconds === null ? null : now + seconds * 1000;
  s.paused = null;
}
export function prepareClue(s: ClueState, q: ClueQuestion, who: string, host: boolean) {
  if (s.stage !== "lobby") throw new AppError("CONFLICT", "대기실에서 문제를 준비해주세요.");
  if (s.settings.mode !== "member" && !host)
    throw new AppError("FORBIDDEN", "직접 출제는 호스트만 할 수 있어요.");
  if (s.settings.mode === "quiz") {
    if (
      !["audio", "video"].includes(q.media) ||
      !q.choices ||
      q.choices.length !== 4 ||
      new Set(q.choices).size !== 4 ||
      q.correctChoice === null
    )
      throw new AppError("VALIDATION", "소리·영상과 서로 다른 보기 4개, 정답을 입력해주세요.");
  } else if (q.media !== "photo" || !q.point)
    throw new AppError("VALIDATION", "사진과 지도에서 선택한 정답 위치가 필요해요.");
  if (
    s.settings.mode !== "member" &&
    s.prepared.some((p) => p.assetId === q.assetId && p.authorId === who)
  )
    throw new AppError("CONFLICT", "이미 등록한 자료예요. 다른 단서를 선택해주세요.");
  const question = { ...q, authorId: who };
  if (s.settings.mode === "member") s.prepared = s.prepared.filter((p) => p.authorId !== who);
  if (s.prepared.length >= 20)
    throw new AppError("VALIDATION", "한 방에 최대 20문제를 준비할 수 있어요.");
  s.prepared.push(question);
}
export function clueReady(s: ClueState, ids: string[]) {
  if (s.settings.mode === "member")
    return ids.length >= 2 && ids.every((id) => s.prepared.some((q) => q.authorId === id));
  return s.settings.source === "basic"
    ? CLUE_STREET_BANK.length >= s.settings.rounds
    : s.prepared.length >= s.settings.rounds;
}
function open(s: ClueState, now: number) {
  s.answers = {};
  s.startedQuestionAt = now;
  enter(s, "guess", now, s.settings.seconds);
}
export function startClue(s: ClueState, players: { id: string; nickname: string }[], now: number) {
  if (players.length < 2 || players.length > 12)
    throw new AppError("VALIDATION", "2~12명이 필요해요.");
  if (
    !clueReady(
      s,
      players.map((p) => p.id),
    )
  )
    throw new AppError(
      "VALIDATION",
      s.settings.mode === "member"
        ? "모든 참가자가 사진과 정답 위치를 먼저 등록해주세요."
        : "설정한 문제 수만큼 준비된 자료가 필요해요.",
    );
  s.runId = randomUUID();
  s.roster = players.map((p) => ({ ...p, score: 0 }));
  s.index = 0;
  s.results = [];
  const source =
    s.settings.mode === "member"
      ? s.prepared.filter((q) => players.some((p) => p.id === q.authorId))
      : s.settings.source === "basic"
        ? CLUE_STREET_BANK
        : s.prepared;
  s.deck = shuffle(source)
    .slice(0, s.settings.mode === "member" ? players.length : s.settings.rounds)
    .map((q) => ({
      ...q,
      choices: q.choices ? [...q.choices] : null,
      point: q.point ? { ...q.point } : null,
      street: q.street ? { ...q.street } : null,
    }));
  // Street-view quiz: the place name plus three other places as choices.
  if (s.settings.mode === "quiz" && s.settings.source === "basic")
    for (const q of s.deck) {
      const others = shuffle(CLUE_STREET_BANK.filter((o) => o.label !== q.label)).slice(0, 3);
      q.choices = [q.label, ...others.map((o) => o.label)];
      q.correctChoice = 0;
    }
  for (const q of s.deck) {
    if (q.choices && q.correctChoice !== null) {
      const right = q.choices[q.correctChoice]!;
      q.choices = shuffle(q.choices);
      q.correctChoice = q.choices.indexOf(right);
    }
  }
  open(s, now);
}
function settle(s: ClueState, now: number) {
  const q = s.deck[s.index]!;
  const answers = Object.entries(s.answers).map(([playerId, a]) => ({
    playerId,
    point: a.point ?? null,
    choice: a.choice ?? null,
    authorId: a.authorId ?? null,
    distance: q.point && a.point ? straightLineMetres(q.point, a.point) : null,
    points: 0,
  }));
  const nearest = Math.min(...answers.flatMap((a) => (a.distance === null ? [] : [a.distance])));
  for (const a of answers) {
    a.points =
      s.settings.mode === "quiz"
        ? Number(a.choice === q.correctChoice)
        : Number(a.distance === nearest) +
          (s.settings.mode === "member" ? Number(a.authorId === q.authorId) : 0);
    s.roster.find((p) => p.id === a.playerId)!.score += a.points;
  }
  s.results.push({ question: { ...q }, answers });
  enter(s, "review", now, 15);
}
export function answerClue(
  s: ClueState,
  id: string,
  runId: string,
  phaseId: string,
  answer: ClueAnswer,
  now: number,
) {
  if (s.runId !== runId || s.phaseId !== phaseId || s.stage !== "guess")
    throw new AppError("CONFLICT", "현재 문제에서 답을 제출해주세요.");
  if (s.paused !== null) throw new AppError("CONFLICT", "잠시 쉬는 중이에요.");
  const q = s.deck[s.index]!;
  if (!s.roster.some((p) => p.id === id) || q.authorId === id)
    throw new AppError("FORBIDDEN", "출제자를 제외한 참가자가 추리할 수 있어요.");
  if (s.answers[id]) throw new AppError("CONFLICT", "이미 제출했어요. 결과를 기다려주세요.");
  if (s.settings.mode === "quiz") {
    if (answer.choice === undefined || answer.point !== undefined || answer.authorId !== undefined)
      throw new AppError("VALIDATION", "보기 하나를 선택해주세요.");
    s.answers[id] = { choice: answer.choice };
  } else {
    if (!answer.point || answer.choice !== undefined)
      throw new AppError("VALIDATION", "지도에서 추리 위치를 선택해주세요.");
    if (
      s.settings.mode === "member" &&
      (!answer.authorId ||
        answer.authorId === id ||
        !s.roster.some((p) => p.id === answer.authorId))
    )
      throw new AppError("VALIDATION", "사진 주인을 선택해주세요.");
    s.answers[id] = {
      point: { ...answer.point },
      ...(s.settings.mode === "member" ? { authorId: answer.authorId } : {}),
    };
  }
  if (Object.keys(s.answers).length === s.roster.filter((p) => p.id !== q.authorId).length)
    settle(s, now);
}
export function tickClue(s: ClueState, now: number) {
  let changed = false;
  for (let i = 0; i < 50 && s.paused === null && s.endsAt !== null && s.endsAt <= now; i++) {
    const at = s.endsAt;
    if (s.stage === "guess") settle(s, at);
    else if (s.stage === "review") {
      s.index++;
      if (s.index === s.deck.length) enter(s, "result", at, null);
      else open(s, at);
    } else break;
    changed = true;
  }
  return changed;
}
export function controlClue(s: ClueState, action: "next" | "pause" | "resume", now: number) {
  if (!["guess", "review"].includes(s.stage))
    throw new AppError("CONFLICT", "진행 중인 문제에서 눌러주세요.");
  if (action === "pause") {
    if (s.paused === null) {
      s.paused = Math.max(1, (s.endsAt ?? now) - now);
      s.endsAt = null;
    }
    return;
  }
  if (action === "resume") {
    if (s.paused !== null) {
      const elapsed = s.settings.seconds * 1000 - s.paused;
      if (s.stage === "guess") s.startedQuestionAt = now - elapsed;
      s.endsAt = now + s.paused;
      s.paused = null;
    }
    return;
  }
  if (s.paused !== null) throw new AppError("CONFLICT", "일시정지를 해제한 뒤 진행해주세요.");
  if (s.stage === "guess") settle(s, now);
  else {
    s.index++;
    if (s.index === s.deck.length) enter(s, "result", now, null);
    else open(s, now);
  }
}
export function clueView(
  s: ClueState,
  id: string | null,
  now: number,
  hostOwner: string | null = null,
): ClueView {
  const q = s.stage === "guess" ? s.deck[s.index] : null,
    finished = ["result", "aborted"].includes(s.stage);
  return {
    settings: s.settings,
    stage: s.stage,
    runId: s.runId,
    phaseId: s.phaseId,
    roster: s.roster.map((p) => ({ ...p })),
    finishedAt: s.finishedAt,
    index: s.index,
    endsAt: s.endsAt,
    serverNow: now,
    paused: s.paused !== null,
    startedQuestionAt: s.startedQuestionAt,
    question: q
      ? {
          id: q.id,
          assetId: q.assetId,
          basicAsset: q.basicAsset,
          media: q.media,
          street: q.street ?? null,
          choices: q.choices,
          credit: q.credit,
        }
      : null,
    total: s.deck.length || s.settings.rounds,
    submitted: Object.keys(s.answers).length,
    expected: s.roster.filter((p) => p.id !== s.deck[s.index]?.authorId).length,
    myAnswer: id ? (s.answers[id] ?? null) : null,
    canAnswer:
      s.stage === "guess" && !!id && s.roster.some((p) => p.id === id) && id !== q?.authorId,
    result: s.stage === "review" ? (s.results.at(-1) ?? null) : null,
    results: finished ? s.results : [],
    myPrepared:
      s.stage === "lobby"
        ? s.prepared.filter((q) => q.authorId === id || (!!hostOwner && q.authorId === hostOwner))
        : [],
    preparedCount: s.prepared.length,
  };
}
