export const WORD_CATEGORIES = [
  { id: "food", label: "음식" },
  { id: "animals", label: "동물" },
  { id: "places", label: "장소" },
  { id: "jobs", label: "직업" },
  { id: "things", label: "사물" },
  { id: "hobbies", label: "스포츠·취미" },
  { id: "nature", label: "자연" },
  { id: "games", label: "예능·게임" },
] as const;
export const WORD_CATEGORY_IDS = [
  "food",
  "animals",
  "places",
  "jobs",
  "things",
  "hobbies",
  "nature",
  "games",
] as const;
export type WordCategory = (typeof WORD_CATEGORY_IDS)[number];
export const WORD_MODES = ["classic", "undercover", "undercover-reveal"] as const;
export type WordMode = (typeof WORD_MODES)[number];
export const WORD_MODE_LABELS: Record<WordMode, string> = {
  classic: "기본 라이어",
  undercover: "다른 제시어 · 정체 비공개",
  "undercover-reveal": "다른 제시어 · 정체 공개",
};
export const WORD_HINTS = [
  "제시어를 직접 말하지 말고, 떠오르는 특징 한 가지를 설명해주세요.",
  "이 제시어와 관련된 경험을 짧게 이야기해주세요.",
  "어떤 장소에서 만날 수 있을까요? 이름을 말하지 않고 설명해주세요.",
  "누군가에게 추천한다면 어떤 점을 이야기할까요?",
  "이 제시어와 잘 어울리는 느낌이나 분위기를 설명해주세요.",
  "이 제시어를 한 문장으로 소개한다면?",
  "이 제시어를 떠올리면 생각나는 장면을 설명해주세요.",
  "처음 본 사람에게 어떻게 설명할까요?",
  "함께 떠오르는 다른 것 하나를 이야기해주세요.",
  "이 제시어의 가장 특별한 점은 무엇인가요?",
];
export const normalizeWordGuess = (value: string) =>
  value.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase("ko-KR");
