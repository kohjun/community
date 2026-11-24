import { z } from "zod";
import type { MapPoint } from "../lib/naver-maps";

/** One step of a 낙서톡 mode, used by the mode picker, the tutorial and the in-game step bar. */
export type DrawingModeStep = { title: string; detail: string; action: string };

const WRITE_STEP: DrawingModeStep = {
  title: "문장 쓰기",
  detail: "다른 사람이 그릴 재미있는 문장을 하나 써요. 예: 떡볶이를 먹는 펭귄",
  action: "입력 칸에 쓰고 ‘문장 넘기기’",
};
const DRAW_STEP: DrawingModeStep = {
  title: "그리기",
  detail: "내게 온 문장을 그림으로만 표현해요. 글자나 숫자는 쓰면 안 돼요.",
  action: "그림판에 그리고 ‘그림 완성’",
};
const READ_STEP: DrawingModeStep = {
  title: "그림 보고 쓰기",
  detail: "내게 온 그림만 보고, 무슨 장면인지 한 문장으로 써요.",
  action: "그림을 보고 쓴 뒤 ‘문장 넘기기’",
};

export const DRAWING_MODES = {
  mix: {
    title: "전달 + 맞히기",
    emoji: "🔀",
    minimum: 4,
    badge: "추천 · 4명부터",
    scoring: "점수 경쟁",
    description: "문장과 그림을 전달하다 바뀐 마지막 문장을, 마지막에 다 같이 맞혀요.",
    rules: "정답은 처음 문장이 아니라 전달하면서 바뀐 마지막 문장이에요.",
    steps: [
      WRITE_STEP,
      DRAW_STEP,
      READ_STEP,
      {
        title: "다 같이 맞히기",
        detail:
          "바뀐 마지막 문장을 한 명이 실시간으로 그리면 나머지가 맞혀요. 먼저 맞히면 2점, 그린 사람 1점!",
        action: "정답을 입력하고 ‘맞히기’",
      },
      {
        title: "결과 보기",
        detail: "처음 문장부터 마지막 그림까지, 어떻게 바뀌었는지 한 번에 공개해요.",
        action: "자동으로 넘어가요",
      },
    ],
  },
  live: {
    title: "그림 맞히기",
    emoji: "🎨",
    minimum: 2,
    badge: "가장 쉬워요 · 2명부터",
    scoring: "점수 경쟁",
    description: "한 명이 제시어를 그리면, 나머지가 먼저 맞히기 경쟁을 해요.",
    rules: "먼저 맞힌 사람 2점, 정답이 나오면 그린 사람도 1점이에요.",
    steps: [
      {
        title: "그리기",
        detail:
          "내 차례가 되면 화면에 나온 제시어를 그려요. 그리는 모습이 모두에게 실시간으로 보여요.",
        action: "제시어를 보고 그림판에 그리기",
      },
      {
        title: "맞히기",
        detail: "다른 사람이 그리는 동안 정답을 입력해요. 여러 번 입력해도 되고, 먼저 맞히면 2점!",
        action: "정답을 입력하고 ‘맞히기’",
      },
      {
        title: "정답 공개",
        detail:
          "누가 맞혔는지 보여주고 다음 사람 차례로 넘어가요. 모두 한 번씩 그리면 한 바퀴예요.",
        action: "자동으로 넘어가요",
      },
    ],
  },
  relay: {
    title: "그림 전달 놀이",
    emoji: "📜",
    minimum: 3,
    badge: "점수 없이 · 3명부터",
    scoring: "점수 없음 · 재미 투표",
    description: "문장과 그림을 번갈아 전달하며 이야기가 어떻게 바뀌는지 함께 봐요.",
    rules: "정답과 점수 없이 감상하고, 마지막에 가장 웃긴 이야기에 한 표를 줘요.",
    steps: [
      WRITE_STEP,
      DRAW_STEP,
      READ_STEP,
      {
        title: "다 같이 보기",
        detail: "각자의 이야기가 어떻게 바뀌었는지 하나씩 공개해요.",
        action: "화면을 함께 보며 이야기 나누기",
      },
      {
        title: "재미 투표",
        detail: "내 이야기를 뺀 나머지 중 가장 웃긴 이야기에 한 표를 줘요.",
        action: "마음에 드는 이야기의 ‘한 표’",
      },
    ],
  },
} as const satisfies Record<
  string,
  {
    title: string;
    emoji: string;
    minimum: number;
    badge: string;
    scoring: string;
    description: string;
    rules: string;
    steps: readonly DrawingModeStep[];
  }
