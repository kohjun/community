import { z } from "zod";
import type { MapPoint } from "../lib/naver-maps";

export const DRAWING_MODES = {
  mix: {
    title: "믹스 릴레이",
    minimum: 4,
    description: "문장 → 그림 → 해석 → 실시간 그림 맞히기",
    rules: "마지막 해석 문장이 정답이에요. 문장 작성자와 화가는 답을 제출하지 않아요.",
  },
  live: {
    title: "라이브 드로잉",
    minimum: 2,
    description: "한 명이 그리고, 나머지가 실시간으로 맞혀요",
    rules: "처음 맞힌 사람 2점, 정답자가 나온 화가 1점. 모두 화가를 맡으면 한 바퀴예요.",
  },
  relay: {
    title: "그림 릴레이",
    minimum: 3,
    description: "문장 → 그림 → 해석 → 전체 공개와 재미 투표",
    rules: "정답과 점수 없이 감상해요. 마지막에 가장 재미있는 다른 사람의 릴레이에 한 표!",
  },
} as const;
export const CLUE_MODES = {
  photo: {
    title: "사진 핀",
    description: "사진 속 장소를 지도에 찍어요",
    rules: "정답까지 가장 가까운 사람 모두 1점. 제출 후에는 핀을 바꿀 수 없어요.",
  },
  zoom: {
    title: "줌 아웃",
    description: "조금씩 넓어지는 사진으로 장소 추리",
    rules: "사진이 세 단계로 공개돼요. 빨리 제출해도 추가 점수 없이 거리로만 겨뤄요.",
  },
  quiz: {
    title: "소리·영상 퀴즈",
    description: "단서를 보고 듣고, 네 가지 보기에서 선택",
    rules: "맞힌 사람 모두 1점. 제한시간 안에 다시 재생할 수 있어요.",
  },
  member: {
    title: "우리 사진",
    description: "사진 속 장소와 사진을 낸 사람 찾기",
    rules: "가장 가까우면 1점, 사진 주인을 맞히면 1점. 출제자는 이번 문제에서 쉬어요.",
  },
} as const;
export const CLUE_BASIC_LIMITS = { photo: 20, zoom: 20, quiz: 10 } as const;
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
  media: "photo" | "audio" | "video";
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
    "id" | "assetId" | "basicAsset" | "media" | "choices" | "credit"
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
