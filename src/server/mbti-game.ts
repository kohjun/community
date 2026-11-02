import { WORD_BANKS } from "./word-bank";
import {
  WORD_HINTS,
  normalizeWordGuess,
  type WordCategory,
  type WordMode,
} from "../domain/word-liar";
import { randomInt } from "node:crypto";
import { MBTI_TYPES, MBTI_SITUATIONS, type MbtiState, type MbtiView } from "../domain/mbti-game";
import { AppError } from "./errors";
const conflict = (text: string): never => {
  throw new AppError("CONFLICT", text);
};
export function newMbti(revealLiar: boolean): MbtiState {
  return {
    revealLiar,
    stage: "lobby",
    common: null,
    odd: null,
    liar: null,
    roster: [],
    deck: [],
    cycle: 0,
    turn: 0,
    endsAt: null,
    votes: {},
    tally: null,
    guess: null,
    winner: null,
  };
}
export function startMbti(s: MbtiState, roster: MbtiState["roster"], now: number) {
  if (roster.length < 3) conflict("MBTI 위장 게임은 최소 3명이 필요해요.");
  Object.assign(s, newMbti(s.revealLiar));
  s.roster = roster;
  const bank = s.words ? WORD_BANKS[s.words.category] : MBTI_TYPES;
  const common = randomInt(bank.length);
  s.common = bank[common]!;
  s.odd =
    s.words?.mode === "classic"
      ? "라이어"
      : bank[(common + 1 + randomInt(bank.length - 1)) % bank.length]!;
  s.liar = roster[randomInt(roster.length)]!.id;
  s.deck = MBTI_SITUATIONS.map((_, i) => i);
  for (let i = s.deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [s.deck[i], s.deck[j]] = [s.deck[j]!, s.deck[i]!];
  }
  nextMbti(s, now);
}
export function nextMbti(s: MbtiState, now: number) {
  if (s.stage !== "lobby" && s.stage !== "tally")
    conflict("투표 결과를 확인한 뒤 다음 상황을 시작해주세요.");
  if (s.tally?.outcome === "liar") conflict("라이어의 마지막 추리를 기다려주세요.");
  s.cycle++;
  s.turn = 0;
  s.stage = "acting";
  s.endsAt = now + 30_000;
  s.votes = {};
  s.tally = null;
}
export function tickMbti(s: MbtiState, now: number) {
  if (s.stage !== "acting" || s.endsAt === null || now < s.endsAt) return false;
  s.turn++;
  s.endsAt = now + 30_000;
  if (s.turn >= s.roster.length) {
    s.stage = "voting";
    s.endsAt = null;
  }
  return true;
}
export function tallyMbti(s: MbtiState) {
  if (s.stage !== "voting") conflict("투표 중에만 집계할 수 있어요.");
  const counts = new Map<string, number>();
  for (const vote of Object.values(s.votes))
    if (vote) counts.set(vote, (counts.get(vote) ?? 0) + 1);
  const selected = [...counts].find(([, n]) => n > s.roster.length / 2);
  s.tally = {
    suspect: selected?.[0] ?? null,
    count: selected?.[1] ?? 0,
    outcome: !selected ? "no-majority" : selected[0] === s.liar ? "liar" : "wrong",
  };
  s.stage = s.tally.outcome === "liar" ? "guess" : "tally";
  s.endsAt = null;
}
export function voteMbti(s: MbtiState, id: string, cycle: number, target: string | null) {
  if (s.stage !== "voting" || s.cycle !== cycle) conflict("현재 상황의 투표에서 선택해주세요.");
  if (!s.roster.some((p) => p.id === id))
    throw new AppError("FORBIDDEN", "이번 게임 참가자만 투표할 수 있어요.");
  if (target !== null && (!s.roster.some((p) => p.id === target) || target === id))
    conflict("다른 참가자를 선택하거나 기권해주세요.");
  if (Object.hasOwn(s.votes, id)) conflict("이미 투표했어요. 다음 집계를 기다려주세요.");
  s.votes[id] = target;
  if (Object.keys(s.votes).length === s.roster.length) tallyMbti(s);
}
export function guessMbti(s: MbtiState, id: string, cycle: number, guess: string) {
  if (s.stage !== "guess" || s.cycle !== cycle) conflict("마지막 추리 차례가 아니에요.");
  if (s.liar !== id) throw new AppError("FORBIDDEN", "라이어만 마지막 추리를 제출할 수 있어요.");
  s.guess = guess;
  s.winner = (
    s.words ? normalizeWordGuess(guess) === normalizeWordGuess(s.common!) : guess === s.common
  )
    ? "liar"
    : "players";
  s.stage = "result";
}
export function mbtiView(s: MbtiState, id: string | null, now: number): MbtiView {
  const member = s.roster.some((p) => p.id === id),
    revealed = s.stage === "guess" || s.stage === "result";
  return {
    ...(s.words ? { words: { ...s.words } } : {}),
    revealLiar: s.revealLiar,
    stage: s.stage,
    cycle: s.cycle,
    serverNow: now,
    scenario: s.cycle
      ? s.words
        ? WORD_HINTS[(s.cycle - 1) % WORD_HINTS.length]!
        : MBTI_SITUATIONS[s.deck[(s.cycle - 1) % s.deck.length]!]!
      : "",
    roster: s.roster.map((p) => ({ ...p })),
    speakerId: s.stage === "acting" ? (s.roster[s.turn]?.id ?? null) : null,
    endsAt: s.endsAt,
    assignment: member && s.common && s.odd ? (id === s.liar ? s.odd : s.common) : null,
    isLiar: member && (s.revealLiar || revealed) ? id === s.liar : null,
    voteCount: Object.keys(s.votes).length,
    hasVoted: !!id && Object.hasOwn(s.votes, id),
    myVote: id ? (s.votes[id] ?? null) : null,
    majority: Math.floor(s.roster.length / 2) + 1,
    tally: s.tally ? { ...s.tally } : null,
    liarId: revealed ? s.liar : null,
    canGuess: s.stage === "guess" && id === s.liar,
    result:
      s.stage === "result" && s.common && s.odd && s.guess && s.winner
        ? { common: s.common, odd: s.odd, guess: s.guess, winner: s.winner }
        : null,
  };
}

export function newWordGame(category: WordCategory, mode: WordMode): MbtiState {
  return { ...newMbti(mode !== "undercover"), words: { category, mode } };
}
