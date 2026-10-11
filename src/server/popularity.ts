import { sql, type SQL } from "drizzle-orm";
import { posts } from "../db/schema";
import { popularityWindow, type PopularPeriod } from "../domain/community-time";
export function periodLikeCount(period: PopularPeriod, at: Date): SQL<number> {
  const window = popularityWindow(period, at);
  return sql<number>`(select count(*)::int from sliper.post_likes l join sliper.profiles liker on liker.id=l.user_id
    where l.post_id=${posts.id}
    and not liker.analytics_excluded
    and not exists(select 1 from sliper.member_safety s where s.user_id=l.user_id and (s.status='closed' or (s.status='suspended' and (s.suspended_until is null or s.suspended_until>statement_timestamp()))))
    ${window ? sql`and l.created_at>=${window.start.toISOString()}::timestamptz and l.created_at<=${window.end.toISOString()}::timestamptz` : sql``})`;
}