>;
/** Easiest first, so a new host sees the simplest option at the top. */
export const DRAWING_MODE_ORDER = ["live", "mix", "relay"] as const;

/** Upper-bound play time; phases end early once everyone submits, so real games are shorter. */
export function drawingPlayMinutes(
  mode: keyof typeof DRAWING_MODES,
  players: number,
  seconds: number,
  sets: number,
) {
  const n = Math.max(DRAWING_MODES[mode].minimum, players);
  const perSet =
    mode === "live"
      ? n * (seconds + 10 + 15)
      : mode === "mix"
        ? 30 + seconds + 30 + n * (seconds + 10 + 15)
        : 30 + seconds + 30 + n * 15 + 30;
  return Math.ceil((perSet * sets) / 60);
}
/** One step of a 단서각 mode, shared by the mode picker, tutorial and game screen. */
export type ClueModeStep = { title: string; detail: string; action: string };
export const CLUE_MODES = {
  photo: {
    title: "거리뷰 위치 찾기",
    emoji: "📍",
    badge: "기본 · 지도에 핀",
    description: "실제 거리뷰를 둘러보고, 어디인지 지도에 핀을 꽂아요.",
    rules: "정답에 가장 가까이 꽂은 사람이 1점이에요. 제출한 핀은 바꿀 수 없어요.",
    steps: [
      {
        title: "거리뷰 둘러보기",
        detail: "실제 거리 사진이에요. 손가락으로 끌어 주변을 둘러보며 단서를 찾아요.",
        action: "거리뷰를 좌우로 끌어보기",
      },
      {
        title: "지도에 핀 꽂기",
        detail: "여기라고 생각하는 곳을 지도에서 눌러요. 다시 누르면 위치가 바뀌어요.",
        action: "지도를 눌러 핀 꽂기",
      },
      {
        title: "제출하고 결과 보기",
        detail: "제출하면 바꿀 수 없어요. 모두 내면 정답과 각자의 거리가 공개돼요.",
        action: "‘이 위치로 제출’",
      },
    ],
  },
  zoom: {
    title: "줌 아웃 추리",
    emoji: "🔍",
    badge: "조금 어려움",
    description: "확대된 거리뷰가 세 번에 걸쳐 점점 넓게 보여요. 보이는 만큼 추리해요.",
    rules: "점수는 거리로만 정해요. 빨리 내도 추가 점수는 없으니 확신이 들 때 제출해요.",
    steps: [
      {
        title: "확대된 장면 보기",
        detail: "처음엔 한 부분만 크게 보여요. 시간이 지나면 두 번 더 넓어져요.",
        action: "화면을 보고 떠오르는 곳 생각하기",
      },
      {
        title: "지도에 핀 꽂기",
        detail: "확신이 들면 지도에서 위치를 눌러요.",
        action: "지도를 눌러 핀 꽂기",
      },
      {
        title: "제출하고 결과 보기",
        detail: "정답에 가장 가까운 사람이 1점이에요.",
        action: "‘이 위치로 제출’",
      },
    ],
  },
  quiz: {
    title: "거리뷰 퀴즈",
    emoji: "🧭",
    badge: "가장 쉬워요 · 4지선다",
    description: "실제 거리뷰를 보고, 보기 4개 중 어디인지 골라요.",
    rules: "맞힌 사람 모두 1점이에요. 지도 없이 보기만 고르면 돼요.",
    steps: [
      {
        title: "거리뷰 둘러보기",
        detail: "실제 거리 사진이에요. 끌어서 주변을 둘러보세요.",
        action: "거리뷰를 좌우로 끌어보기",
      },
      {
        title: "보기 고르기",
        detail: "보기 4개 중 이 장소라고 생각하는 곳을 하나 골라요.",
        action: "보기 하나 누르기",
      },
      {
        title: "제출하고 결과 보기",
        detail: "맞힌 사람 모두 1점! 모두 내면 정답이 공개돼요.",
        action: "‘이 답으로 제출’",
      },
    ],
  },
  member: {
    title: "우리 사진",
    emoji: "📸",
    badge: "사진 준비 필요",
    description: "각자 직접 찍은 사진을 한 장씩 내고, 어디서 누가 찍었는지 맞혀요.",
    rules: "위치가 가장 가까우면 1점, 사진 주인을 맞히면 1점이에요. 내 사진 문제에서는 쉬어요.",
    steps: [
      {
        title: "내 사진 내기",
        detail: "대기실에서 내가 찍은 사진 한 장과 찍은 위치를 등록해요.",
        action: "사진 올리고 지도에서 위치 고르기",
      },
      {
        title: "위치와 주인 맞히기",
        detail: "다른 사람 사진을 보고 찍은 곳을 지도에 꽂고, 누구 사진인지 골라요.",
        action: "지도에 핀 꽂고 사진 주인 고르기",
      },
      {
        title: "사진 이야기 나누기",
        detail: "정답이 공개되면 사진 주인에게 어떤 날이었는지 물어봐요.",
        action: "결과를 보며 이야기하기",
      },
    ],
  },
} as const satisfies Record<
  string,
  {
    title: string;
    emoji: string;
    badge: string;
    description: string;
    rules: string;
    steps: readonly ClueModeStep[];
  }
