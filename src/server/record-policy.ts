import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { profiles, eventRecords } from "../db/schema";
import { memberSafety } from "../db/safety-schema";
import { membershipActive } from "../domain/safety";
import { AppError, requireActor } from "./errors";
export async function requireRecordMember(db: Database, actor: string | null): Promise<string> {
  const user = requireActor(actor);
  const [profile] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.id, user));
  const [state] = await db.select().from(memberSafety).where(eq(memberSafety.userId, user));
  if (!profile || !membershipActive(state))
    throw new AppError("FORBIDDEN", "계정 이용이 제한되어 있어요.");
  return user;
}
export function recordVisible(actor: string, allowDraft = false, metadataOnly = false) {
  return sql`exists(select 1 from sliper.posts rp join sliper.event_settings rs on rs.post_id=rp.id
 left join sliper.event_lifecycle rl on rl.post_id=rp.id
 where rp.id=${eventRecords.postId} and ${eventRecords.ownerId} is not null and rp.status='published' and not rp.sample and rs.completed_at is not null and rl.cancelled_at is null
 and (${metadataOnly} or ${eventRecords.status}='published' or (${allowDraft} and (${eventRecords.ownerId}=${actor}::uuid or exists(select 1 from sliper.room_managers rm where rm.post_id=rp.id and rm.user_id=${actor}::uuid))))
 and not exists(select 1 from sliper.content_restrictions cr where cr.hidden and ((cr.target_type='post' and cr.target_id=rp.id) or (cr.target_type='record' and cr.target_id=rp.id)))
 and not exists(select 1 from sliper.member_blocks mb where (mb.blocker_id=${actor}::uuid and mb.blocked_id=${eventRecords.ownerId}) or (mb.blocked_id=${actor}::uuid and mb.blocker_id=${eventRecords.ownerId}))
 and not exists(select 1 from sliper.member_safety ms where ms.user_id=${eventRecords.ownerId} and (ms.status='closed' or (ms.status='suspended' and (ms.suspended_until is null or ms.suspended_until>statement_timestamp())))))`;
}
export async function assertRecordMediaAccess(db: Database, postId: string, actor: string | null) {
  const user = await requireRecordMember(db, actor);
  const [record] = await db
    .select({ id: eventRecords.postId })
    .from(eventRecords)
    .where(and(eq(eventRecords.postId, postId), recordVisible(user, true)));
  if (!record) throw new AppError("NOT_FOUND", "행사 기록을 찾을 수 없어요.");
}

// An origin link never grants access to a member-only event record.
export async function visibleRecordSource(
  db: Database,
  actor: string | null,
  postId: string | null,
): Promise<string | null> {
  if (!actor || !postId) return null;
  const [profile] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.id, actor));
  const [state] = await db.select().from(memberSafety).where(eq(memberSafety.userId, actor));
  if (!profile || !membershipActive(state)) return null;
  const [record] = await db
    .select({ postId: eventRecords.postId })
    .from(eventRecords)
    .where(and(eq(eventRecords.postId, postId), recordVisible(actor, true)));
  return record?.postId ?? null;
}
