import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/connection";
import {
  eventApplications,
  eventSettings,
  posts,
  profiles,
  roomManagers,
  roomMembers,
} from "../db/schema";
import { eventPrivateContacts } from "../db/event-contact-schema";
import { memberBlocks, memberSafety } from "../db/safety-schema";
import { membershipActive } from "../domain/safety";
import {
  eventPrivateContactPutSchema,
  eventPrivateContactDeleteSchema,
  type EventPrivateContactView,
} from "../domain/event-contact";
import { AppError, requireActor } from "./errors";
import { contentVisible } from "./safety-visibility";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function eventPrivateContactService(db: Database) {
  async function authorize(tx: Tx, user: string, id: string, write = false) {
    // Refunds, participant revocation and manager changes use this same event lock.
    const [post] = await tx
      .select({ authorId: posts.authorId })
      .from(posts)
      .where(
        and(
          eq(posts.id, id),
          eq(posts.kind, "모집"),
          eq(posts.status, "published"),
          contentVisible("post", posts.id),
        ),
      )
      .for("update");
    if (!post?.authorId) throw new AppError("NOT_FOUND", "행사 담당자 연락처를 확인할 수 없어요.");
    const [settings] = await tx
      .select({ id: eventSettings.postId })
      .from(eventSettings)
      .where(eq(eventSettings.postId, id));
    if (!settings) throw new AppError("NOT_FOUND", "행사 담당자 연락처를 확인할 수 없어요.");
    const owner = post.authorId;
    const members = await tx
      .select({ id: profiles.id })
      .from(profiles)
      .where(sql`${profiles.id} in (${user}::uuid, ${owner}::uuid)`)
      .for("share");
    const states = await tx
      .select()
      .from(memberSafety)
      .where(sql`${memberSafety.userId} in (${user}::uuid, ${owner}::uuid)`);
    for (const target of [user, owner]) {
      if (
        !members.some((row) => row.id === target) ||
        !membershipActive(states.find((row) => row.userId === target))
      )
        throw new AppError("FORBIDDEN", "행사 담당자 연락처를 확인할 수 없어요.");
    }
    const [blocked] = await tx
      .select({ id: memberBlocks.id })
      .from(memberBlocks)
      .where(
        or(
          and(eq(memberBlocks.blockerId, user), eq(memberBlocks.blockedId, owner)),
          and(eq(memberBlocks.blockerId, owner), eq(memberBlocks.blockedId, user)),
        ),
      )
      .limit(1);
    if (blocked) throw new AppError("FORBIDDEN", "행사 담당자 연락처를 확인할 수 없어요.");
    const canManage = owner === user;
    if (write && !canManage)
      throw new AppError("FORBIDDEN", "주최자만 참가자 전용 연락처를 변경할 수 있어요.");
    if (!canManage) {
      const [manager] = await tx
        .select({ id: roomManagers.userId })
        .from(roomManagers)
        .where(and(eq(roomManagers.postId, id), eq(roomManagers.userId, user)));
      if (!manager) {
        const [member] = await tx
          .select({ id: roomMembers.userId })
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
        if (!member)
          throw new AppError("FORBIDDEN", "참가 확정 후 행사 담당자 연락처를 확인할 수 있어요.");
      }
    }
    return canManage;
  }
  async function view(tx: Tx, id: string, canManage: boolean): Promise<EventPrivateContactView> {
    const [row] = await tx
      .select({
        enabled: eventPrivateContacts.enabled,
        channel: eventPrivateContacts.channel,
        value: eventPrivateContacts.value,
        note: eventPrivateContacts.note,
        revision: eventPrivateContacts.revision,
      })
      .from(eventPrivateContacts)
      .where(eq(eventPrivateContacts.postId, id));
    return {
      revision: row?.revision ?? 0,
      canManage,
      contact: row?.enabled ? { channel: row.channel!, value: row.value!, note: row.note! } : null,
    };
  }
  async function overview(actor: string | null, postId: string): Promise<EventPrivateContactView> {
    const user = requireActor(actor),
      id = z.uuid().parse(postId);
    return db.transaction(async (tx) => view(tx, id, await authorize(tx, user, id)));
  }
  async function change(actor: string | null, postId: string, input: unknown, remove: boolean) {
    const user = requireActor(actor),
      id = z.uuid().parse(postId);
    const registration = remove ? null : eventPrivateContactPutSchema.parse(input);
    const value = registration ?? eventPrivateContactDeleteSchema.parse(input);
    return db.transaction(async (tx) => {
      const canManage = await authorize(tx, user, id, true);
      const [current] = await tx
        .select({ revision: eventPrivateContacts.revision })
        .from(eventPrivateContacts)
        .where(eq(eventPrivateContacts.postId, id));
      if ((current?.revision ?? 0) !== value.expectedRevision)
        throw new AppError("CONFLICT", "연락처가 변경되었어요. 새로 불러온 뒤 다시 저장해주세요.");
      const payload = registration
        ? {
            enabled: true,
            channel: registration.channel,
            value: registration.value,
            note: registration.note,
          }
        : { enabled: false, channel: null, value: null, note: null };
      await tx
        .insert(eventPrivateContacts)
        .values({ postId: id, ...payload, revision: value.expectedRevision + 1, updatedBy: user })
        .onConflictDoUpdate({
          target: eventPrivateContacts.postId,
          set: {
            ...payload,
            revision: value.expectedRevision + 1,
            updatedBy: user,
            updatedAt: sql`statement_timestamp()`,
          },
        });
      return view(tx, id, canManage);
    });
  }
  return {
    overview,
    save: (actor: string | null, postId: string, input: unknown) =>
      change(actor, postId, input, false),
    remove: (actor: string | null, postId: string, input: unknown) =>
      change(actor, postId, input, true),
  };
}
