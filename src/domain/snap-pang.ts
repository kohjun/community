import { z } from "zod";

export const SNAP_PANG_PRESETS = ["color", "object", "face", "random"] as const;
export type SnapPangPreset = (typeof SNAP_PANG_PRESETS)[number];

/** Presets from before the four-mode split, still present in saved room state. */
const LEGACY_SNAP_PANG_PRESETS: Record<string, SnapPangPreset> = {
  light: "color",
  mix: "random",
  pokerface: "face",
};
export function normalizeSnapPangPreset(value: unknown): unknown {
  return typeof value === "string" && Object.hasOwn(LEGACY_SNAP_PANG_PRESETS, value)
    ? LEGACY_SNAP_PANG_PRESETS[value]
    : value;
}

export const SNAP_PANG_ROUND_COUNTS = [3, 5, 7, 9] as const;
export const SNAP_PANG_SECONDS = [15, 20, 30] as const;
export const SNAP_PANG_MIN_PLAYERS = 2;
export const SNAP_PANG_MAX_PLAYERS = 12;
export const SNAP_PANG_BRIEFING_MS = 4_000;
export const SNAP_PANG_REVEAL_MS = 6_500;
/** A color shot below this match earns no points. */
export const SNAP_COLOR_MIN_ACCURACY = 35;

export const SNAP_PANG_PRESET_META: Record<
  SnapPangPreset,
  {
    title: string;
    subtitle: string;
    badge: string;
    cameraNote: string;
    games: readonly string[];
    usesFace: boolean;
  }
> = {
  color: {
    title: "🎨 색깔 모드",
    subtitle: "화면에 나온 색깔과 같은 물건을 주변에서 찾아 찍어요. 색이 비슷할수록 점수가 높아요.",
    badge: "얼굴 안 찍음 · 첫 만남 추천",
    cameraNote: "후면 카메라로 물건만 찍어요",
    games: ["🎨 색깔 찾기"],
    usesFace: false,
  },
  object: {
    title: "📦 물건 모드",
    subtitle:
      "컵·휴대폰·가방처럼 제시된 물건을 카메라가 인식하면 셔터를 눌러요. 빨리 제출할수록 점수가 높아요.",
    badge: "얼굴 안 찍음",
    cameraNote: "후면 카메라로 물건만 찍어요",
    games: ["📦 물건 찾기"],
    usesFace: false,
  },
  face: {
    title: "😆 표정 모드",
    subtitle:
      "웃음 참기와 표정 릴레이를 번갈아 해요. 웃으면 폭탄이 터지고, 제시된 표정을 순서대로 지으면 성공이에요.",
    badge: "친한 모임 추천",
    cameraNote: "전면 카메라 · 얼굴은 내 기기에서만 분석해요",
    games: ["💣 웃음 참기", "🎭 표정 릴레이"],
    usesFace: true,
  },
  random: {
    title: "🎲 랜덤 모드",
    subtitle: "색깔·물건·웃음 참기·표정 릴레이 중 하나가 라운드마다 무작위로 나와요.",
    badge: "추천",
    cameraNote: "라운드마다 후면·전면 카메라를 바꿔 써요",
    games: ["🎨 색깔 찾기", "📦 물건 찾기", "💣 웃음 참기", "🎭 표정 릴레이"],
    usesFace: true,
  },
};

export type SnapRoundSlot = { kind: SnapRoundKind; face?: SnapFaceSubMode };

const RANDOM_SLOTS: readonly SnapRoundSlot[] = [
  { kind: "color" },
  { kind: "object" },
  { kind: "face", face: "smile-bomb" },
  { kind: "face", face: "face-copy" },
];

/**
 * Round order for a mode. Random mode shuffles all four missions in blocks, so every mission
 * shows up once before any repeats; `randomInt(n)` returns 0..n-1 and is injectable for tests.
 */
export function snapPangRoundPlan(
  preset: SnapPangPreset,
  rounds: number,
  randomInt: (max: number) => number = (max) => Math.floor(Math.random() * max),
): SnapRoundSlot[] {
  const plan: SnapRoundSlot[] = [];
  if (preset === "color" || preset === "object") {
    for (let i = 0; i < rounds; i++) plan.push({ kind: preset });
    return plan;
  }
  if (preset === "face") {
    for (let i = 0; i < rounds; i++)
      plan.push({ kind: "face", face: i % 2 === 0 ? "smile-bomb" : "face-copy" });
    return plan;
  }
  while (plan.length < rounds) {
    const block = [...RANDOM_SLOTS];
    for (let i = block.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [block[i], block[j]] = [block[j]!, block[i]!];
    }
    // Never repeat the same mission across a block boundary.
    const last = plan.at(-1);
    if (last && snapPangSlotLabel(last) === snapPangSlotLabel(block[0]!))
      block.push(block.shift()!);
    plan.push(...block);
  }
  return plan.slice(0, rounds);
}

