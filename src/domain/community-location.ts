import { DISCUSSION_TYPES } from "./discussions";
import type { FeedQuery } from "./community";
import { CATEGORY_SLUGS } from "./categories";
/** Shareable listing state; device coordinates are deliberately not persisted in URLs. */
export function communityLocation(
  params: URLSearchParams,
  stories = false,
  now = Date.now(),
): FeedQuery {
  const category = params.get("category"),
    kind = params.get("kind"),
    sort = params.get("sort"),
    period = params.get("period"),
    view = params.get("view");
  const at = params.get("rankingAt"),
    page = Number(params.get("page") ?? 1);
  const discussion = params.get("discussionType"),
    focus = params.get("focus");
  return {
    discussionType:
      discussion && (DISCUSSION_TYPES as readonly string[]).includes(discussion)
        ? (discussion as FeedQuery["discussionType"])
        : undefined,
    focus: focus === "unanswered" || focus === "interests" ? focus : undefined,
    ...(category && (CATEGORY_SLUGS as readonly string[]).includes(category)
      ? { category: category as FeedQuery["category"] }
      : {}),
    kind:
      kind && ["모집", "이야기", "후기", "투표"].includes(kind)
        ? (kind as FeedQuery["kind"])
        : stories
          ? "이야기"
          : undefined,
    sort: sort === "popular" || (!sort && view === "popular") ? "popular" : "latest",
    period: period === "week" || period === "all" ? period : "today",
    ...(at &&
    /^\d{4}-\d{2}-\d{2}T/.test(at) &&
    Number.isFinite(Date.parse(at)) &&
    Date.parse(at) <= now
      ? { rankingAt: new Date(at).toISOString() }
      : {}),
    view: view === "popular" || view === "bookmarks" || view === "mine" ? view : "home",
    page: Number.isInteger(page) && page >= 1 && page <= 1000000 ? page : 1,
    search: params.get("search")?.slice(0, 100) || undefined,
    topic: params.get("topic")?.slice(0, 64) || undefined,
    tag: params.get("tag")?.slice(0, 24) || undefined,
    limit: 20,
  };
}
export function communityLocationUrl(current: string, query: FeedQuery, page: number) {
  const url = new URL(current);
  for (const key of [
    "category",
    "kind",
    "sort",
    "period",
    "rankingAt",
    "view",
    "search",
    "topic",
    "discussionType",
    "focus",
    "tag",
  ] as const) {
    const value = query[key];
    if (value !== undefined) url.searchParams.set(key, String(value));
    else url.searchParams.delete(key);
  }
  url.searchParams.set("page", String(page));
  return url.pathname + url.search + url.hash;
}
