import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { activityEvents, profiles } from "../db/schema";
import { ACTIVITY_REWARDS, type ActivityReason } from "../domain/activity";
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
// Both KST boundaries are computed from local dates, independent of session DST.
export function kstActivityClock(now = sql`statement_timestamp()`) {
  const date = sql`(${now} at time zone 'Asia/Seoul')::date`;
  return {
    day: sql<string>`${date}::text`,
    at: sql<string>`${now}::text`,
    start: sql`(${date}::timestamp at time zone 'Asia/Seoul')`,
    end: sql`((${date}+1)::timestamp at time zone 'Asia/Seoul')`,
  };
}
export async function awardActivity(
  tx: Transaction,
  userId: string,
  reason: ActivityReason,
  key?: string,
) {
  // NO KEY UPDATE serializes rewards while remaining compatible with the KEY SHARE
  // locks acquired by post/comment/vote foreign keys. FOR UPDATE can deadlock here.
  await tx
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .for("no key update");
  const reward = ACTIVITY_REWARDS[reason];
  const clock = kstActivityClock();
  const [today] = await tx
    .select({
      total: sql<number>`coalesce(sum(${activityEvents.points}),0)::int`,
      day: clock.day,
      at: clock.at,
    })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.userId, userId),
        eq(activityEvents.reason, reason),
        sql`${activityEvents.createdAt} >= ${clock.start}`,
        sql`${activityEvents.createdAt} < ${clock.end}`,
      ),
    );
  if ((today?.total ?? 0) + reward.points > reward.dailyCap) return;
  const source = reason === "visit" ? today!.day : key;
  if (!source) throw new Error("An activity source is required.");
  await tx
    .insert(activityEvents)
    .values({
      userId,
      sourceKey: `${reason}:${source}`,
      reason,
      points: reward.points,
      createdAt: sql`${today!.at}::timestamptz`,
    })
    .onConflictDoNothing();
}