export function snapPangSlotLabel(slot: SnapRoundSlot): string {
  if (slot.kind === "color") return "🎨 색깔 찾기";
  if (slot.kind === "object") return "📦 물건 찾기";
  return slot.face === "face-copy" ? "🎭 표정 릴레이" : "💣 웃음 참기";
}

export type SnapPangSettings = {
  preset: SnapPangPreset;
  rounds: (typeof SNAP_PANG_ROUND_COUNTS)[number];
  seconds: (typeof SNAP_PANG_SECONDS)[number];
};

export const DEFAULT_SNAP_PANG_SETTINGS: SnapPangSettings = {
  preset: "random",
  rounds: 5,
  seconds: 20,
};

export const snapPangSettingsFields = {
  snapPreset: z
    .preprocess(normalizeSnapPangPreset, z.enum(SNAP_PANG_PRESETS))
    .default(DEFAULT_SNAP_PANG_SETTINGS.preset),
  snapRounds: z
    .union([z.literal(3), z.literal(5), z.literal(7), z.literal(9)])
    .default(DEFAULT_SNAP_PANG_SETTINGS.rounds),
  snapSeconds: z
    .union([z.literal(15), z.literal(20), z.literal(30)])
    .default(DEFAULT_SNAP_PANG_SETTINGS.seconds),
};

/** Saved rooms may still carry a pre-split preset; read them as the closest current mode. */
export function normalizeSnapPangSettings(settings: SnapPangSettings): SnapPangSettings {
  const preset = normalizeSnapPangPreset(settings.preset) as SnapPangPreset;
  const supportedPreset = SNAP_PANG_PRESETS.includes(preset) ? preset : "random";
  return supportedPreset === settings.preset ? settings : { ...settings, preset: supportedPreset };
}

export function snapPangSettingsFrom(config: {
  snapPreset: SnapPangPreset;
  snapRounds: SnapPangSettings["rounds"];
  snapSeconds: SnapPangSettings["seconds"];
}): SnapPangSettings {
  return {
    preset: normalizeSnapPangPreset(config.snapPreset) as SnapPangPreset,
    rounds: config.snapRounds,
    seconds: config.snapSeconds,
  };
}

export type SnapRoundKind = "color" | "object" | "face";
export type SnapFaceSubMode = "smile-bomb" | "face-copy";
export type SnapExpressionId = "surprise" | "wink" | "angry" | "happy" | "pucker";

export type SnapColorMission = {
  kind: "color";
  id: string;
  targetHex: string;
  colorName: string;
  prompt: string;
};

export type SnapObjectMission = {
  kind: "object";
  id: string;
  label: string;
  cocoLabels: string[];
  targetCount: 1 | 2;
  hint: string;
};

export type SnapFaceMission = {
  kind: "face";
  id: string;
  subMode: SnapFaceSubMode;
  attackerId: string | null;
  attackCard: string | null;
  expressions: SnapExpressionId[];
  prompt: string;
};

export type SnapMission = SnapColorMission | SnapObjectMission | SnapFaceMission;

export const SNAP_EXPRESSION_LABELS: Record<
  SnapExpressionId,
  { label: string; emoji: string; cue: string }
> = {
  surprise: { label: "깜짝 놀람", emoji: "😮", cue: "입을 크게 벌리고 눈을 동그랗게!" },
  wink: { label: "한쪽 윙크", emoji: "😉", cue: "한쪽 눈을 감고 살짝 미소!" },
  angry: { label: "찌푸리기", emoji: "😠", cue: "눈썹을 가운데로 확 모아보세요!" },
  happy: { label: "활짝 웃기", emoji: "😁", cue: "입꼬리를 끝까지 올려 활짝!" },
  pucker: { label: "휘파람 입", emoji: "😗", cue: "입술을 동그랗게 쭉 모아보세요!" },
};

