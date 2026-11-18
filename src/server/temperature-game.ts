import { randomInt, randomUUID } from "node:crypto";
import {
  TEMPERATURE_CLUE_SECONDS,
  type TemperatureSettings,
  type TemperatureState,
  type TemperatureTopic,
  type TemperatureView,
} from "../domain/temperature-game";
import { AppError } from "./errors";

const topics: readonly TemperatureTopic[] = [
  { question: "얼마나 당황스러운 상황인가요?", low: "전혀 당황하지 않음", high: "매우 당황함" },
  { question: "혼자 하기 편한 활동인가요?", low: "혼자 하기 어려움", high: "혼자 해도 아주 편함" },
  {
    question: "얼마나 즉흥적인 여행인가요?",
    low: "모든 일정이 정해짐",
    high: "아무 계획 없이 떠남",
  },
  {
    question: "주말에 얼마나 에너지가 필요한가요?",
    low: "쉬기만 하면 됨",
    high: "매우 활발하게 움직임",
  },
  { question: "얼마나 도전적인 음식인가요?", low: "아주 익숙함", high: "선뜻 먹기 어려움" },
  { question: "얼마나 어려운 예능 미션인가요?", low: "아주 쉬움", high: "매우 어려움" },
  {
    question: "모임에서 얼마나 먼저 나서는 행동인가요?",
    low: "조용히 참여",
    high: "가장 먼저 나섬",
  },
  {
    question: "얼마나 오래 기다릴 수 있나요?",
    low: "거의 기다릴 수 없음",
    high: "오래 기다려도 괜찮음",
  },
];

function shuffle<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [shuffled[index], shuffled[other]] = [shuffled[other]!, shuffled[index]!];
  }
  return shuffled;
}

function topicDeck(count: number) {
  const deck: number[] = [];
  const indexes = topics.map((_, index) => index);
  while (deck.length < count) {
    const batch = shuffle(indexes);
    if (deck.at(-1) === batch[0]) {
      [batch[0], batch[1]] = [batch[1]!, batch[0]!];
    }
    deck.push(...batch);
  }
  return deck.slice(0, count);
}

const totalTurns = (state: TemperatureState) =>
  state.settings.rounds * (state.settings.mode === "basic" ? state.roster.length : 1);
const clueId = (state: TemperatureState) =>
  state.settings.mode === "basic" && state.turn > 0
    ? (state.roster[(state.turn - 1) % state.roster.length]?.id ?? null)
    : null;

export function newTemperature(settings: TemperatureSettings): TemperatureState {
  return {
    settings,
    stage: "lobby",
    runId: null,
    turn: 0,
    roster: [],
    topicDeck: [],
    endsAt: null,
    secret: null,
    guesses: {},
    situations: {},
    publicOrder: [],
    orders: {},
    result: null,
  };
}

function clearSubmissions(state: TemperatureState) {
  state.secret = null;
  state.guesses = {};
  state.situations = {};
  state.publicOrder = [];
  state.orders = {};
}

function beginTurn(state: TemperatureState, now: number) {
  clearSubmissions(state);
  state.result = null;
  state.turn++;
  if (state.settings.mode === "basic") {
    state.stage = "clue";
    state.secret = randomInt(101);
    state.endsAt = now + TEMPERATURE_CLUE_SECONDS * 1000;
  } else {
    state.stage = "situations";
    state.endsAt = now + state.settings.answerSeconds * 1000;
  }
}

export function startTemperature(
  state: TemperatureState,
  participants: { id: string; nickname: string }[],
  now: number,
) {
  state.roster = participants.map((player) => ({ ...player, score: 0 }));
  state.runId = randomUUID();
  state.topicDeck = topicDeck(totalTurns(state));
  beginTurn(state, now);
}

export function openTemperatureGuess(state: TemperatureState, turn: number, now: number) {
  requireStage(state, turn, "clue");
  state.stage = "guess";
  state.endsAt = now + state.settings.answerSeconds * 1000;
}

function requireStage(state: TemperatureState, turn: number, stage: TemperatureState["stage"]) {
  if (state.turn !== turn || state.stage !== stage)
    throw new AppError("CONFLICT", "이미 단계가 바뀌었어요. 현재 화면을 확인해주세요.");
}

function requirePlayer(state: TemperatureState, id: string, runId: string) {
  if (state.runId !== runId) throw new AppError("CONFLICT", "새 게임이 시작됐어요.");
  if (!state.roster.some((player) => player.id === id))
    throw new AppError("FORBIDDEN", "이 게임을 함께 시작한 참가자만 제출할 수 있어요.");
}

function review(state: TemperatureState) {
  clearSubmissions(state);
  state.stage = "review";
  state.endsAt = null;
}

function settleGuess(state: TemperatureState) {
  const answer = state.secret!;
  const entries = Object.entries(state.guesses).map(([id, value]) => ({
    id,
    value,
    distance: Math.abs(value - answer),
  }));
  const best = Math.min(...entries.map((entry) => entry.distance));
  const guesses = entries.map((entry) => ({ ...entry, points: Number(entry.distance === best) }));
  for (const entry of guesses) {
    state.roster.find((player) => player.id === entry.id)!.score += entry.points;
  }
  state.result = { mode: "basic", answer, skipped: false, guesses };
  review(state);
}

