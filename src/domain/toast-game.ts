export type ToastMode = "basic" | "target";
export type ToastSettings = { mode: ToastMode; rounds: number; answerSeconds: number };
export type ToastResult = {
  turn: number;
  round: number;
  questionerId: string;
  question: string | null;
  expected: number | null;
  actual: number | null;
  automaticPasses: number;
  points: number;
  outcome: "matched" | "missed" | "no-prediction" | "skipped";
};
export type ToastState = {
  settings: ToastSettings;
  stage: "lobby" | "asking" | "answering" | "review" | "result" | "aborted";
  turn: number;
  roster: { id: string; nickname: string; score: number }[];
  question: string | null;
  target: number | null;
  endsAt: number | null;
  suggestions: string[];
  deck: number[];
  responses: Record<string, { cheers: boolean; prediction: number | null }>;
  history: ToastResult[];
  lastWords: Record<string, { targetId: string; turn: number }>;
};
export type ToastView = {
  settings: ToastSettings;
  stage: ToastState["stage"];
  turn: number;
  round: number;
  totalTurns: number;
  questionerId: string | null;
  question: string | null;
  target: number | null;
  endsAt: number | null;
  serverNow: number;
  suggestions: string[];
  submittedCount: number;
  mySubmitted: boolean;
  myAnswer: { cheers: boolean; prediction: number | null } | null;
  roster: { id: string; nickname: string; score: number; rank: number }[];
  history: ToastResult[];
  winners: string[];
  lastWords: { fromId: string; targetId: string; turn: number; question: string }[];
};
/** What each mode asks of players, in the order they will do it. */
export const TOAST_MODE_INFO = {
  basic: {
    title: "인원 맞히기",
    emoji: "🥂",
    badge: "기본 · 처음이라면 추천",
    description: "질문자가 질문을 내고, 나를 포함해 몇 명이 건배할지 예상해요.",
    rules: "예상 인원이 딱 맞으면 질문자 +1점",
    steps: [
      {
        title: "질문 고르기",
        detail: "질문자 차례가 되면 추천 질문을 누르거나 직접 써요. 예: ‘나는 아침형 인간이다’",
        action: "추천 질문 누르기 또는 직접 쓰기",
      },
      {
        title: "건배 또는 패스",
        detail: "모두 몰래 골라요. 나도 그렇다면 건배, 아니면 패스. 질문자는 건배 인원도 예상해요.",
        action: "건배·패스 고르고 제출",
      },
      {
        title: "인원 공개",
        detail: "건배한 사람 수만 공개돼요. 누가 건배했는지는 끝까지 비밀이에요.",
        action: "결과 보고 이야기 나누기",
      },
    ],
  },
  target: {
    title: "목표 인원 맞추기",
    emoji: "🎯",
    badge: "심화 · 눈치 고수용",
    description: "질문자에게 비밀 목표 인원이 주어져요. 딱 그만큼 건배할 질문을 만들어요.",
    rules: "건배 인원이 목표와 같으면 질문자 +1점",
    steps: [
      {
        title: "목표 확인 · 질문 만들기",
        detail:
          "질문자에게만 ‘건배 3명’ 같은 목표가 보여요. 딱 그만큼 건배할 것 같은 질문을 만들어요.",
        action: "목표 보고 질문 쓰기",
      },
      {
        title: "건배 또는 패스",
        detail: "모두 몰래 골라요. 나도 그렇다면 건배, 아니면 패스. 질문자도 함께 골라요.",
        action: "건배·패스 고르고 제출",
      },
      {
        title: "인원 공개",
        detail: "건배 인원과 목표가 함께 공개돼요. 누가 건배했는지는 끝까지 비밀이에요.",
        action: "결과 보고 이야기 나누기",
      },
    ],
  },
} as const satisfies Record<
  ToastMode,
  {
    title: string;
    emoji: string;
    badge: string;
    description: string;
    rules: string;
    steps: readonly { title: string; detail: string; action: string }[];
  }
>;
export const TOAST_MODES = ["basic", "target"] as const satisfies readonly ToastMode[];
export const TOAST_SECONDS = [15, 30, 60, 90] as const;
