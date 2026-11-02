import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { eventReflections } from "../db/growth-schema";
import { posts, eventSettings } from "../db/schema";
import { safetyService } from "./safety-service";
import { contentVisible } from "./safety-visibility";
import { participationAttended } from "./verified-review-policy";
import { growthMemberVisible } from "./growth-policy";
import { AppError } from "./errors";
/** One authorized source lookup per image, without loading the whole event gallery. */
export async function assertReunionImageAccess(
  db: Database,
  postId: string,
  assetId: string,
  actor: string | null,
) {
  const user = await safetyService(db).activeMember(actor);
  const [note] = await db
    .select({ id: eventReflections.id })
    .from(eventReflections)
    .innerJoin(posts, eq(posts.id, eventReflections.postId))
    .innerJoin(eventSettings, eq(eventSettings.postId, posts.id))
    .where(
      and(
        eq(eventReflections.postId, postId),
        eq(posts.status, "published"),
        eq(posts.sample, false),
        contentVisible("post", posts.id),
        growthMemberVisible(posts.authorId, sql`${user}::uuid`),
        growthMemberVisible(eventReflections.userId, sql`${user}::uuid`),
        sql`${eventReflections.photos} @> ${JSON.stringify([assetId])}::jsonb and ${eventSettings.completedAt} is not null
  and not exists(select 1 from sliper.event_lifecycle l where l.post_id=${postId} and l.cancelled_at is not null)
  and (${eventReflections.visibility}='members' or ${posts.authorId}=${user}::uuid
    or exists(select 1 from sliper.room_managers m where m.post_id=${postId} and m.user_id=${user})
    or exists(select 1 from sliper.event_applications a where a.post_id=${postId} and a.user_id=${user} and ${participationAttended({ applicationId: sql`a.id`, postId: sql`a.post_id`, userId: sql`a.user_id` })}))`,
      ),
    )
    .limit(1);
  if (!note) throw new AppError("NOT_FOUND", "사진을 볼 수 없어요.");
}
