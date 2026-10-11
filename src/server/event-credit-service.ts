import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { eventCredits } from "../db/records-schema";
import { eventRecords, posts, profiles, roomManagers } from "../db/schema";
import {
  creditCreateSchema,
  creditDecisionSchema,
  creditUpdateSchema,
  type CreditPage,
  type CreditView,
} from "../domain/records";
import { uuidSchema } from "../domain/validation";
import { AppError } from "./errors";
import { requireRecordMember, recordVisible } from "./record-policy";
import { enforceRequestLimit } from "./request-limits";
import { insertInbox } from "./engagement-events";
import { preciseTimestamp } from "./pagination";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Connection = Database | Tx;
type Credit = typeof eventCredits.$inferSelect;
export const creditMemberVisible = (actor: string, target: unknown) => sql`
 not exists(select 1 from sliper.member_safety ms where ms.user_id=${target} and (ms.status='closed' or (ms.status='suspended' and (ms.suspended_until is null or ms.suspended_until>statement_timestamp()))))
 and not exists(select 1 from sliper.member_blocks mb where (mb.blocker_id=${actor}::uuid and mb.blocked_id=${target}) or (mb.blocked_id=${actor}::uuid and mb.blocker_id=${target}))`;
const creditEventVisible = (
  actor: string,
) => sql`exists(select 1 from sliper.posts p join sliper.event_settings s on s.post_id=p.id left join sliper.event_lifecycle l on l.post_id=p.id
 where p.id=${eventRecords.postId} and ${eventRecords.ownerId} is not null and p.status='published' and not p.sample and s.completed_at is not null and l.cancelled_at is null
 and ${creditMemberVisible(actor, eventRecords.ownerId)}
 and not exists(select 1 from sliper.content_restrictions r where r.hidden and r.target_id=p.id and r.target_type in ('post','record')))`;
