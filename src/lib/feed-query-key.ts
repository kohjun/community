import type { FeedQuery } from "../domain/community";

export function feedFilterKey(query: FeedQuery): string {
  const values = {
    ...query,
    page: undefined,
    cursor: undefined,
    limit: 20,
    focus: query.focus ?? "all",
    sort: query.sort ?? "latest",
    view: query.view ?? "home",
    period: query.period ?? "today",
    rankingAt: query.sort === "popular" && query.period !== "all" ? query.rankingAt : undefined,
  };
  return new URLSearchParams(
    Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, String(value)]),
  ).toString();
}
