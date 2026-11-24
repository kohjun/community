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
  basic: "숫자 맞히기",
  deduction: "순서 맞히기",
} as const;
/** What each mode asks of players, in the order they will do it. */
export const TEMPERATURE_MODE_INFO = {
  basic: {
    title: "숫자 맞히기",
    emoji: "🌡️",
    badge: "기본 · 처음이라면 추천",
    description: "한 명이 비밀 숫자에 맞는 상황을 말로 설명하면, 나머지가 그 숫자를 맞혀요.",
    rules: "비밀 숫자에 가장 가까운 사람이 1점",
    steps: [
      {
        title: "비밀 숫자 받기",
        detail:
          "차례가 된 한 명에게만 0~100 사이 숫자가 보여요. 주제의 0과 100이 무슨 뜻인지 함께 확인해요.",
        action: "주제와 0·100 기준 읽기",
      },
      {
        title: "말로 설명하기",
        detail:
          "설명하는 사람은 30초 동안 그 숫자에 어울리는 상황을 말해요. 숫자 자체는 말하면 안 돼요.",
        action: "설명을 잘 듣기",
      },
      {
        title: "숫자 맞히기",
        detail: "나머지는 몇일지 슬라이더로 골라 제출해요. 가장 가까운 사람이 1점!",
        action: "슬라이더로 숫자 고르고 제출",
      },
    ],
  },
  deduction: {
    title: "순서 맞히기",
    emoji: "🔢",
    badge: "추리 · 3명 이상 추천",
    description: "모두 상황 하나와 숫자를 몰래 정하고, 다 같이 낮은 순서대로 줄 세워요.",
    rules: "실제 순서와 가장 비슷한 사람이 1점",
    steps: [
      {
        title: "상황과 숫자 정하기",
        detail: "주제에 맞는 상황을 짧게 쓰고, 그 상황이 0~100 중 몇인지 몰래 정해요.",
        action: "상황 쓰고 숫자 고르기",
      },
      {
        title: "낮은 순서로 줄 세우기",
        detail: "모두의 상황이 공개되면 숫자가 낮을 것 같은 순서대로 카드를 옮겨요.",
        action: "카드를 끌거나 ↑↓ 버튼으로 옮기기",
      },
      {
        title: "정답 순서 확인",
        detail: "실제 숫자가 공개돼요. 왜 그렇게 느꼈는지 서로 이야기해봐요.",
        action: "결과 보며 이야기하기",
      },
    ],
  },
} as const satisfies Record<
  TemperatureMode,
  {
    title: string;
    emoji: string;
    badge: string;
    description: string;
    rules: string;
    steps: readonly { title: string; detail: string; action: string }[];
  }
>;
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