export function guessTemperature(
  state: TemperatureState,
  id: string,
  runId: string,
  turn: number,
  value: number,
) {
  requirePlayer(state, id, runId);
  requireStage(state, turn, "guess");
  if (clueId(state) === id)
    throw new AppError("FORBIDDEN", "힌트 제공자는 추리에 참여하지 않아요.");
  if (state.guesses[id] !== undefined) throw new AppError("CONFLICT", "이미 숫자를 제출했어요.");
  state.guesses[id] = value;
  if (Object.keys(state.guesses).length === state.roster.length - 1) settleGuess(state);
}

function settleOrder(state: TemperatureState) {
  const situations = state.publicOrder
    .map((id) => ({ id, ...state.situations[id]! }))
    .sort((a, b) => a.value - b.value);
  const pairs: [string, string][] = [];
  for (const [index, low] of situations.entries()) {
    for (const high of situations.slice(index + 1)) {
      if (low.value !== high.value) pairs.push([low.id, high.id]);
    }
  }
  const entries = Object.entries(state.orders).map(([id, order]) => {
    const positions = new Map(order.map((item, index) => [item, index]));
    const correctPairs = pairs.filter(
      ([low, high]) => positions.get(low)! < positions.get(high)!,
    ).length;
    return { id, order, correctPairs };
  });
  const best = Math.max(...entries.map((entry) => entry.correctPairs));
  const orders = entries.map((entry) => ({
    ...entry,
    points: Number(pairs.length > 0 && entry.correctPairs === best),
  }));
  for (const entry of orders) {
    state.roster.find((player) => player.id === entry.id)!.score += entry.points;
  }
  state.result = { mode: "deduction", situations, comparablePairs: pairs.length, orders };
  review(state);
}

function openOrder(state: TemperatureState, now: number) {
  state.publicOrder = shuffle(Object.keys(state.situations));
  if (new Set(Object.values(state.situations).map((item) => item.value)).size < 2) {
    settleOrder(state);
    return;
  }
  state.stage = "ordering";
  state.endsAt = now + state.settings.answerSeconds * 1000;
}

export function submitTemperatureSituation(
  state: TemperatureState,
  id: string,
  runId: string,
  turn: number,
  text: string,
  value: number,
  now: number,
) {
  requirePlayer(state, id, runId);
  requireStage(state, turn, "situations");
  if (state.situations[id]) throw new AppError("CONFLICT", "이미 상황을 제출했어요.");
  state.situations[id] = { text, value };
  if (Object.keys(state.situations).length === state.roster.length) openOrder(state, now);
}

export function submitTemperatureOrder(
  state: TemperatureState,
  id: string,
  runId: string,
  turn: number,
  order: string[],
) {
  requirePlayer(state, id, runId);
  requireStage(state, turn, "ordering");
  if (!state.situations[id])
    throw new AppError("FORBIDDEN", "상황을 제출한 참가자만 순서를 맞힐 수 있어요.");
  if (state.orders[id]) throw new AppError("CONFLICT", "이미 순서를 제출했어요.");
  const unique = new Set(order);
  if (
    order.length !== state.publicOrder.length ||
    unique.size !== order.length ||
    state.publicOrder.some((item) => !unique.has(item))
  )
    throw new AppError("VALIDATION", "모든 상황을 빠짐없이 한 번씩 배치해주세요.");
  state.orders[id] = order;
  if (Object.keys(state.orders).length === state.publicOrder.length) settleOrder(state);
}

export function tickTemperature(state: TemperatureState, now: number) {
  if (state.endsAt === null || now < state.endsAt) return false;
  if (state.stage === "clue") openTemperatureGuess(state, state.turn, now);
  else if (state.stage === "guess") settleGuess(state);
  else if (state.stage === "situations") openOrder(state, now);
  else if (state.stage === "ordering") settleOrder(state);
  else return false;
  return true;
}

export function nextTemperature(state: TemperatureState, turn: number, now: number) {
  requireStage(state, turn, "review");
  if (state.turn === totalTurns(state)) state.stage = "result";
  else beginTurn(state, now);
}

export function skipTemperature(state: TemperatureState, turn: number) {
  requireStage(state, turn, "clue");
  state.result = { mode: "basic", answer: null, skipped: true, guesses: [] };
  review(state);
}

export function abortTemperature(state: TemperatureState) {
  clearSubmissions(state);
  state.stage = "aborted";
  state.endsAt = null;
}

export function temperatureView(
  state: TemperatureState,
  id: string | null,
  now: number,
): TemperatureView {
  const clue = clueId(state);
  const ordering = state.stage === "ordering";
  const guessing = state.stage === "guess";
  const writing = state.stage === "situations";
  return {
    settings: state.settings,
    stage: state.stage,
    runId: state.runId,
    turn: state.turn,
    totalTurns: totalTurns(state),
    round:
      state.settings.mode === "basic" && state.roster.length
        ? Math.ceil(state.turn / state.roster.length)
        : state.turn,
    roster: state.roster,
    topic: topics[state.topicDeck[state.turn - 1] ?? -1] ?? null,
    endsAt: state.endsAt,
    serverNow: now,
    clueId: clue,
    mySecret: id && id === clue ? state.secret : null,
    myGuess: id ? (state.guesses[id] ?? null) : null,
    mySituation: id ? (state.situations[id] ?? null) : null,
    myOrder: id ? (state.orders[id] ?? null) : null,
    situations: ordering
      ? state.publicOrder.map((item) => ({ id: item, text: state.situations[item]!.text }))
      : [],
    submitted: guessing
      ? Object.keys(state.guesses).length
      : writing
        ? Object.keys(state.situations).length
        : Object.keys(state.orders).length,
    expected: guessing
      ? state.roster.length - 1
      : writing
        ? state.roster.length
        : state.publicOrder.length,
    result: state.result,
  };
}