>;
/** Easiest first. */
export const CLUE_MODE_ORDER = ["quiz", "photo", "zoom", "member"] as const;
/** Basic (street-view) questions available per mode; the bank holds more than this. */
export const CLUE_BASIC_LIMITS = { photo: 20, zoom: 20, quiz: 20 } as const;
export type DrawingMode = keyof typeof DRAWING_MODES;
export type ClueMode = keyof typeof CLUE_MODES;
export type CreativePlayer = { id: string; nickname: string; score: number };
export type DrawingSettings = { mode: DrawingMode; sets: number; seconds: number; scored: boolean };
export type ClueSettings = {
  mode: ClueMode;
  rounds: number;
  seconds: number;
  source: "basic" | "host";
};
export const creativeText = z
  .string()
  .trim()
  .normalize("NFKC")
  .min(1)
  .max(100)
  .refine((v) => !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(v));
export const pointSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();
export const creativeSettingsFields = {
  drawingMode: z.enum(["mix", "live", "relay"]).default("mix"),
  drawingSets: z.number().int().min(1).max(3).default(1),
  drawingSeconds: z.union([z.literal(30), z.literal(45), z.literal(60), z.literal(90)]).default(45),
  drawingScored: z.boolean().default(true),
  clueMode: z.enum(["photo", "zoom", "quiz", "member"]).default("photo"),
  clueRounds: z.number().int().min(1).max(20).default(5),
  clueSeconds: z.union([z.literal(30), z.literal(60), z.literal(90)]).default(60),
  clueSource: z.enum(["basic", "host"]).default("basic"),
};
export const creativeSubmissionFields = { runId: z.uuid(), phaseId: z.uuid() };
export const creativePlayerActions = [
  z.strictObject({
    action: z.literal("drawing-text"),
    ...creativeSubmissionFields,
    text: creativeText,
  }),
  z.strictObject({
    action: z.literal("drawing-image"),
    ...creativeSubmissionFields,
    assetId: z.uuid(),
  }),
  z.strictObject({
    action: z.literal("drawing-guess"),
    ...creativeSubmissionFields,
    text: creativeText,
  }),
  z.strictObject({
    action: z.literal("drawing-judge"),
    ...creativeSubmissionFields,
    guessId: z.uuid(),
  }),
  z.strictObject({
    action: z.literal("drawing-vote"),
    ...creativeSubmissionFields,
    chainId: z.uuid(),
  }),
  z.strictObject({
    action: z.literal("clue-answer"),
    ...creativeSubmissionFields,
    point: pointSchema.optional(),
    choice: z.number().int().min(0).max(3).optional(),
    authorId: z.uuid().optional(),
  }),
  z.strictObject({
    action: z.literal("clue-question"),
    assetId: z.uuid(),
    label: creativeText,
    story: z.string().trim().max(300).default(""),
    point: pointSchema.optional(),
    choices: z.array(creativeText).length(4).optional(),
    correctChoice: z.number().int().min(0).max(3).optional(),
  }),
] as const;
export type CreativePlayerAction = z.infer<(typeof creativePlayerActions)[number]>;
export type DrawingChain = {
  id: string;
  author: string;
  painter: string;
  interpreter: string;
  finalPainter: string;
  prompt: string | null;
  image: string | null;
  interpretation: string | null;
  finalImage: string | null;
  skipped: boolean;
  winner: string | null;
};
export type DrawingGuess = {
  id: string;
  playerId: string;
  text: string;
  accepted: boolean;
  receivedAt: number;
};
export type DrawingState = {
  settings: DrawingSettings;
  stage:
    | "lobby"
    | "prompt"
    | "draw"
    | "interpret"
    | "live"
    | "judging"
    | "review"
    | "gallery"
    | "voting"
    | "result"
    | "aborted";
  runId: string | null;
  phaseId: string;
  roster: CreativePlayer[];
  chains: DrawingChain[];
  history: DrawingChain[];
  finishedAt: number | null;
  set: number;
  index: number;
  endsAt: number | null;
  paused: number | null;
  guesses: DrawingGuess[];
  votes: Record<string, string>;
  tallies: Record<string, number>;
};
export type DrawingView = Omit<
  DrawingState,
  "chains" | "history" | "guesses" | "votes" | "tallies" | "paused"
