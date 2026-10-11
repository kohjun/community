export const KNOWLEDGE_TOPICS = [
  "벌칙",
  "상품",
  "규칙",
  "성비",
  "미션",
  "진행시간",
  "동선",
  "행사 물품",
] as const;
export const LAB_TOPICS = [
  "예능",
  "드라마",
  "영화",
  "소개팅 기법",
  "미션 설계",
  "이벤트 각색",
] as const;
export const CREW_TOPICS = [
  "MC",
  "진행 스태프",
  "기획 파트너",
  "촬영·편집",
  "디자인",
  "공간·장비",
] as const;
export const BOARD_TOPICS = { knowledge: KNOWLEDGE_TOPICS, lab: LAB_TOPICS, crew: CREW_TOPICS };
export const BOARD_DESCRIPTIONS = {
  knowledge: "벌칙부터 동선까지, 예능을 만드는 실전 노하우",
  lab: "좋아하는 작품의 기법을 연구하고 새로운 이벤트로 각색해요",
  crew: "MC, 스태프, 기획 파트너. 다음 에피소드를 함께 만들어요",
};
export const AVATARS = ["spark", "heart", "game", "music", "planet", "smile"] as const;
export const AVATAR_SYMBOLS = {
  spark: "✦",
  heart: "♡",
  game: "⚑",
  music: "♫",
  planet: "◉",
  smile: "☺",
};
export const LEVELS = [
  { name: "첫 에피소드", threshold: 0 },
  { name: "플레이 메이트", threshold: 30 },
  { name: "분위기 메이커", threshold: 100 },
  { name: "예능 크리에이터", threshold: 300 },
  { name: "슬리퍼 레전드", threshold: 1000 },
];
export function activityLevel(points: number) {
  const index = LEVELS.reduce((current, level, i) => (points >= level.threshold ? i : current), 0);
  return {
    ...LEVELS[Math.max(0, index)]!,
    level: Math.max(0, index) + 1,
    next: LEVELS[index + 1] ?? null,
  };
}