export const SNAP_COLOR_BANK: readonly Omit<SnapColorMission, "kind">[] = [
  {
    id: "sliper-blue",
    targetHex: "#0A84FE",
    colorName: "슬리퍼 블루",
    prompt: "선명한 파란색 소품이나 옷, 음료 라벨을 찾아 찍어요!",
  },
  {
    id: "chili-red",
    targetHex: "#EF4444",
    colorName: "칠리 레드",
    prompt: "강렬한 빨간색 포인트! 친구 가방·로고·소품을 노려보세요.",
  },
  {
    id: "lemon-pop",
    targetHex: "#FACC15",
    colorName: "레몬 팝",
    prompt: "톡 쏘는 노란색을 찾아 조준하세요!",
  },
  {
    id: "mint-soda",
    targetHex: "#14B8A6",
    colorName: "민트 소다",
    prompt: "시원한 민트·청록색을 테이블 주변에서 찾아보세요.",
  },
  {
    id: "lime-fresh",
    targetHex: "#65A30D",
    colorName: "라임 그린",
    prompt: "초록빛 병, 식물, 옷이나 액세서리를 찾아 찍어요!",
  },
  {
    id: "orange-crush",
    targetHex: "#F97316",
    colorName: "오렌지 크러시",
    prompt: "따뜻한 주황색 물건을 찾아 카메라에 담아보세요!",
  },
  {
    id: "berry-pink",
    targetHex: "#EC4899",
    colorName: "베리 핑크",
    prompt: "화사한 핑크빛 아이템을 테이블에서 찾아보세요!",
  },
  {
    id: "neon-violet",
    targetHex: "#8B5CF6",
    colorName: "네온 바이올렛",
    prompt: "보라색 소품·폰케이스·음료 패키지를 찾아보세요!",
  },
  {
    id: "cafe-latte",
    targetHex: "#A47148",
    colorName: "카페 라떼",
    prompt: "우드 테이블, 커피, 가죽 지갑 같은 브라운 톤을 노려보세요!",
  },
  {
    id: "deep-navy",
    targetHex: "#1E3A8A",
    colorName: "딥 네이비",
    prompt: "어두운 남색 데님·재킷·노트 커버를 찾아 찍어요!",
  },
];

export const SNAP_OBJECT_BANK: readonly Omit<SnapObjectMission, "kind">[] = [
  {
    id: "cup-one",
    label: "컵 · 머그잔",
    cocoLabels: ["cup", "wine glass"],
    targetCount: 1,
    hint: "테이블 위 커피잔·물컵·유리잔을 카메라 중앙에 담아 0.6초 유지!",
  },
  {
    id: "bottle-one",
    label: "병 · 텀블러",
    cocoLabels: ["bottle"],
    targetCount: 1,
    hint: "물병, 음료수병, 맥주병이나 텀블러를 정면에서 비춰보세요!",
  },
  {
    id: "phone-one",
    label: "남의 휴대폰",
    cocoLabels: ["cell phone"],
    targetCount: 1,
    hint: "옆 사람의 스마트폰을 카메라로 포착! 친구가 숨기기 전에 찍어요!",
  },
  {
    id: "cup-two",
    label: "컵 2개 동시 포착",
    cocoLabels: ["cup", "wine glass"],
    targetCount: 2,
    hint: "테이블 위 컵 2개를 한 화면에 모아 같이 찍어야 락온돼요!",
  },
  {
    id: "phone-two",
    label: "휴대폰 2대 동시 포착",
    cocoLabels: ["cell phone"],
    targetCount: 2,
    hint: "친구 폰 2대를 한 프레임에 모아 찍어보세요! 협동 or 스틸!",
  },
  {
    id: "bag-one",
    label: "가방 · 백팩",
    cocoLabels: ["handbag", "backpack", "suitcase"],
    targetCount: 1,
    hint: "의자나 테이블 옆에 둔 가방·에코백·백팩을 찾아 찍어요!",
  },
  {
    id: "book-one",
    label: "책 · 메뉴판",
    cocoLabels: ["book"],
    targetCount: 1,
    hint: "메뉴판, 다이어리, 책이나 노트를 카메라에 담아보세요!",
  },
  {
    id: "chair-one",
    label: "의자",
    cocoLabels: ["chair"],
    targetCount: 1,
    hint: "주변의 빈 의자나 옆 자리 의자 등받이를 깔끔하게 비춰보세요!",
  },
  {
    id: "bowl-one",
    label: "그릇 · 접시",
    cocoLabels: ["bowl", "cup"],
    targetCount: 1,
    hint: "안주 그릇, 디저트 볼, 또는 큰 컵을 카메라에 담아보세요!",
  },
];

export const SNAP_ATTACK_CARDS: readonly string[] = [
  "가장 진지한 눈빛으로 오른쪽 사람에게 3초 동안 과장된 칭찬을 해보세요!",
  "무표정으로 ‘오늘 사실 내가 여기 1등 먹으러 왔다’고 사투리나 드라마 대사 톤으로 말해요!",
  "테이블에서 한 명을 골라 3초 눈싸움을 걸고, 갑자기 세상에서 제일 느끼한 윙크를 날려요!",
  "아무 말 없이 가장 진지한 표정으로 양손 하트를 3명에게 차례로 발사하세요!",
  "오늘 먹은 음식 이름을 명품 브랜드 발표회 진행자처럼 우아하게 소개해보세요!",
  "옆 사람 닉네임을 부르며 ‘너 지금 웃으면 진짜 큰일 난다’고 속삭여 보세요!",
  "가장 어색한 로봇 말투로 ‘나는 절대 웃지 않는 최첨단 슬리퍼다’라고 선언해보세요!",
  "테이블 전원 중 가장 웃음 장벽이 낮아 보이는 사람을 가리키고 진지하게 3초 박수 치기!",
];