> & {
  serverNow: number;
  paused: boolean;
  assignment: {
    chainId: string;
    canvasId: string;
    prompt: string | null;
    image: string | null;
  } | null;
  liveCanvasId: string | null;
  artistId: string | null;
  judgeId: string | null;
  canGuess: boolean;
  canJudge: boolean;
  guesses: DrawingGuess[];
  revealed: DrawingChain[];
  submitted: boolean;
  submittedCount: number;
  expected: number;
  voteCounts: Record<string, number>;
  myVote: string | null;
};
export type ClueQuestion = {
  id: string;
  assetId: string | null;
  basicAsset: string | null;
  media: "photo" | "audio" | "video" | "street";
  /** NAVER street view: shown by pano id and camera angle, never by coordinates. */
  street?: { panoId: string; pan: number } | null;
  authorId: string | null;
  label: string;
  story: string;
  point: MapPoint | null;
  choices: string[] | null;
  correctChoice: number | null;
  credit: string | null;
};
export type ClueAnswer = {
  point?: MapPoint | undefined;
  choice?: number | undefined;
  authorId?: string | undefined;
};
export type ClueResult = {
  question: ClueQuestion;
  answers: {
    playerId: string;
    point: MapPoint | null;
    choice: number | null;
    authorId: string | null;
    distance: number | null;
    points: number;
  }[];
};
export type ClueState = {
  settings: ClueSettings;
  stage: "lobby" | "guess" | "review" | "result" | "aborted";
  runId: string | null;
  phaseId: string;
  roster: CreativePlayer[];
  finishedAt: number | null;
  prepared: ClueQuestion[];
  deck: ClueQuestion[];
  index: number;
  endsAt: number | null;
  paused: number | null;
  answers: Record<string, ClueAnswer>;
  results: ClueResult[];
  startedQuestionAt: number | null;
};
export type ClueView = Omit<ClueState, "prepared" | "deck" | "answers" | "results" | "paused"> & {
  serverNow: number;
  paused: boolean;
  question: Pick<
    ClueQuestion,
    "id" | "assetId" | "basicAsset" | "media" | "street" | "choices" | "credit"
  > | null;
  total: number;
  submitted: number;
  expected: number;
  myAnswer: ClueAnswer | null;
  canAnswer: boolean;
  result: ClueResult | null;
  results: ClueResult[];
  myPrepared: ClueQuestion[];
  preparedCount: number;
};
export function normalizeDrawingAnswer(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, "");
}
export function straightLineMetres(a: MapPoint, b: MapPoint) {
  const r = Math.PI / 180,
    dlat = (b.latitude - a.latitude) * r,
    dlng = (b.longitude - a.longitude) * r;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin(dlng / 2) ** 2;
  return Math.round(
    6371008.8 * 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h))),
  );
}
export const drawingSettingsFrom = (
  s: z.output<z.ZodObject<typeof creativeSettingsFields>>,
): DrawingSettings => ({
  mode: s.drawingMode,
  sets: s.drawingSets,
  seconds: s.drawingSeconds,
  scored: s.drawingScored,
});
export const clueSettingsFrom = (
  s: z.output<z.ZodObject<typeof creativeSettingsFields>>,
): ClueSettings => ({
  mode: s.clueMode,
  rounds: s.clueRounds,
  seconds: s.clueSeconds,
  source: s.clueSource,
});
