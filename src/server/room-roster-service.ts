import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/connection";
import { posts, eventSettings, roomManagers, roomMembers, eventApplications } from "../db/schema";
import type { RoomMember, RoomMemberPage } from "../domain/participation";
import { AppError } from "./errors";
import { memberSafety } from "../db/safety-schema";
import { membershipActive } from "../domain/safety";
import { pageScope, cursorSchema } from "./pagination";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
const memberCursorSchema = z.strictObject({
  v: z.literal(1),
  scope: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.string().regex(/^[a-f0-9]{32}$/),
  rank: z.number().int().min(0).max(2),
  id: z.uuid(),
});

export async function authorizeRoom(tx: Tx, user: string, id: string) {
  const [account] = await tx.select().from(memberSafety).where(eq(memberSafety.userId, user));
  if (!membershipActive(account)) throw new AppError("FORBIDDEN", "계정 이용이 제한되어 있어요.");
  // Serialize reads with membership/role changes and refunds for this event.
  const [post] = await tx
    .select()
    .from(posts)
    .where(and(eq(posts.id, id), eq(posts.status, "published")))
    .for("update");
  const [settings] = await tx
    .select({ postId: eventSettings.postId })
    .from(eventSettings)
    .where(eq(eventSettings.postId, id));
  if (!post || !settings) throw new AppError("NOT_FOUND", "공지방을 찾을 수 없어요.");
  const [manager] = await tx
    .select({ userId: roomManagers.userId })
    .from(roomManagers)
    .where(and(eq(roomManagers.postId, id), eq(roomManagers.userId, user)));
  const canWrite = post.authorId === user || !!manager;
  const [member] = await tx
    .select({ userId: roomMembers.userId })
    .from(roomMembers)
    .innerJoin(eventApplications, eq(eventApplications.id, roomMembers.applicationId))
    .where(
      and(
        eq(roomMembers.postId, id),
        eq(roomMembers.userId, user),
        sql`${roomMembers.revokedAt} is null`,
        eq(eventApplications.status, "confirmed"),
      ),
    );
  if (!canWrite && !member)
    throw new AppError("FORBIDDEN", "참가가 확정된 사람만 이 공지방을 볼 수 있어요.");
  return { post, canWrite, isOwner: post.authorId === user };
}

export async function readRoomRoster(
  tx: Tx,
  user: string,
  id: string,
  owner: string | null,
  limit: number,
  cursor?: string,
): Promise<RoomMemberPage> {
  const scope = pageScope(["room-members", id, user]);
  let before: z.infer<typeof memberCursorSchema> | null = null;
  if (cursor) {
    try {
      before = memberCursorSchema.parse(
        JSON.parse(Buffer.from(cursorSchema.parse(cursor), "base64url").toString("utf8")),
      );
      if (before.scope !== scope) throw new Error("Cursor scope mismatch");
    } catch {
      throw new AppError(
        "VALIDATION",
        "멤버 목록 위치가 올바르지 않아요. 처음부터 다시 불러와주세요.",
      );
    }
  }
  // One statement gives count, revision and bounded page the same DB snapshot.
  // Public identity, display name, icon and image are the only profile projection.
  const [snapshot] = await tx.select({
    count: sql<number>`roster_page.count`,
    revision: sql<string>`roster_page.revision`,
    members: sql<RoomMember[]>`roster_page.members`,
  }).from(sql`(

    WITH memberships AS (
      SELECT ${owner}::uuid AS user_id, 0 AS rank
      UNION ALL
      SELECT user_id, 1 FROM sliper.room_managers WHERE post_id=${id}::uuid
      UNION ALL
      SELECT member.user_id, 2 FROM sliper.room_members member
      JOIN sliper.event_applications application ON application.id=member.application_id
      WHERE member.post_id=${id}::uuid AND member.revoked_at IS NULL AND application.status='confirmed'
    ), eligible AS (
      SELECT user_id, min(rank) AS rank FROM memberships GROUP BY user_id
    ), roster AS MATERIALIZED (
      SELECT p.id AS auth_id, p.public_id, p.nickname, p.avatar, photo.id AS photo_id, eligible.rank
      FROM eligible
      JOIN sliper.profiles p ON p.id=eligible.user_id
      LEFT JOIN sliper.profile_photos photo ON photo.user_id=p.id
    ), summary AS (
      SELECT count(*)::integer AS count,
        md5(coalesce(string_agg(jsonb_build_array(public_id,nickname,avatar,photo_id,rank)::text, ',' ORDER BY public_id), '')) AS revision
      FROM roster
    ), page AS (
      SELECT * FROM roster
      WHERE ${before ? sql`(rank, public_id) > (${before.rank}, ${before.id}::uuid)` : sql`true`}
      ORDER BY rank, public_id LIMIT ${limit + 1}
    )
    SELECT summary.count, summary.revision,
      coalesce((SELECT jsonb_agg(jsonb_build_object(
        'publicId', public_id, 'nickname', nickname, 'avatar', avatar,
        'photoSrc', CASE WHEN photo_id IS NULL THEN NULL ELSE '/api/profile-photos/' || photo_id::text || '?room=' || ${id}::text END,
        'role', CASE rank WHEN 0 THEN 'owner' WHEN 1 THEN 'manager' ELSE 'participant' END,
        'isMe', auth_id=${user}::uuid
      ) ORDER BY rank, public_id) FROM page), '[]'::jsonb) AS members
    FROM summary
  ) AS roster_page`);
  if (!snapshot) throw new AppError("INTERNAL", "멤버 목록을 불러오지 못했어요.");
  if (before && before.revision !== snapshot.revision)
    throw new AppError("CONFLICT", "멤버가 변경되었어요. 목록을 새로 불러와주세요.");
  const selected = snapshot.members.slice(0, limit),
    last = selected.at(-1);
  const rank = last?.role === "owner" ? 0 : last?.role === "manager" ? 1 : 2;
  return {
    memberCount: snapshot.count,
    memberRevision: snapshot.revision,
    members: selected,
    nextCursor:
      snapshot.members.length > limit && last
        ? Buffer.from(
            JSON.stringify({ v: 1, scope, revision: snapshot.revision, rank, id: last.publicId }),
          ).toString("base64url")
        : null,
  };
}