async function manager(connection: Connection, postId: string, actor: string) {
  const [post] = await connection
    .select({ authorId: posts.authorId })
    .from(posts)
    .where(eq(posts.id, postId));
  if (post?.authorId === actor) return true;
  const [appointed] = await connection
    .select({ id: roomManagers.userId })
    .from(roomManagers)
    .where(and(eq(roomManagers.postId, postId), eq(roomManagers.userId, actor)));
  return !!appointed;
}
async function creditViews(
  connection: Connection,
  actor: string,
  condition: ReturnType<typeof sql>,
  canManage = false,
): Promise<CreditView[]> {
  const rows = await connection
    .select({
      credit: eventCredits,
      timestamp: preciseTimestamp(eventCredits.updatedAt),
      nickname: profiles.nickname,
      publicId: profiles.publicId,
      snapshot: eventRecords.snapshot,
      confirmedByName: sql<
        string | null
      >`(select p.nickname from sliper.profiles p where p.id=${eventCredits.confirmedBy} and ${creditMemberVisible(actor, sql`p.id`)})`,
    })
    .from(eventCredits)
    .innerJoin(profiles, eq(profiles.id, eventCredits.userId))
    .innerJoin(eventRecords, eq(eventRecords.postId, eventCredits.postId))
    .where(and(condition, creditMemberVisible(actor, eventCredits.userId)))
    .orderBy(desc(eventCredits.createdAt), asc(eventCredits.id))
    .limit(500);
  return rows.map(({ credit, timestamp, nickname, publicId, snapshot, confirmedByName }) => ({
    id: credit.id,
    postId: credit.postId,
    eventTitle: snapshot.title,
    publicId,
    nickname,
    role: credit.role,
    note: credit.note,
    status: credit.status,
    confirmedByName,
    acceptedAt: credit.acceptedAt?.toISOString() ?? null,
    updatedAt: timestamp,
    canDecide: credit.userId === actor,
    canManage,
    correctionNote: credit.correctionNote,
  }));
}
export async function acceptedCreditViews(db: Database, actor: string, postId: string) {
  return creditViews(
    db,
    actor,
    and(
      eq(eventCredits.postId, postId),
      eq(eventCredits.status, "accepted"),
      recordVisible(actor),
    )!,
  );
}
export function eventCreditService(db: Database, clock = () => new Date()) {
  async function lockEvent(tx: Tx, actor: string, postId: string, requireManager = false) {
    const [post] = await tx
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.id, uuidSchema.parse(postId)))
      .for("update");
    if (!post) throw new AppError("NOT_FOUND", "행사를 찾을 수 없어요.");
    const [record] = await tx
      .select()
      .from(eventRecords)
      .where(and(eq(eventRecords.postId, postId), creditEventVisible(actor)))
      .for("update");
    if (!record) throw new AppError("NOT_FOUND", "완료된 행사 기록을 찾을 수 없어요.");
    const canManage = await manager(tx, postId, actor);
    if (requireManager && !canManage)
      throw new AppError("FORBIDDEN", "행사 담당자만 기여자를 등록할 수 있어요.");
    return { record, canManage };
  }
  async function invite(tx: Tx, credit: Credit, actor: string, title: string) {
    await insertInbox(tx, {
      recipientId: credit.userId,
      kind: "credits",
      postId: credit.postId,
      sourceId: credit.id,
      actorId: actor,
      dedupeKey: "credit:" + credit.id + ":" + credit.updatedAt.toISOString(),
      title: title.slice(0, 120),
      body: credit.role + " 기여 내역을 확인해주세요.",
      url: "/players/me/credits",
    });
  }
  async function me(actor: string | null): Promise<CreditPage> {
    const user = await requireRecordMember(db, actor);
    return {
      items: await creditViews(
        db,
        user,
        and(eq(eventCredits.userId, user), creditEventVisible(user))!,
      ),
    };
  }
  async function event(actor: string | null, postId: string): Promise<CreditPage> {
    const user = await requireRecordMember(db, actor),
      id = uuidSchema.parse(postId);
    const canManage = await manager(db, id, user);
    const [record] = await db
      .select({ id: eventRecords.postId })
      .from(eventRecords)
      .where(and(eq(eventRecords.postId, id), recordVisible(user, canManage)));
    if (!record) throw new AppError("NOT_FOUND", "행사 기록을 찾을 수 없어요.");
    return {
      items: await creditViews(
        db,
        user,
        and(
          eq(eventCredits.postId, id),
          canManage ? undefined : eq(eventCredits.status, "accepted"),
        )!,
        canManage,
      ),
    };
  }
  async function create(actor: string | null, postId: string, input: unknown): Promise<CreditPage> {
    const user = await requireRecordMember(db, actor),
      value = creditCreateSchema.parse(input),
      id = uuidSchema.parse(postId);
    await enforceRequestLimit(db, user, "event_credits", 60);
    await db.transaction(async (tx) => {
      const { record } = await lockEvent(tx, user, id, true);
      const [target] = await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.publicId, value.memberPublicId))
        .for("key share");
      if (!target) throw new AppError("NOT_FOUND", "회원을 찾을 수 없어요.");
      if (target.id === user)
        throw new AppError("FORBIDDEN", "자신의 기여는 다른 담당자가 확인해야 해요.");
      await requireRecordMember(tx as unknown as Database, target.id);
      const [safe] = await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(and(eq(profiles.id, target.id), creditMemberVisible(user, profiles.id)));
      if (!safe) throw new AppError("FORBIDDEN", "이 회원에게 기여 확인을 요청할 수 없어요.");
      const [existing] = await tx
        .select({ id: eventCredits.id })
        .from(eventCredits)
        .where(
          and(
            eq(eventCredits.postId, id),
            eq(eventCredits.userId, target.id),
            eq(eventCredits.role, value.role),
          ),
        );
      if (existing)
        throw new AppError(
          "CONFLICT",
          "같은 역할의 기여 내역이 이미 있어요. 기존 내역을 수정해주세요.",
        );
      const [credit] = await tx
        .insert(eventCredits)
        .values({
          postId: id,
          userId: target.id,
          role: value.role,
          note: value.note,
          confirmedBy: user,
          updatedAt: clock(),
        })
        .returning();
      await invite(tx, credit!, user, record.snapshot.title);
    });
    return event(user, id);
  }
  async function lockedCredit(tx: Tx, user: string, id: string, manage = false) {
    const [identity] = await tx
      .select({ postId: eventCredits.postId })
      .from(eventCredits)
      .where(eq(eventCredits.id, uuidSchema.parse(id)));
    if (!identity) throw new AppError("NOT_FOUND", "기여 내역을 찾을 수 없어요.");
    const context = await lockEvent(tx, user, identity.postId, manage);
    const [row] = await tx
      .select({ credit: eventCredits, timestamp: preciseTimestamp(eventCredits.updatedAt) })
      .from(eventCredits)
      .where(eq(eventCredits.id, id))
      .for("update");
    const credit = row?.credit;
    if (!credit) throw new AppError("NOT_FOUND", "기여 내역을 찾을 수 없어요.");
    return { ...context, credit, timestamp: row!.timestamp };
  }
  const fresh = (timestamp: string, expected: string) => {
    if (timestamp !== expected)
      throw new AppError("CONFLICT", "기여 내역이 변경됐어요. 새로 불러온 뒤 다시 확인해주세요.");
  };
  const nextDate = (credit: Credit) =>
    new Date(Math.max(clock().getTime(), credit.updatedAt.getTime() + 1));
  async function update(actor: string | null, id: string, input: unknown): Promise<CreditPage> {
    const user = await requireRecordMember(db, actor),
      value = creditUpdateSchema.parse(input);
    await enforceRequestLimit(db, user, "event_credits", 60);
    const postId = await db.transaction(async (tx) => {
      const { credit, record, timestamp } = await lockedCredit(tx, user, id, true);
      fresh(timestamp, value.expectedUpdatedAt);
      if (credit.userId === user)
        throw new AppError("FORBIDDEN", "자신의 기여 내역은 직접 확인할 수 없어요.");
      const [duplicate] = await tx
        .select({ id: eventCredits.id })
        .from(eventCredits)
        .where(
          and(
            eq(eventCredits.postId, credit.postId),
            eq(eventCredits.userId, credit.userId),
            eq(eventCredits.role, value.role),
            sql`${eventCredits.id}<>${credit.id}::uuid`,
          ),
        );
      if (duplicate) throw new AppError("CONFLICT", "같은 역할의 기여 내역이 이미 있어요.");
      const [changed] = await tx
        .update(eventCredits)
        .set({
          role: value.role,
          note: value.note,
          confirmedBy: user,
          status: value.revoked ? "withdrawn" : "pending",
          acceptedAt: null,
          correctionNote: "",
          updatedAt: nextDate(credit),
        })
        .where(eq(eventCredits.id, credit.id))
        .returning();
      await invite(tx, changed!, user, record.snapshot.title);
      return credit.postId;
    });
    return event(user, postId);
  }
  async function decide(actor: string | null, id: string, input: unknown): Promise<CreditPage> {
    const user = await requireRecordMember(db, actor),
      value = creditDecisionSchema.parse(input);
    await enforceRequestLimit(db, user, "credit_decision", 60);
    await db.transaction(async (tx) => {
      const { credit, timestamp } = await lockedCredit(tx, user, id);
      if (credit.userId !== user)
        throw new AppError("FORBIDDEN", "본인에게 요청된 기여 내역만 확인할 수 있어요.");
      fresh(timestamp, value.expectedUpdatedAt);
      if (
        (value.decision === "accept" || value.decision === "reject") &&
        credit.status !== "pending"
      )
        throw new AppError("CONFLICT", "확인 대기 중인 기여 내역만 처리할 수 있어요.");
      if (
        value.decision === "withdraw" &&
        !["pending", "accepted", "correction_requested"].includes(credit.status)
      )
        throw new AppError("CONFLICT", "이미 종료된 기여 내역이에요.");
      if (value.decision === "correction" && !["pending", "accepted"].includes(credit.status))
        throw new AppError("CONFLICT", "수정 요청할 수 없는 상태예요.");
      if (value.decision === "correction" && !value.note)
        throw new AppError("VALIDATION", "수정이 필요한 내용을 적어주세요.");
      const status =
        value.decision === "accept"
          ? "accepted"
          : value.decision === "reject"
            ? "rejected"
            : value.decision === "withdraw"
              ? "withdrawn"
              : "correction_requested";
      await tx
        .update(eventCredits)
        .set({
          status,
          acceptedAt: status === "accepted" ? clock() : null,
          correctionNote: value.note,
          updatedAt: nextDate(credit),
        })
        .where(eq(eventCredits.id, credit.id));
    });
    return me(user);
  }
  return { me, event, create, update, decide };
}
