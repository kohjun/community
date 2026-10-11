import { DISCUSSION_TYPES } from "./discussions";
import { z } from "zod";
import { CATEGORY_SLUGS, type CategorySlug } from "./categories";

export const SEARCH_TYPES = [
  "all",
  "story",
  "recruitment",
  "rulebook",
  "template",
  "record",
] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];
export type SearchResultType = Exclude<SearchType, "all">;
export const SEARCH_PAGE_SIZE = 20;
export const SEARCH_MAX_PAGE = 50;
export const SEARCH_LABELS: Record<SearchType, string> = {
  all: "전체",
  story: "이야기",
  recruitment: "모집",
  rulebook: "룰북",
  template: "템플릿",
  record: "행사 기록",
};
export const searchInputSchema = z.strictObject({
  q: z
    .string()
    .trim()
    .max(100)
    .regex(/^[^\u0000-\u001f\u007f]*$/, "검색어를 확인해주세요.")
    .regex(/^[^\uD800-\uDFFF]*$/u, "검색어를 확인해주세요.")
    .default(""),
  discussionType: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(DISCUSSION_TYPES).optional(),
  ),
  type: z.enum(SEARCH_TYPES).default("all"),
  category: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(CATEGORY_SLUGS).optional(),
  ),
  page: z.coerce.number().int().min(1).max(SEARCH_MAX_PAGE).default(1),
});
export type SearchQuery = z.infer<typeof searchInputSchema>;
export interface SearchResult {
  id: string;
  type: SearchResultType;
  category: CategorySlug;
  spoiler?: boolean;
  discussionType?: import("./discussions").DiscussionType | null;
  title: string;
  excerpt: string;
  tags: string[];
  author: string;
  createdAt: string;
  href: string;
}
export interface SearchPage {
  query: SearchQuery;
  items: SearchResult[];
  counts: Record<SearchType, number>;
  total: number;
  page: number;
  pageCount: number;
  limited: boolean;
}
/** SQL LIKE treats these characters as wildcards, unless escaped first. */
export function escapeSearchLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
export function searchHref(query: SearchQuery, change: Partial<SearchQuery> = {}): string {
  const value = { ...query, ...change };
  const params = new URLSearchParams();
  if (value.q) params.set("q", value.q);
  if (value.type !== "all") params.set("type", value.type);
  if (value.discussionType) params.set("discussionType", value.discussionType);
  if (value.category) params.set("category", value.category);
  if (value.page > 1) params.set("page", String(value.page));
  return `/search${params.size ? `?${params}` : ""}`;
}
