import { z } from "zod";
import type { CategorySlug } from "./categories";
import type { DiscussionType } from "./discussions";
import type { LibraryKind } from "./library";

/** Curated explicit tag relationships. Titles, bodies and categories never infer a topic. */
export const TOPICS = [
  {
    slug: "mystery",
    title: "추리와 심리 게임",
    description:
      "마피아부터 크라임씬까지, 서로의 생각을 읽는 게임을 이야기하고 직접 만나 즐겨보세요.",
    category: "mind-games",
    aliases: ["심리추리", "추리", "추리게임", "심리게임", "마피아", "크라임씬", "mystery"],
  },
  {
    slug: "mission-race",
    title: "미션 레이스",
    description: "팀워크와 전략으로 완성하는 레이스. 참신한 미션과 진행 노하우를 모아보세요.",
    category: "race",
    aliases: ["미션레이스", "미션 레이스", "레이스", "런닝맨", "mission-race"],
  },
  {
    slug: "social-party",
    title: "함께하는 소셜 파티",
    description:
      "가볍게 만나고 오래 기억할 순간. 소개팅과 파티의 이야기, 모임과 진행 자료를 만나보세요.",
    category: "party",
    aliases: ["파티", "소개팅", "소셜모임", "소셜파티", "social-party"],
  },
] as const satisfies readonly {
  slug: string;
  title: string;
  description: string;
  category: CategorySlug;
  aliases: readonly string[];
}[];
export type CuratedTopic = (typeof TOPICS)[number];
export type TopicSlug = CuratedTopic["slug"];
export const TOPIC_PAGE_SIZE = 12;
export const TOPIC_MAX_PAGE = 100;
export function normalizeTopicTag(tag: string) {
  return tag.trim().replace(/^#/, "").replace(/\s+/g, "").toLowerCase();
}
export function topicForSlug(slug: string): CuratedTopic | null {
  return TOPICS.find((topic) => topic.slug === slug) ?? null;
}
export function topicAliases(topic: CuratedTopic): string[] {
  return [...new Set(topic.aliases.map(normalizeTopicTag))];
}
export function topicsForTags(tags: readonly string[]): CuratedTopic[] {
  const normalized = new Set(tags.map(normalizeTopicTag));
  return TOPICS.filter((topic) => topicAliases(topic).some((tag) => normalized.has(tag)));
}
export const topicQuerySchema = z.strictObject({
  focus: z.enum(["all", "interests"]).default("all"),
  storiesPage: z.coerce.number().int().min(1).max(TOPIC_MAX_PAGE).default(1),
  recruitmentPage: z.coerce.number().int().min(1).max(TOPIC_MAX_PAGE).default(1),
  libraryPage: z.coerce.number().int().min(1).max(TOPIC_MAX_PAGE).default(1),
});
export type TopicQuery = z.infer<typeof topicQuerySchema>;
export interface TopicPostSummary {
  id: string;
  href: string;
  kind: "이야기" | "후기" | "투표" | "모집";
  category: CategorySlug;
  title: string;
  excerpt: string;
  author: string;
  anonymous: boolean;
  spoiler: boolean;
  discussionType: DiscussionType | null;
  createdAt: string;
  likes: number;
  comments: number;
  location: string | null;
  eventStartsAt: string | null;
  eventAvailable: boolean;
  eventAmountKRW: number | null;
}
export interface TopicLibrarySummary {
  id: string;
  href: string;
  kind: LibraryKind;
  category: CategorySlug;
  title: string;
  summary: string;
  author: string;
  priceKRW: number;
  createdAt: string;
}
export interface TopicSection<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  limited: boolean;
}
export interface TopicDetail {
  topic: CuratedTopic;
  query: TopicQuery;
  interestFeed: "all" | "personalized" | "setup" | "login";
  stories: TopicSection<TopicPostSummary>;
  recruitment: TopicSection<TopicPostSummary>;
  library: TopicSection<TopicLibrarySummary>;
}
export function topicUrl(slug: TopicSlug, query: Partial<TopicQuery> = {}) {
  const params = new URLSearchParams();
  if (query.focus === "interests") params.set("focus", "interests");
  for (const key of ["storiesPage", "recruitmentPage", "libraryPage"] as const)
    if (query[key] && query[key]! > 1) params.set(key, String(query[key]));
  const suffix = params.toString();
  return "/topics/" + slug + (suffix ? "?" + suffix : "");
}
