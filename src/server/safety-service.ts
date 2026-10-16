import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/connection";
import {
  eventRecords,
  comments,
  eventApplications,
  eventSettings,
  posts,
  profiles,
  profilePhotos,
} from "../db/schema";
import { communityVenues } from "../db/venue-schema";
import { crews, crewMembers, crewJoinRequests, crewActivity } from "../db/crew-schema";
import { libraryEntries } from "../db/library-schema";
import { portfolioPreferences, eventCredits } from "../db/records-schema";
import { analyticsActivityDays } from "../db/analytics-schema";
import { playerPreferences } from "../db/player-schema";
import { pushSubscriptions } from "../db/push-schema";
import { eventPrivateContacts } from "../db/event-contact-schema";
import {
  contentRestrictions,
  memberBlocks,
  memberSafety,
  moderationAudit,
  safetyReports,
  staffRoles,
  supportReplies,
  supportTickets,
} from "../db/safety-schema";
import {
  membershipActive,
  moderationInputSchema,
  reportInputSchema,
  supportInputSchema,
  targetSchema,
  type BlockView,
  type ReportView,
  type SupportView,
} from "../domain/safety";
import { AppError, requireActor } from "./errors";
import { assertRecordMediaAccess } from "./record-policy";
import { enforceRequestLimit } from "./request-limits";
import { originalActionSummary } from "./appeal-service";
const uuid = z.string().uuid();
type Connection = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];
export function safetyService(db: Database) {
  async function role(actor: string | null) {
    if (!actor) return null;
    const [row] = await db
      .select({
        role: staffRoles.role,
        status: memberSafety.status,
        suspendedUntil: memberSafety.suspendedUntil,
      })
      .from(staffRoles)
      .leftJoin(memberSafety, eq(memberSafety.userId, staffRoles.userId))
      .where(eq(staffRoles.userId, actor));
    return row &&
      membershipActive({ status: row.status ?? "active", suspendedUntil: row.suspendedUntil })
      ? row.role
      : null;
  }
  async function requireStaff(actor: string | null, admin = false) {
    const userId = requireActor(actor),
      value = await role(userId);
    if (!value || (admin && value !== "admin"))
      throw new AppError("FORBIDDEN", "운영자만 이용할 수 있어요.");
    return userId;
  }
  async function activeMember(actor: string | null) {
    const userId = requireActor(actor);
    const [state] = await db.select().from(memberSafety).where(eq(memberSafety.userId, userId));
    if (!membershipActive(state))
      throw new AppError(
        "FORBIDDEN",
        "계정 이용이 제한되어 있어요. 계정 설정에서 사유를 확인해주세요.",
      );
    return userId;
  }
  async function target(connection: Connection, input: { targetType: string; targetId: string }) {
    const id = uuid.parse(input.targetId);
    if (input.targetType === "record") {
      const [row] = await connection.select().from(eventRecords).where(eq(eventRecords.postId, id));
      if (!row || row.status !== "published")
        throw new AppError("NOT_FOUND", "행사 기록을 찾을 수 없어요.");
      return {
        ownerId: row.ownerId,
        label: null,
        snapshot: (row.snapshot.title + "\n" + row.bodyMarkdown).slice(0, 4000),
      };
    }
    if (input.targetType === "library") {
      const [row] = await connection.select().from(libraryEntries).where(eq(libraryEntries.id, id));
      if (!row || row.status !== "published")
        throw new AppError("NOT_FOUND", "자료를 찾을 수 없어요.");
      return {
        ownerId: row.ownerId,
        label: null,
        snapshot: (row.title + "\n" + row.summary).slice(0, 4000),
      };
    }
    if (input.targetType === "post") {
      const [row] = await connection.select().from(posts).where(eq(posts.id, id));
      if (!row || row.status !== "published")
        throw new AppError("NOT_FOUND", "글을 찾을 수 없어요.");
      return {
        ownerId: row.authorId,
        label: row.isAnonymous ? "익명 사용자" : null,
        snapshot: (row.title + "\n" + row.bodyMarkdown).slice(0, 4000),
      };
    }
    if (input.targetType === "comment") {
      const [row] = await connection.select().from(comments).where(eq(comments.id, id));
      if (!row || row.status !== "published")
        throw new AppError("NOT_FOUND", "댓글을 찾을 수 없어요.");
      return {
        ownerId: row.authorId,
        label: row.isAnonymous ? "익명 사용자" : null,
        snapshot: row.bodyMarkdown.slice(0, 4000),
      };
    }
    if (input.targetType === "venue") {
      const [row] = await connection
        .select()
        .from(communityVenues)
        .where(eq(communityVenues.id, id));
      if (!row || row.status !== "published")
        throw new AppError("NOT_FOUND", "장소를 찾을 수 없어요.");
      return { ownerId: row.ownerId, label: null, snapshot: row.name + "\n" + row.description };
    }
    if (input.targetType === "crew") {
      const [row] = await connection.select().from(crews).where(eq(crews.id, id));
      if (!row) throw new AppError("NOT_FOUND", "크루를 찾을 수 없어요.");
      return { ownerId: row.ownerId, label: null, snapshot: row.name + "\n" + row.description };
    }
    const [row] = await connection.select().from(profiles).where(eq(profiles.publicId, id));
    if (!row) throw new AppError("NOT_FOUND", "플레이어를 찾을 수 없어요.");
    return { ownerId: row.id, label: row.nickname, snapshot: row.nickname + "\n" + row.bio };
  }
  const reportView = (row: typeof safetyReports.$inferSelect, staff = false): ReportView => ({
    id: row.id,
    targetType: row.targetType,
    targetId: row.targetId,
    reason: row.reason,
    detail: row.detail,
    status: row.status,
    // Staff notes may contain evidence or reporter details; members receive only the result.
    resolution: staff
      ? row.resolution
      : row.status === "actioned"
        ? "신고 내용을 검토하고 필요한 조치를 적용했어요."
        : row.status === "dismissed"
          ? "신고 내용의 검토가 완료되었어요."
          : "",
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    ...(staff ? { snapshot: row.snapshot } : {}),
  });
  async function report(actor: string | null, input: unknown) {
    const userId = await activeMember(actor),
      value = reportInputSchema.parse(input);
    await enforceRequestLimit(db, userId, "report", 10);
    if (value.targetType === "record") await assertRecordMediaAccess(db, value.targetId, userId);
    const found = await target(db, value);
    if (found.ownerId === userId)
      throw new AppError("VALIDATION", "본인의 콘텐츠는 신고할 수 없어요.");
    const rows = await db
      .insert(safetyReports)
      .values({ ...value, reporterId: userId, snapshot: found.snapshot })
      .onConflictDoNothing()
      .returning();
    if (!rows[0])
      throw new AppError(
        "CONFLICT",
        "이미 신고한 항목입니다. 내 신고 내역에서 진행 상태를 확인해주세요.",
      );
    return reportView(rows[0]);
  }
  async function reports(actor: string | null, staff = false, page = 1) {
    const userId = staff ? await requireStaff(actor) : requireActor(actor);
    const rows = await db
      .select()
      .from(safetyReports)
      .where(staff ? undefined : eq(safetyReports.reporterId, userId))
      .orderBy(desc(safetyReports.createdAt), desc(safetyReports.id))
      .limit(21)
      .offset((page - 1) * 20);
    return {
      items: rows.slice(0, 20).map((row) => reportView(row, staff)),
      hasMore: rows.length > 20,
      page,
    };
  }
  async function reportDetail(actor: string | null, id: string): Promise<ReportView> {
    await requireStaff(actor);
    const [row] = await db
      .select()
      .from(safetyReports)
      .where(eq(safetyReports.id, uuid.parse(id)));
    if (!row) throw new AppError("NOT_FOUND", "신고를 찾을 수 없어요.");
    return reportView(row, true);
  }
  async function ticketDetail(actor: string | null, id: string): Promise<SupportView> {
    const staffId = await requireStaff(actor),
      [row] = await db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.id, uuid.parse(id)));
    if (!row) throw new AppError("NOT_FOUND", "문의 내역을 찾을 수 없어요.");
    const [original] = row.originalActionId
      ? await db.select().from(moderationAudit).where(eq(moderationAudit.id, row.originalActionId))
      : [];
    const replies = await db
      .select({
        id: supportReplies.id,
        body: supportReplies.body,
        authorId: supportReplies.authorId,
        createdAt: supportReplies.createdAt,
      })
      .from(supportReplies)
      .where(eq(supportReplies.ticketId, row.id))
      .orderBy(supportReplies.createdAt, supportReplies.id);
    return {
      id: row.id,
      category: row.category,
      subject: row.subject,
      body: row.body,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      originalAction: original ? originalActionSummary(original) : null,
      canReply: !original || (original.actorId !== staffId && row.userId !== staffId),
      revision: row.revision,
      replies: replies.map((reply) => ({
        id: reply.id,
        body: reply.body,
        createdAt: reply.createdAt.toISOString(),
        role: reply.authorId === row.userId ? "member" : "staff",
      })),
    };
  }
  async function resolve(actor: string | null, id: string, input: unknown) {
    const staffId = await requireStaff(actor),
      value = moderationInputSchema.parse(input),
      reportId = uuid.parse(id);
    if (value.action === "reinstate") await requireStaff(actor, true);
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(safetyReports)
        .where(eq(safetyReports.id, reportId))
        .for("update");
      if (!row) throw new AppError("NOT_FOUND", "신고를 찾을 수 없어요.");
      if (row.status !== "open" && !["restore", "reinstate"].includes(value.action))
        throw new AppError("CONFLICT", "이미 처리된 신고입니다.");
      const found = await target(tx, row),
        now = new Date();
      if (["hide", "restore"].includes(value.action)) {
        if (row.targetType === "player")
          throw new AppError("VALIDATION", "플레이어 신고는 경고 또는 이용 제한으로 처리해주세요.");
        await tx
          .insert(contentRestrictions)
          .values({
            targetType: row.targetType,
            targetId: row.targetId,
            hidden: value.action === "hide",
            reason: value.reason,
            updatedBy: staffId,
          })
          .onConflictDoUpdate({
            target: [contentRestrictions.targetType, contentRestrictions.targetId],
            set: {
              hidden: value.action === "hide",
              reason: value.reason,
              updatedBy: staffId,
              updatedAt: now,
            },
          });
      } else if (value.action === "reinstate") {
        if (!found.ownerId) throw new AppError("NOT_FOUND", "회원을 찾을 수 없어요.");
        const restored = await tx
          .update(memberSafety)
          .set({ status: "active", reason: value.reason, suspendedUntil: null, updatedAt: now })
          .where(and(eq(memberSafety.userId, found.ownerId), eq(memberSafety.status, "suspended")))
          .returning();
        if (!restored.length) throw new AppError("CONFLICT", "이용 제한 중인 회원이 아닙니다.");
      } else if (value.action === "suspend" || value.action === "warn") {
        if (!found.ownerId)
          throw new AppError("VALIDATION", "탈퇴한 사용자는 계정 조치를 할 수 없어요.");
        const [targetStaff] = await tx
          .select()
          .from(staffRoles)
          .where(eq(staffRoles.userId, found.ownerId));
        if (targetStaff || found.ownerId === staffId)
          throw new AppError("FORBIDDEN", "운영자 계정은 이 화면에서 제재할 수 없어요.");
        const [existing] = await tx
          .select()
          .from(memberSafety)
          .where(eq(memberSafety.userId, found.ownerId))
          .for("update");
        if (existing?.status === "closed") throw new AppError("CONFLICT", "탈퇴한 계정입니다.");
        await tx
          .insert(memberSafety)
          .values({
            userId: found.ownerId,
            status: value.action === "suspend" ? "suspended" : "active",
            reason: value.reason,
            suspendedUntil:
              value.action === "suspend" ? new Date(now.getTime() + value.days * 86400000) : null,
          })
          .onConflictDoUpdate({
            target: memberSafety.userId,
            set:
              value.action === "suspend"
                ? {
                    status: "suspended",
                    reason: value.reason,
                    suspendedUntil: new Date(now.getTime() + value.days * 86400000),
                    updatedAt: now,
                  }
                : { reason: value.reason, updatedAt: now },
          });
      }
      await tx.insert(moderationAudit).values({
        actorId: staffId,
        affectedUserId: ["warn", "suspend", "hide"].includes(value.action) ? found.ownerId : null,
        action: value.action,
        targetType: row.targetType,
        targetId: row.targetId,
        reason: value.reason,
      });
      const [updated] = await tx
        .update(safetyReports)
        .set({
          status: value.action === "dismiss" ? "dismissed" : "actioned",
          resolution: value.reason,
          resolvedBy: staffId,
          resolvedAt: now,
        })
        .where(eq(safetyReports.id, reportId))
        .returning();
      if (!updated) throw new AppError("CONFLICT", "신고가 변경되었어요.");
      return reportView(updated, true);
    });
  }
  async function block(actor: string | null, input: unknown) {
    const userId = await activeMember(actor),
      value = targetSchema.parse(input),
      found = await target(db, value);
    if (!found.ownerId || found.ownerId === userId)
      throw new AppError("VALIDATION", "차단할 수 없는 사용자입니다.");
    const [profile] = await db
      .select({ nickname: profiles.nickname })
      .from(profiles)
      .where(eq(profiles.id, found.ownerId));
    const [row] = await db
      .insert(memberBlocks)
      .values({
        blockerId: userId,
        blockedId: found.ownerId,
        displayLabel: found.label ?? profile?.nickname ?? "사용자",
      })
      .onConflictDoUpdate({
        target: [memberBlocks.blockerId, memberBlocks.blockedId],
        set: { blockedId: found.ownerId },
      })
      .returning();
    if (!row) throw new AppError("CONFLICT", "차단 내역을 저장하지 못했어요.");
    return { id: row.id, label: row.displayLabel, createdAt: row.createdAt.toISOString() };
  }
  async function blocks(actor: string | null): Promise<BlockView[]> {
    const userId = requireActor(actor);
    return (
      await db
        .select()
        .from(memberBlocks)
        .where(eq(memberBlocks.blockerId, userId))
        .orderBy(desc(memberBlocks.createdAt))
        .limit(200)
    ).map((row) => ({
      id: row.id,
      label: row.displayLabel,
      createdAt: row.createdAt.toISOString(),
    }));
  }
  async function unblock(actor: string | null, id: string) {
    const userId = requireActor(actor);
    const rows = await db
      .delete(memberBlocks)
      .where(and(eq(memberBlocks.id, uuid.parse(id)), eq(memberBlocks.blockerId, userId)))
      .returning({ id: memberBlocks.id });
    if (!rows.length) throw new AppError("NOT_FOUND", "차단 내역을 찾을 수 없어요.");
    return { id };
  }
  async function account(actor: string | null) {
    const userId = requireActor(actor);
    const [state] = await db.select().from(memberSafety).where(eq(memberSafety.userId, userId));
    const status = membershipActive(state) ? "active" : state!.status;
    return {
      status,
      // Never project the internal moderation reason into a member account response.
      reason:
        status === "closed"
          ? "탈퇴 처리된 계정이에요."
          : status === "suspended"
            ? "커뮤니티 이용 기준에 따라 계정 이용이 제한되었어요. 이의신청 화면에서 재검토를 요청할 수 있어요."
            : state?.reason
              ? "계정 이용 상태에 관한 조치가 있었어요. 이의신청 화면에서 조치 내역을 확인할 수 있어요."
              : "",
      suspendedUntil: state?.suspendedUntil?.toISOString() ?? null,
      role: await role(userId),
      blocks: await blocks(userId),
    };
  }
  async function withdraw(actor: string | null) {
    const userId = await activeMember(actor);
    if (await role(userId))
      throw new AppError("CONFLICT", "운영 권한을 다른 담당자에게 이전한 뒤 탈퇴해주세요.");
    let photoObjectKey: string | null = null;
    let photoStorageBackend: "local" | "supabase" = "local";
    await db.transaction(async (tx) => {
      await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .for("update");
      const memberships = await tx
        .select({ crew: crews })
        .from(crews)
        .where(
          sql`(${crews.ownerId}=${userId} or exists(select 1 from sliper.crew_members m where m.crew_id=${crews.id} and m.user_id=${userId}))`,
        )
        .orderBy(crews.id)
        .for("update");
      if (memberships.some(({ crew }) => crew.ownerId === userId && crew.status === "active"))
        throw new AppError(
          "CONFLICT",
          "리더인 크루를 다른 멤버에게 양도하거나 보관한 뒤 탈퇴해주세요.",
        );
      for (const { crew } of memberships) {
        await tx.insert(crewActivity).values({
          crewId: crew.id,
          actorId: userId,
          kind: "left",
          message: "회원 탈퇴로 크루 참여를 정리했어요.",
        });
      }
      await tx.delete(crewMembers).where(eq(crewMembers.userId, userId));
      await tx
        .update(crewJoinRequests)
        .set({ status: "withdrawn", message: "회원 탈퇴", updatedAt: new Date() })
        .where(eq(crewJoinRequests.userId, userId));
      const [participation] = await tx
        .select({ id: eventApplications.id })
        .from(eventApplications)
        .leftJoin(eventSettings, eq(eventSettings.postId, eventApplications.postId))
        .where(
          and(
            eq(eventApplications.userId, userId),
            sql`(${eventApplications.status}='review' or (${eventApplications.status} in ('confirmed','pending_approval') and (${eventSettings.startsAt} is null or ${eventSettings.startsAt}>now())) or (${eventApplications.status}='pending_payment' and ${eventApplications.expiresAt}>now()))`,
          ),
        )
        .limit(1);
      const [hosting] = await tx
        .select({ pending: sql<boolean>`sliper.member_has_host_responsibility(${userId}::uuid)` })
        .from(profiles)
        .where(eq(profiles.id, userId));
      const [pendingRefund] = await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(
          and(
            eq(profiles.id, userId),
            sql`exists(select 1 from sliper.refund_requests r left join sliper.posts p on p.id=r.post_id where r.state='pending' and (r.user_id=${userId} or p.author_id=${userId}))`,
          ),
        )
        .limit(1);
      if (participation || hosting?.pending || pendingRefund)
        throw new AppError("CONFLICT", "진행 중인 신청·행사 또는 미처리 환불을 먼저 정리해주세요.");
      await tx
        .insert(memberSafety)
        .values({ userId, status: "closed", reason: "회원 탈퇴" })
        .onConflictDoUpdate({
          target: memberSafety.userId,
          set: {
            status: "closed",
            reason: "회원 탈퇴",
            suspendedUntil: null,
            updatedAt: new Date(),
          },
        });
      await tx
        .update(profiles)
        .set({
          nickname: "탈퇴한 회원",
          phoneNumber: null,
          phoneVerifiedAt: null,
          profileCompletedAt: null,
          onboardingConsentAt: null,
          bio: "",
          region: "",
          ageBand: null,
          gender: null,
          interests: [],
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, userId));
      const [removedPhoto] = await tx
        .delete(profilePhotos)
        .where(eq(profilePhotos.userId, userId))
        .returning({
          objectKey: profilePhotos.objectKey,
          storageBackend: profilePhotos.storageBackend,
        });
      photoObjectKey = removedPhoto?.objectKey ?? null;
      photoStorageBackend = removedPhoto?.storageBackend === "supabase" ? "supabase" : "local";
      await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
      await tx.delete(analyticsActivityDays).where(eq(analyticsActivityDays.userId, userId));
      await tx.delete(memberBlocks).where(eq(memberBlocks.blockerId, userId));
      await tx.delete(playerPreferences).where(eq(playerPreferences.userId, userId));
      await tx.delete(portfolioPreferences).where(eq(portfolioPreferences.userId, userId));
      await tx
        .update(eventCredits)
        .set({ status: "withdrawn", acceptedAt: null, updatedAt: new Date() })
        .where(eq(eventCredits.userId, userId));
      await tx
        .update(eventRecords)
        .set({ status: "withdrawn", updatedAt: new Date() })
        .where(eq(eventRecords.ownerId, userId));
      await tx
        .update(eventPrivateContacts)
        .set({
          enabled: false,
          channel: null,
          value: null,
          note: null,
          updatedBy: null,
          revision: sql`${eventPrivateContacts.revision}+1`,
          updatedAt: sql`statement_timestamp()`,
        })
        .where(
          sql`${eventPrivateContacts.postId} in (select id from sliper.posts where author_id=${userId}::uuid)`,
        );
      // Application/financial snapshots are immutable and retained for transaction handling.
    });
    return { withdrawn: true, photoObjectKey, photoStorageBackend };
  }
  async function tickets(
    actor: string | null,
    staff = false,
    page = 1,
  ): Promise<{ items: SupportView[]; hasMore: boolean; page: number }> {
    const userId = staff ? await requireStaff(actor) : requireActor(actor);
    if (!staff) {
      const [state] = await db
        .select({ status: memberSafety.status })
        .from(memberSafety)
        .where(eq(memberSafety.userId, userId));
      if (state?.status === "closed") throw new AppError("FORBIDDEN", "탈퇴한 계정입니다.");
    }
    const rows = await db
        .select()
        .from(supportTickets)
        .where(staff ? undefined : eq(supportTickets.userId, userId))
        .orderBy(desc(supportTickets.createdAt), desc(supportTickets.id))
        .limit(21)
        .offset((page - 1) * 20),
      shown = rows.slice(0, 20),
      ids = shown.flatMap((row) => (row.originalActionId ? [row.originalActionId] : [])),
      originals = ids.length
        ? await db.select().from(moderationAudit).where(inArray(moderationAudit.id, ids))
        : [],
      replies = shown.length
        ? await db
            .select()
            .from(supportReplies)
            .where(
              inArray(
                supportReplies.ticketId,
                shown.map((row) => row.id),
              ),
            )
            .orderBy(supportReplies.createdAt, supportReplies.id)
        : [];
    return {
      items: shown.map((row) => {
        const original = originals.find((item) => item.id === row.originalActionId);
        return {
          id: row.id,
          category: row.category,
          subject: row.subject,
          body: row.body,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          originalAction: original ? originalActionSummary(original) : null,
          canReply: staff && (!original || (original.actorId !== userId && row.userId !== userId)),
          revision: row.revision,
          replies: replies
            .filter((reply) => reply.ticketId === row.id)
            .map((reply) => ({
              id: reply.id,
              body: reply.body,
              createdAt: reply.createdAt.toISOString(),
              role: reply.authorId === row.userId ? ("member" as const) : ("staff" as const),
            })),
        };
      }),
      hasMore: rows.length > 20,
      page,
    };
  }
  async function createTicket(actor: string | null, input: unknown) {
    const userId = requireActor(actor),
      value = supportInputSchema.parse(input);
    const [state] = await db.select().from(memberSafety).where(eq(memberSafety.userId, userId));
    if (state?.status === "closed") throw new AppError("FORBIDDEN", "탈퇴한 계정입니다.");
    await enforceRequestLimit(db, userId, "support", 5);
    const [row] = await db
      .insert(supportTickets)
      .values({ userId, ...value })
      .returning({ id: supportTickets.id });
    return row;
  }
  async function reply(actor: string | null, id: string, input: unknown) {
    const staffId = await requireStaff(actor),
      ticketId = uuid.parse(id),
      value = z
        .strictObject({
          body: z.string().trim().min(5).max(3000),
          close: z.boolean().default(false),
          expectedRevision: z.number().int().min(1).max(2147483646).optional(),
        })
        .parse(input);
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.id, ticketId))
        .for("update");
      if (!row) throw new AppError("NOT_FOUND", "문의 내역이 없습니다.");
      if (row.originalActionId) {
        const [original] = await tx
          .select({ actorId: moderationAudit.actorId })
          .from(moderationAudit)
          .where(eq(moderationAudit.id, row.originalActionId));
        if (original?.actorId === staffId || row.userId === staffId)
          throw new AppError(
            "FORBIDDEN",
            "원조치 담당자 또는 신청 당사자는 이의신청에 답변할 수 없어요.",
          );
        if (value.expectedRevision === undefined)
          throw new AppError("VALIDATION", "이의신청의 최신 버전을 확인해주세요.");
      }
      if (value.expectedRevision !== undefined && value.expectedRevision !== row.revision)
        throw new AppError("CONFLICT", "새 의견이나 답변이 있어요. 최신 내용을 확인해주세요.");

      await tx.insert(supportReplies).values({ ticketId, authorId: staffId, body: value.body });
      await tx
        .update(supportTickets)
        .set({ status: value.close ? "closed" : "answered", updatedAt: new Date() })
        .where(eq(supportTickets.id, ticketId));
      await tx.insert(moderationAudit).values({
        actorId: staffId,
        action: "support_reply",
        targetType: "ticket",
        targetId: ticketId,
        reason: value.body.slice(0, 1000),
      });
    });
    return { id: ticketId };
  }
  async function reinstate(actor: string | null, publicId: string, reason: string) {
    const adminId = await requireStaff(actor, true),
      value = z.string().trim().min(5).max(1000).parse(reason);
    const [profile] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.publicId, uuid.parse(publicId)));
    if (!profile) throw new AppError("NOT_FOUND", "회원을 찾을 수 없어요.");
    await db.transaction(async (tx) => {
      const rows = await tx
        .update(memberSafety)
        .set({ status: "active", reason: value, suspendedUntil: null, updatedAt: new Date() })
        .where(and(eq(memberSafety.userId, profile.id), eq(memberSafety.status, "suspended")))
        .returning();
      if (!rows.length) throw new AppError("CONFLICT", "이용 제한 중인 회원이 아닙니다.");
      await tx.insert(moderationAudit).values({
        actorId: adminId,
        action: "reinstate",
        targetType: "player",
        targetId: publicId,
        reason: value,
      });
    });
    return { restored: true };
  }
  async function audit(actor: string | null, page = 1) {
    await requireStaff(actor);
    const rows = await db
      .select({
        id: moderationAudit.id,
        action: moderationAudit.action,
        targetType: moderationAudit.targetType,
        targetId: moderationAudit.targetId,
        reason: moderationAudit.reason,
        createdAt: moderationAudit.createdAt,
      })
      .from(moderationAudit)
      .orderBy(desc(moderationAudit.createdAt), desc(moderationAudit.id))
      .limit(21)
      .offset((page - 1) * 20);
    return {
      items: rows.slice(0, 20).map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      hasMore: rows.length > 20,
      page,
    };
  }
  return {
    role,
    activeMember,
    requireStaff,
    report,
    reports,
    reportDetail,
    ticketDetail,
    resolve,
    block,
    blocks,
    unblock,
    account,
    withdraw,
    tickets,
    createTicket,
    reply,
    reinstate,
    audit,
  };
}
