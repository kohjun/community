import { randomInt } from "node:crypto";
import type { ToastState, ToastSettings, ToastView } from "../domain/toast-game";
import { TOAST_QUESTIONS } from "./toast-questions";
import { AppError } from "./errors";
const conflict = (message: string): never => {
  throw new AppError("CONFLICT", message);
};
export function newToast(settings: ToastSettings): ToastState {
  return {
    settings: { ...settings },
    stage: "lobby",
    turn: 0,
    roster: [],
    question: null,
    target: null,
    endsAt: null,
    suggestions: [],
    deck: [],
    responses: {},
    history: [],
    lastWords: {},
  };
}
const questioner = (s: ToastState) => s.roster[(s.turn - 1) % s.roster.length]!;
function begin(s: ToastState) {
  s.stage = "asking";
  s.question = null;
  s.endsAt = null;
  s.responses = {};
  s.target = s.settings.mode === "target" ? randomInt(s.roster.length + 1) : null;
  s.suggestions = [];
  while (s.suggestions.length < 3) {
    if (!s.deck.length) {
      s.deck = TOAST_QUESTIONS.map((_, i) => i);
      for (let i = s.deck.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [s.deck[i], s.deck[j]] = [s.deck[j]!, s.deck[i]!];
      }
    }
    const text = TOAST_QUESTIONS[s.deck.pop()!]!;
    if (!s.suggestions.includes(text)) s.suggestions.push(text);
  }
}
export function startToast(s: ToastState, roster: { id: string; nickname: string }[]) {
  if (
    s.stage !== "lobby" ||
    roster.length < 3 ||
    roster.length > 30 ||
    new Set(roster.map((p) => p.id)).size !== roster.length
  )
    conflict("3명 이상 모두 준비한 뒤 시작해주세요.");
  s.roster = roster.map((p) => ({ ...p, score: 0 }));
  s.turn = 1;
  s.history = [];
  s.lastWords = {};
  begin(s);
}
function activeTurn(s: ToastState, turn: number, stage: "asking" | "answering") {
  if (s.stage !== stage || s.turn !== turn)
    conflict("이미 진행된 차례예요. 최신 화면에서 다시 확인해주세요.");
}
export function askToast(s: ToastState, id: string, turn: number, question: string, now: number) {
  activeTurn(s, turn, "asking");
  if (questioner(s).id !== id)
    throw new AppError("FORBIDDEN", "이번 질문자만 질문을 공개할 수 있어요.");
  s.question = question;
  s.suggestions = [];
  s.stage = "answering";
  s.endsAt = now + s.settings.answerSeconds * 1000;
}
function settle(s: ToastState) {
  if (s.stage !== "answering" || s.history.some((h) => h.turn === s.turn))
    conflict("이미 집계한 차례예요.");
  const q = questioner(s),
    answer = s.responses[q.id];
  const expected = s.settings.mode === "target" ? s.target : (answer?.prediction ?? null);
  const actual = s.roster.filter((p) => s.responses[p.id]?.cheers === true).length;
  const points = expected !== null && expected === actual ? 1 : 0;
  q.score += points;
  s.history.push({
    turn: s.turn,
    round: Math.ceil(s.turn / s.roster.length),
    questionerId: q.id,
    question: s.question,
    expected,
    actual,
    automaticPasses: s.roster.length - Object.keys(s.responses).length,
    points,
    outcome: expected === null ? "no-prediction" : points ? "matched" : "missed",
  });
  // Keep aggregates only, including after game end. There is no last-word answer-reveal API.
  s.responses = {};
  s.suggestions = [];
  s.endsAt = null;
  s.target = null;
  s.stage = s.turn >= s.settings.rounds * s.roster.length ? "result" : "review";
}
export function answerToast(
  s: ToastState,
  id: string,
  turn: number,
  cheers: boolean,
  prediction: number | undefined,
  now: number,
) {
  activeTurn(s, turn, "answering");
  if (s.endsAt === null || now >= s.endsAt) conflict("선택 시간이 끝났어요.");
  if (!s.roster.some((p) => p.id === id))
    throw new AppError("FORBIDDEN", "이번 게임의 참가자만 선택할 수 있어요.");
  if (s.responses[id]) conflict("이미 제출했어요. 제출한 선택은 바꿀 수 없어요.");
  const needsPrediction = s.settings.mode === "basic" && questioner(s).id === id;
  if (needsPrediction) {
    if (!Number.isInteger(prediction) || prediction! < 0 || prediction! > s.roster.length)
      conflict("자신을 포함한 예상 건배 인원을 골라주세요.");
  } else if (prediction !== undefined) conflict("이번 선택에는 예상 인원을 제출하지 않아요.");
  s.responses[id] = { cheers, prediction: needsPrediction ? prediction! : null };
  if (Object.keys(s.responses).length === s.roster.length) settle(s);
}
export function tickToast(s: ToastState, now: number) {
  if (s.stage !== "answering" || s.endsAt === null || now < s.endsAt) return false;
  settle(s);
  return true;
}
export function nextToast(s: ToastState, turn: number) {
  if (s.stage !== "review" || s.turn !== turn)
    conflict("결과를 확인한 뒤 다음 질문으로 넘어가주세요.");
  s.turn++;
  begin(s);
}
export function skipToast(s: ToastState, turn: number) {
  activeTurn(s, turn, "asking");
  s.history.push({
    turn: s.turn,
    round: Math.ceil(s.turn / s.roster.length),
    questionerId: questioner(s).id,
    question: null,
    expected: null,
    actual: null,
    automaticPasses: 0,
    points: 0,
    outcome: "skipped",
  });
  s.responses = {};
  s.suggestions = [];
  s.target = null;
  s.endsAt = null;
  s.stage = s.turn >= s.settings.rounds * s.roster.length ? "result" : "review";
}
export function abortToast(s: ToastState) {
  s.stage = "aborted";
  s.responses = {};
  s.suggestions = [];
  s.target = null;
  s.endsAt = null;
  s.question = null;
}
function winners(s: ToastState) {
  if (s.stage !== "result") return [];
  const best = Math.max(...s.roster.map((p) => p.score));
  return s.roster.filter((p) => p.score === best).map((p) => p.id);
}
export function lastWordToast(s: ToastState, id: string, targetId: string, turn: number) {
  if (s.stage !== "result" || !winners(s).includes(id))
    throw new AppError("FORBIDDEN", "게임이 끝난 뒤 1등만 마지막 한마디를 보낼 수 있어요.");
  if (s.lastWords[id]) conflict("이미 마지막 한마디를 보냈어요.");
  if (
    targetId === id ||
    !s.roster.some((p) => p.id === targetId) ||
    !s.history.some((h) => h.turn === turn && h.question !== null)
  )
    conflict("함께한 참가자와 공개했던 질문을 골라주세요.");
  s.lastWords[id] = { targetId, turn };
}
export function toastView(s: ToastState, id: string | null, now: number): ToastView {
  const isQuestioner = s.roster.length > 0 && questioner(s).id === id;
  const own = id && s.stage === "answering" ? s.responses[id] : null;
  const roster = s.roster
    .map((p) => ({ ...p, rank: 1 + s.roster.filter((other) => other.score > p.score).length }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        s.roster.findIndex((p) => p.id === a.id) - s.roster.findIndex((p) => p.id === b.id),
    );
  return {
    settings: { ...s.settings },
    stage: s.stage,
    turn: s.turn,
    round: s.turn ? Math.ceil(s.turn / s.roster.length) : 0,
    totalTurns: s.settings.rounds * s.roster.length,
    questionerId: s.roster.length ? questioner(s).id : null,
    question: s.question,
    target: isQuestioner && ["asking", "answering"].includes(s.stage) ? s.target : null,
    endsAt: s.endsAt,
    serverNow: now,
    suggestions: isQuestioner && s.stage === "asking" ? [...s.suggestions] : [],
    submittedCount: Object.keys(s.responses).length,
    mySubmitted: !!own,
    myAnswer: own ? { ...own } : null,
    roster,
    history: s.history.map((h) => ({ ...h })),
    winners: winners(s),
    lastWords: Object.entries(s.lastWords).map(([fromId, v]) => ({
      fromId,
      ...v,
      question: s.history.find((h) => h.turn === v.turn)!.question!,
    })),
  };
}
