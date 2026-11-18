export const TEMPERATURE_MODES = ["basic", "deduction"] as const;
export const TEMPERATURE_SECONDS = [30, 60, 90] as const;

export type TemperatureMode = (typeof TEMPERATURE_MODES)[number];
export type TemperatureSettings = {
  mode: TemperatureMode;
  rounds: number;
  answerSeconds: (typeof TEMPERATURE_SECONDS)[number];
};

export const DEFAULT_TEMPERATURE_SETTINGS: TemperatureSettings = {
  mode: "basic",
  rounds: 2,
  answerSeconds: 60,
};
export const TEMPERATURE_MODE_LABELS = {
  basic: "기본 · 숫자 맞히기",
  deduction: "추리 · 순서 맞히기",
} as const;
export const TEMPERATURE_CLUE_SECONDS = 30;

export type TemperatureTopic = { question: string; low: string; high: string };
export type TemperaturePlayer = { id: string; nickname: string; score: number };
export type TemperatureSituation = { text: string; value: number };
export type TemperatureStage =
  "lobby" | "clue" | "guess" | "situations" | "ordering" | "review" | "result" | "aborted";

type BasicResult = {
  mode: "basic";
  answer: number | null;
  skipped: boolean;
  guesses: { id: string; value: number; distance: number; points: number }[];
};
type DeductionResult = {
  mode: "deduction";
  situations: (TemperatureSituation & { id: string })[];
  comparablePairs: number;
  orders: { id: string; order: string[]; correctPairs: number; points: number }[];
};

export type TemperatureResult = BasicResult | DeductionResult;
export type TemperatureState = {
  settings: TemperatureSettings;
  stage: TemperatureStage;
  runId: string | null;
  turn: number;
  roster: TemperaturePlayer[];
  topicDeck: number[];
  endsAt: number | null;
  secret: number | null;
  guesses: Record<string, number>;
  situations: Record<string, TemperatureSituation>;
  publicOrder: string[];
  orders: Record<string, string[]>;
  result: TemperatureResult | null;
};

export type TemperatureView = {
  settings: TemperatureSettings;
  stage: TemperatureStage;
  runId: string | null;
  turn: number;
  totalTurns: number;
  round: number;
  roster: TemperaturePlayer[];
  topic: TemperatureTopic | null;
  endsAt: number | null;
  serverNow: number;
  clueId: string | null;
  mySecret: number | null;
  myGuess: number | null;
  mySituation: TemperatureSituation | null;
  myOrder: string[] | null;
  situations: { id: string; text: string }[];
  submitted: number;
  expected: number;
  result: TemperatureResult | null;
};

export function temperatureSettingsFrom(config: {
  temperatureMode: TemperatureMode;
  temperatureRounds: number;
  temperatureAnswerSeconds: TemperatureSettings["answerSeconds"];
}): TemperatureSettings {
  return {
    mode: config.temperatureMode,
    rounds: config.temperatureRounds,
    answerSeconds: config.temperatureAnswerSeconds,
  };
}
