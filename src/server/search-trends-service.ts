import { sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { CATEGORIES } from "../domain/categories";
import {
  buildSearchSuggestions,
  type SearchKeywordItem,
  type SearchSuggestionsResponse,
} from "../domain/search-trends";
import { contentVisible } from "./safety-visibility";
import { creditMemberVisible } from "./event-credit-service";

const CACHE_TTL_MS = 5 * 60 * 1000;
const PUBLIC_VIEWER = "00000000-0000-0000-0000-000000000000";
let cached: { value: SearchSuggestionsResponse; expiresAt: number } | null = null;
let pending: Promise<SearchSuggestionsResponse> | null = null;

/**
 * Lightweight PostgreSQL-backed trending & recommended search keyword aggregator.
 * Runs against existing published community tags, active recruitment categories, and published
 * archive tags with a 5-minute in-memory TTL — zero extra search-engine memory overhead.
 */
export function searchTrendsService(db: Database, options: { useCache?: boolean } = {}) {
  const useCache = options.useCache ?? true;

  async function load(now: Date): Promise<SearchSuggestionsResponse> {
    const [tagRows, libraryTagRows, categoryRows] = await Promise.all([
      db
        .select({
          tag: sql<string>`tag`,
          score: sql<number>`count(*)::int`,
        })
        .from(
          sql`(
            select unnest(p.tags) as tag
            from sliper.posts p
            where p.status='published'
              and not p.sample
              and not p.spoiler
              and ${contentVisible("post", sql`p.id`)}
              and p.created_at >= ${new Date(now.getTime() - 90 * 86400000).toISOString()}::timestamptz
          ) t`,
        )
        .groupBy(sql`tag`)
        .orderBy(sql`count(*) desc`, sql`tag asc`)
        .limit(10),
      db
        .select({
          tag: sql<string>`tag`,
          score: sql<number>`count(*)::int`,
        })
        .from(
          sql`(
            select unnest(l.tags) as tag
            from sliper.library_entries l
            where l.status='published'
              and not l.sample
              and l.kind in ('rulebook', 'template')
              and ${contentVisible("library", sql`l.id`)}
              and l.owner_id is not null
              and ${creditMemberVisible(PUBLIC_VIEWER, sql`l.owner_id`)}
          ) lt`,
        )
        .groupBy(sql`tag`)
        .orderBy(sql`count(*) desc`, sql`tag asc`)
        .limit(6),
      db
        .select({
          category: sql<string>`p.category_slug::text`,
          score: sql<number>`count(*)::int`,
        })
        .from(sql`sliper.posts p join sliper.event_settings e on e.post_id=p.id`)
        .where(
          sql`p.status='published' and p.kind='모집' and not p.sample and not p.spoiler
            and e.open and e.completed_at is null
            and (e.ends_at is null or e.ends_at > ${now.toISOString()}::timestamptz)
            and not exists(select 1 from sliper.event_lifecycle lc where lc.post_id=p.id and lc.cancelled_at is not null)
            and ${contentVisible("post", sql`p.id`)}`,
        )
        .groupBy(sql`p.category_slug`)
        .orderBy(sql`count(*) desc`)
        .limit(4),
    ]);

    const live: Array<{ keyword: string; badge?: SearchKeywordItem["badge"] }> = [];
    for (const row of tagRows) {
      if (row.tag) live.push({ keyword: row.tag, badge: "인기" });
    }
    for (const row of categoryRows) {
      const cat = CATEGORIES.find((c) => c.slug === row.category);
      if (cat) live.push({ keyword: cat.name, badge: "모임" });
    }
    for (const row of libraryTagRows) {
      if (row.tag) live.push({ keyword: row.tag, badge: "추천" });
    }

    return buildSearchSuggestions(live, now);
  }

  async function suggestions(now = new Date()): Promise<SearchSuggestionsResponse> {
    if (!useCache) return load(now);
    if (cached && cached.expiresAt > now.getTime()) return cached.value;
    pending ??= load(now)
      .then((value) => {
        cached = { value, expiresAt: now.getTime() + CACHE_TTL_MS };
        return value;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  return { suggestions };
}

export function clearSearchTrendsCache() {
  cached = null;
}
