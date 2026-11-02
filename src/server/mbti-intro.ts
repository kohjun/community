import type { IntroState, IntroView } from "../domain/mbti-intro";
import type { Mbti } from "../domain/mbti-game";
import { AppError } from "./errors";
const conflict = (text: string): never => {
  throw new AppError("CONFLICT", text);
};
export function newIntro(maxRounds: number): IntroState {
  return {
    maxRounds,
    stage: "lobby",
    round: 0,
    turn: 0,
    turnStartedAt: null,
    registered: {},
    roster: [],
    attempts: {},
    winner: null,
  };
}
export function startIntro(
  s: IntroState,
  players: { id: string; nickname: string }[],
  now: number,
) {
  if (players.length < 3 || players.some((p) => !Object.hasOwn(s.registered, p.id)))
    conflict("참가자 모두 닉네임과 MBTI를 저장하고 준비해주세요.");
  s.roster = players.map((p) => ({ ...p, mbti: s.registered[p.id]! }));
  s.round = 1;
  s.attempts = {};
  s.winner = null;
  s.stage = "acting";
  s.turn = 0;
  s.turnStartedAt = now;
}
export function endIntroRound(s: IntroState) {
  if (s.stage !== "guessing") conflict("현재 추리 라운드가 아니에요.");
  s.stage = s.round >= s.maxRounds ? "result" : "review";
}
export function nextIntroRound(s: IntroState, now: number) {
  if (s.stage !== "review" || s.round >= s.maxRounds)
    conflict("라운드 결과를 확인한 뒤 다음 라운드를 열어주세요.");
  s.round++;
  s.stage = "acting";
  s.turn = 0;
  s.turnStartedAt = now;
}
export function submitIntro(
  s: IntroState,
  id: string,
  round: number,
  guesses: { playerId: string; mbti: Mbti }[],
) {
  if (s.stage !== "guessing" || s.round !== round) conflict("현재 라운드에서 제출해주세요.");
  if (!s.roster.some((p) => p.id === id))
    throw new AppError("FORBIDDEN", "이번 게임 참가자만 추리할 수 있어요.");
  const history = s.attempts[id] ?? [];
  if (history.some((a) => a.round === round)) conflict("이번 라운드는 이미 제출했어요.");
  const others = s.roster.filter((p) => p.id !== id),
    byId = new Map(guesses.map((g) => [g.playerId, g.mbti]));
  if (
    guesses.length !== others.length ||
    byId.size !== guesses.length ||
    others.some((p) => !byId.has(p.id))
  )
    throw new AppError("VALIDATION", "자신을 제외한 모든 참가자의 MBTI를 한 번씩 선택해주세요.");
  const canonical = others.map((p) => byId.get(p.id)!);
  const correct = others.filter((p, i) => p.mbti === canonical[i]).length;
  s.attempts[id] = [
    ...history,
    { round, guesses: canonical, correct, incorrect: others.length - correct },
  ];
  if (correct === others.length) {
    s.winner = id;
    s.stage = "result";
  } else if (s.roster.every((p) => s.attempts[p.id]?.some((a) => a.round === round)))
    endIntroRound(s);
}
export function introView(s: IntroState, id: string | null, now: number): IntroView {
  return {
    maxRounds: s.maxRounds,
    stage: s.stage,
    round: s.round,
    turn: s.turn,
    speakerId: s.stage === "acting" ? (s.roster[s.turn]?.id ?? null) : null,
    turnStartedAt: s.turnStartedAt,
    serverNow: now,
    myMbti: id ? (s.registered[id] ?? null) : null,
    roster: s.roster.map(({ id, nickname }) => ({ id, nickname })),
    submittedCount: s.roster.filter((p) => s.attempts[p.id]?.some((a) => a.round === s.round))
      .length,
    hasSubmitted: !!id && !!s.attempts[id]?.some((a) => a.round === s.round),
    history: id ? (s.attempts[id] ?? []).map((a) => ({ ...a, guesses: [...a.guesses] })) : [],
    winner: s.winner,
    answers: s.stage === "result" ? s.roster.map((p) => ({ ...p })) : null,
  };
}

export function advanceIntro(
  s: IntroState,
  id: string | null,
  round: number,
  turn: number,
  now: number,
) {
  if (s.stage !== "acting" || s.round !== round || s.turn !== turn)
    conflict("현재 발언 차례에서 완료해주세요.");
  if (id !== null && s.roster[s.turn]?.id !== id)
    throw new AppError("FORBIDDEN", "자신의 설명 차례에만 완료할 수 있어요.");
  s.turn++;
  s.turnStartedAt = now;
  if (s.turn >= s.roster.length) {
    s.stage = "guessing";
    s.turnStartedAt = null;
  }
}
