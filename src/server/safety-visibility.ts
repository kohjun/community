import { and, eq, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/connection";
import { contentRestrictions } from "../db/safety-schema";
import { AppError } from "./errors";
export function contentVisible(
  kind: "post" | "comment" | "venue" | "crew" | "record" | "library",
  id: unknown,
): SQL {
  return sql`not exists(select 1 from sliper.content_restrictions r where r.target_type=${kind} and r.target_id=${id} and r.hidden)`;
}
export function authorVisible(author: unknown, actor: string | null): SQL {
  return actor
    ? sql`not exists(select 1 from sliper.member_blocks b where b.blocker_id=${actor} and b.blocked_id=${author})`
    : sql`true`;
}
export async function assertContentVisible(
  db: Database,
  kind: "post" | "comment" | "venue" | "crew" | "record" | "library",
  id: string,
) {
  const [row] = await db
    .select({ id: contentRestrictions.targetId })
    .from(contentRestrictions)
    .where(
      and(
        eq(contentRestrictions.targetType, kind),
        eq(contentRestrictions.targetId, id),
        eq(contentRestrictions.hidden, true),
      ),
    )
    .limit(1);
  if (row) throw new AppError("NOT_FOUND", "운영 검토 중인 콘텐츠입니다.");
}
