export interface SearchKeywordItem {
  keyword: string;
  label?: string;
  badge?: "인기" | "추천" | "웹게임" | "모임";
  href: string;
}

export interface SearchPlaceholderItem {
  keyword: string;
  prompt: string;
}

export interface SearchSuggestionsResponse {
  popular: SearchKeywordItem[];
  recommended: SearchKeywordItem[];
  placeholders: SearchPlaceholderItem[];
  updatedAt: string;
}

const DEFAULT_RECOMMENDED: ReadonlyArray<{
  keyword: string;
  badge: NonNullable<SearchKeywordItem["badge"]>;
  prompt: string;
}> = [
  { keyword: "스냅 팡 3D", badge: "웹게임", prompt: "설치 없는 3D 카메라 파티 게임 '스냅 팡 3D'" },
  { keyword: "추리", badge: "인기", prompt: "요즘 인기! '추리' 모임·룰북 찾아보기" },
  { keyword: "번개", badge: "모임", prompt: "이번 주말 가볍게 만나는 '번개' 검색" },
  { keyword: "파티", badge: "추천", prompt: "MT·연말 모임 필수 '파티' 기획·후기 검색" },
  { keyword: "MBTI", badge: "웹게임", prompt: "어색한 첫 만남 깨는 'MBTI' 게임·이야기" },
  { keyword: "라이어", badge: "웹게임", prompt: "술자리 분위기 살리는 '라이어' 웹게임 검색" },
  { keyword: "여행", badge: "추천", prompt: "함께 떠나는 예능 '여행' 모임 찾아보기" },
  { keyword: "보드게임", badge: "모임", prompt: "가까운 동네 '보드게임' 번개 검색해보세요" },
];

export function sanitizeKeyword(raw: string): string | null {
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2 || cleaned.length > 24) return null;
  // Never surface emails, phone numbers, or URLs as public trending keywords.
  if (/@|https?:\/\/|01[016789][-\s.]?\d{3,4}/i.test(cleaned)) return null;
  return cleaned;
}

export function keywordSearchHref(keyword: string): string {
  return `/search?q=${encodeURIComponent(keyword)}`;
}

/**
 * Merges live DB-observed tags/topics with curated seasonal & SEO keywords into deduplicated
 * popular rankings, recommendation chips, and rotating dynamic search placeholders.
 */
export function buildSearchSuggestions(
  liveKeywords: ReadonlyArray<{ keyword: string; badge?: SearchKeywordItem["badge"] }>,
  now = new Date(),
): SearchSuggestionsResponse {
  const seen = new Set<string>();
  const popular: SearchKeywordItem[] = [];

  for (const item of liveKeywords) {
    const clean = sanitizeKeyword(item.keyword);
    if (!clean) continue;
    const key = clean.toLocaleLowerCase("ko-KR");
    if (seen.has(key)) continue;
    seen.add(key);
    popular.push({
      keyword: clean,
      badge: item.badge ?? "인기",
      href: keywordSearchHref(clean),
    });
    if (popular.length >= 8) break;
  }

  for (const fallback of DEFAULT_RECOMMENDED) {
    if (popular.length >= 8) break;
    const key = fallback.keyword.toLocaleLowerCase("ko-KR");
    if (seen.has(key)) continue;
    seen.add(key);
    popular.push({
      keyword: fallback.keyword,
      badge: fallback.badge,
      href: keywordSearchHref(fallback.keyword),
    });
  }

  const recommended: SearchKeywordItem[] = DEFAULT_RECOMMENDED.map((entry) => ({
    keyword: entry.keyword,
    badge: entry.badge,
    href: keywordSearchHref(entry.keyword),
  }));

  const placeholderSeen = new Set<string>();
  const placeholders: SearchPlaceholderItem[] = [];

  // Lead with top 3 live trending terms, then blend curated discovery prompts.
  for (const top of popular.slice(0, 3)) {
    const key = top.keyword.toLocaleLowerCase("ko-KR");
    if (placeholderSeen.has(key)) continue;
    placeholderSeen.add(key);
    const matchedCurated = DEFAULT_RECOMMENDED.find(
      (entry) => entry.keyword.toLocaleLowerCase("ko-KR") === key,
    );
    placeholders.push({
      keyword: top.keyword,
      prompt: matchedCurated?.prompt ?? `지금 인기 검색어 '${top.keyword}' 찾아보기`,
    });
  }

  for (const entry of DEFAULT_RECOMMENDED) {
    if (placeholders.length >= 7) break;
    const key = entry.keyword.toLocaleLowerCase("ko-KR");
    if (placeholderSeen.has(key)) continue;
    placeholderSeen.add(key);
    placeholders.push({
      keyword: entry.keyword,
      prompt: entry.prompt,
    });
  }

  return {
    popular,
    recommended,
    placeholders,
    updatedAt: now.toISOString(),
  };
}

export const FALLBACK_SEARCH_SUGGESTIONS: SearchSuggestionsResponse = buildSearchSuggestions(
  [],
  new Date("2026-01-01T00:00:00Z"),
);