export const SNAP_FACE_COMBOS: readonly SnapExpressionId[][] = [
  ["surprise", "happy"],
  ["wink", "surprise"],
  ["angry", "happy"],
  ["pucker", "surprise"],
  ["happy", "wink"],
  ["surprise", "angry"],
];

export const SNAP_AVATAR_COLORS = [
  "#0A84FE",
  "#FF595E",
  "#14B8A6",
  "#F59E0B",
  "#8B5CF6",
  "#EC4899",
  "#10B981",
  "#F97316",
  "#06B6D4",
  "#6366F1",
  "#E11D48",
  "#84CC16",
] as const;

export type SnapPangPlayer = {
  id: string;
  nickname: string;
  score: number;
  color: string;
};

export type SnapPangStage = "lobby" | "briefing" | "active" | "reveal" | "result" | "aborted";

export type SnapColorSubmission = {
  mode: "color";
  hex: string;
  accuracy: number;
  fallback: boolean;
  submittedAt: number;
};

export type SnapObjectSubmission = {
  mode: "object";
  matched: boolean;
  elapsedMs: number;
  confidence: number;
  fallback: boolean;
  submittedAt: number;
};

export type SnapFaceCopySubmission = {
  mode: "face-copy";
  completed: boolean;
  elapsedMs: number;
  fallback: boolean;
  submittedAt: number;
};

export type SnapSubmission = SnapColorSubmission | SnapObjectSubmission | SnapFaceCopySubmission;

export type SnapLiveTension = {
  tension: number;
  popped: boolean;
  poppedAt: number | null;
  updatedAt: number;
};

export type SnapRoundEntryResult = {
  playerId: string;
  nickname: string;
  color: string;
  points: number;
  rank: number | null;
  detail: string;
  hex?: string | null;
  accuracy?: number | null;
  elapsedMs?: number | null;
  popped?: boolean;
  isAttacker?: boolean;
  fallback?: boolean;
};

export type SnapRoundResult = {
  round: number;
  mission: SnapMission;
  entries: SnapRoundEntryResult[];
};

export type SnapPangState = {
  settings: SnapPangSettings;
  stage: SnapPangStage;
  runId: string | null;
  phaseId: string;
  round: number;
  totalRounds: number;
  roster: SnapPangPlayer[];
  deck: SnapMission[];
  roundStartedAt: number | null;
  endsAt: number | null;
  pausedRemainingMs: number | null;
  submissions: Record<string, SnapSubmission>;
  tensions: Record<string, SnapLiveTension>;
  history: SnapRoundResult[];
  finishedAt: number | null;
};

export type SnapPangView = {
  settings: SnapPangSettings;
  stage: SnapPangStage;
  runId: string | null;
  phaseId: string;
  round: number;
  totalRounds: number;
  roster: SnapPangPlayer[];
  mission: SnapMission | null;
  roundStartedAt: number | null;
  endsAt: number | null;
  paused: boolean;
  serverNow: number;
  mySubmission: SnapSubmission | null;
  submittedCount: number;
  expectedCount: number;
  tensions: Record<string, SnapLiveTension>;
  lastResult: SnapRoundResult | null;
  history: SnapRoundResult[];
};

const uuid = z.uuid().transform((s) => s.toLowerCase());
const hexSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, "유효한 색상 코드가 필요해요.")
  .transform((s) => s.toUpperCase());

export const snapPangPlayerActions = [
  z.strictObject({
    action: z.literal("snap-color"),
    runId: uuid,
    round: z.number().int().min(1).max(20),
    hex: hexSchema,
    fallback: z.boolean().default(false),
  }),
  z.strictObject({
    action: z.literal("snap-object"),
    runId: uuid,
    round: z.number().int().min(1).max(20),
    confidence: z.number().min(0).max(1),
    fallback: z.boolean().default(false),
  }),
  z.strictObject({
    action: z.literal("snap-face-copy"),
    runId: uuid,
    round: z.number().int().min(1).max(20),
    fallback: z.boolean().default(false),
  }),
  z.strictObject({
    action: z.literal("snap-tension"),
    runId: uuid,
    round: z.number().int().min(1).max(20),
    tension: z.number().int().min(0).max(100),
    popped: z.boolean().default(false),
    fallback: z.boolean().default(false),
  }),
] as const;

export const snapPangHostActionSchema = z.strictObject({
  action: z.literal("snap-control"),
  revision: z.number().int().nonnegative(),
  phaseId: uuid,
  command: z.enum(["next", "pause", "resume"]),
});

export type SnapPangPlayerAction = z.output<(typeof snapPangPlayerActions)[number]>;
export type SnapPangHostAction = z.output<typeof snapPangHostActionSchema>;
