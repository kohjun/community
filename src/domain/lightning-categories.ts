import { z } from "zod";
import type { CategorySlug } from "./categories";

export const LIGHTNING_CATEGORY_SLUGS = [
  "food-cafe",
  "drinks",
  "games",
  "culture",
  "sports",
  "outdoors",
  "crafting",
  "music",
  "photography",
  "pets",
  "attractions",
  "social",
  "other",
] as const;
export type LightningCategorySlug = (typeof LIGHTNING_CATEGORY_SLUGS)[number];
export const lightningCategorySchema = z.enum(LIGHTNING_CATEGORY_SLUGS);

export const LIGHTNING_CATEGORIES: readonly {
  slug: LightningCategorySlug;
  name: string;
  topic: CategorySlug;
  examples: readonly string[];
}[] = [
  {
    slug: "food-cafe",
    name: "맛집·카페",
    topic: "cooking",
    examples: ["맛집 탐방", "카페 투어", "디저트", "방어회", "브런치"],
  },
  {
    slug: "drinks",
    name: "술·야장",
    topic: "party",
    examples: ["야장", "펍", "LP바", "와인", "수제맥주"],
  },
  {
    slug: "games",
    name: "게임·방탈출",
    topic: "mind-games",
    examples: ["방탈출", "보드게임", "마피아", "예능 게임", "레이저 아레나", "현실판 오징어게임"],
  },
  {
    slug: "culture",
    name: "전시·공연·영화",
    topic: "party",
    examples: ["전시회", "영화", "코미디 공연", "뮤지컬", "축제", "불꽃놀이"],
  },
  {
    slug: "sports",
    name: "운동·스포츠",
    topic: "sports",
    examples: ["볼링", "탁구", "아이스링크", "러닝", "스포츠 관람", "족구"],
  },
  {
    slug: "outdoors",
    name: "산책·여행",
    topic: "travel",
    examples: ["한강 피크닉", "산책", "캠핑", "등산", "바다낚시", "당일치기"],
  },
  {
    slug: "crafting",
    name: "클래스·만들기",
    topic: "cooking",
    examples: ["베이킹", "요리", "도자기", "공예", "그림", "쿠키 클래스"],
  },
  {
    slug: "music",
    name: "음악·댄스",
    topic: "music",
    examples: ["밴드 공연", "노래방", "합주", "댄스", "음악 감상"],
  },
  {
    slug: "photography",
    name: "사진·쇼핑",
    topic: "travel",
    examples: ["감성 사진", "출사", "동묘 구제시장", "플리마켓", "빈티지 쇼핑"],
  },
  {
    slug: "pets",
    name: "반려동물",
    topic: "party",
    examples: ["애견카페", "반려견 산책", "펫 피크닉"],
  },
  {
    slug: "attractions",
    name: "테마파크·체험",
    topic: "race",
    examples: ["롯데월드", "에버랜드", "아쿠아리움", "귀신의 집", "온천", "체험 액티비티"],
  },
  {
    slug: "social",
    name: "친목·파티",
    topic: "party",
    examples: ["동네 친구", "소개팅", "테마 파티", "운영 스태프", "봉사", "언어 교류"],
  },
  { slug: "other", name: "기타 취향", topic: "party", examples: ["독서", "스터디", "새로운 취미"] },
];

export function lightningCategory(slug: LightningCategorySlug | null | undefined) {
  return (
    LIGHTNING_CATEGORIES.find((category) => category.slug === slug) ??
    LIGHTNING_CATEGORIES[LIGHTNING_CATEGORIES.length - 1]!
  );
}
export const POPULAR_LIGHTNING_TAGS = [
  "방탈출",
  "맛집 탐방",
  "한강 피크닉",
  "전시회",
  "볼링",
  "야장",
  "베이킹",
  "테마 파티",
] as const;
