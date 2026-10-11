export const CATEGORY_SLUGS = [
  "travel",
  "dating",
  "race",
  "mind-games",
  "survival",
  "music",
  "sports",
  "cooking",
  "party",
  "knowledge",
  "lab",
  "crew",
] as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

export const CATEGORIES = [
  { slug: "travel", name: "여행", sortOrder: 0 },
  { slug: "dating", name: "연애", sortOrder: 1 },
  { slug: "race", name: "레이스", sortOrder: 2 },
  { slug: "mind-games", name: "심리추리", sortOrder: 3 },
  { slug: "survival", name: "서바이벌", sortOrder: 4 },
  { slug: "music", name: "음악", sortOrder: 5 },
  { slug: "sports", name: "스포츠", sortOrder: 6 },
  { slug: "cooking", name: "요리", sortOrder: 7 },
  { slug: "party", name: "파티", sortOrder: 8 },
  { slug: "knowledge", name: "지식", sortOrder: 9 },
  { slug: "lab", name: "콘텐츠 연구소", sortOrder: 10 },
  { slug: "crew", name: "함께 만드는 크루", sortOrder: 11 },
] as const satisfies readonly { slug: CategorySlug; name: string; sortOrder: number }[];
