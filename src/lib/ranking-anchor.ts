import type { FeedQuery } from "../domain/community";

/** Adopt only a server-issued anchor for an unanchored period request; browser clocks never choose the ranking window. */
export function adoptServerRankingAnchor(
  query: FeedQuery,
  rankingAt: string | undefined,
): FeedQuery | null {
  if (
    query.sort !== "popular" ||
    query.period === "all" ||
    query.rankingAt ||
    !rankingAt ||
    !Number.isFinite(Date.parse(rankingAt))
  )
    return null;
  return { ...query, rankingAt };
}
