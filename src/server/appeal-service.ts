import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { profiles } from "../db/schema";
import { memberSafety, moderationAudit, supportReplies, supportTickets } from "../db/safety-schema";
import {
  APPEAL_ACTION_TYPES,
  APPEAL_PUBLIC_REASONS,
  APPEAL_SCOPE_LABELS,
  APPEAL_ACTION_LABELS,
  appealQuerySchema,
  appealSubmissionSchema,
  type AppealOriginalAction,
  type AppealAction,
  type AppealActionType,
  type AppealPage,
  type AppealTicket,
  type AppealSubmission,
} from "../domain/appeals";
import { AppError, requireActor } from "./errors";
import { enforceRequestLimit } from "./request-limits";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Connection = Database | Tx;
type Original = typeof moderationAudit.$inferSelect;
export function originalActionSummary(
  row: Pick<Original, "id" | "action" | "targetType" | "createdAt">,
): AppealOriginalAction {
  const type = row.action as AppealActionType;
  return {
    id: row.id,
    type,
    scope: APPEAL_SCOPE_LABELS[row.targetType] ?? "콘텐츠",
    reason: APPEAL_PUBLIC_REASONS[type],
    createdAt: row.createdAt.toISOString(),
  };
}
// The recipient is captured with the original action; later content/crew transfers never move it.
function ownership(user: string) {
  return eq(moderationAudit.affectedUserId, user);
}
export function appealService(db: Database) {
  async function member(connection: Connection, actor: string | null, lock = false) {
    const user = requireActor(actor),
      query = connection.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, user));
    const [profile] = lock ? await query.for("share") : await query;
    if (!profile) throw new AppError("FORBIDDEN", "회원 정보를 확인할 수 없어요.");
    const stateQuery = connection
      .select({ status: memberSafety.status })
      .from(memberSafety)
      .where(eq(memberSafety.userId, user));
    const [state] = lock ? await stateQuery.for("share") : await stateQuery;
    if (state?.status === "closed")
      throw new AppError("FORBIDDEN", "탈퇴한 계정은 이의신청을 이용할 수 없어요.");
    return user;
  }
  function eligible(user: string, id?: string) {
    return and(
      inArray(moderationAudit.action, [...APPEAL_ACTION_TYPES]),
      ownership(user),
      id ? eq(moderationAudit.id, id) : undefined,
    );
  }
  async function action(tx: Tx, user: string, id: string, lock = false) {
    const q = tx.select().from(moderationAudit).where(eligible(user, id));
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw new AppError("NOT_FOUND", "본인에게 적용된 조치를 찾을 수 없어요.");
    return row;
  }
  async function ticketView(
    tx: Tx,
    ticket: typeof supportTickets.$inferSelect,
  ): Promise<AppealTicket> {
    const replies = await tx
      .select({
        id: supportReplies.id,
        body: supportReplies.body,
        authorId: supportReplies.authorId,
        createdAt: supportReplies.createdAt,
      })
      .from(supportReplies)
      .where(eq(supportReplies.ticketId, ticket.id))
      .orderBy(supportReplies.createdAt, supportReplies.id);
    return {
      id: ticket.id,
      body: ticket.body,
      status: ticket.status as AppealTicket["status"],
      revision: ticket.revision,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      replies: replies.map((reply) => ({
        id: reply.id,
        body: reply.body,
        createdAt: reply.createdAt.toISOString(),
        role: reply.authorId === ticket.userId ? "member" : "staff",
      })),
    };
  }
  async function view(tx: Tx, user: string, original: Original): Promise<AppealAction> {
    const [ticket] = await tx
      .select()
      .from(supportTickets)
      .where(
        and(eq(supportTickets.userId, user), eq(supportTickets.originalActionId, original.id)),
      );
    return {
      ...originalActionSummary(original),
      ticket: ticket ? await ticketView(tx, ticket) : null,
    };
  }
  return {
    async list(actor: string | null, input: unknown = {}): Promise<AppealPage> {
      const query = appealQuerySchema.parse(input);
      return db.transaction(
        async (tx) => {
          const user = await member(tx, actor);
          if (query.actionId)
            return {
              items: [await view(tx, user, await action(tx, user, query.actionId))],
              page: 1,
              pageCount: 1,
              total: 1,
            };
          const condition = eligible(user),
            [count] = await tx
              .select({ total: sql<number>`count(*)::int` })
              .from(moderationAudit)
              .where(condition),
            total = Number(count?.total ?? 0),
            pageCount = Math.max(1, Math.ceil(total / 20)),
            page = Math.min(query.page, pageCount);
          const originals = await tx
            .select()
            .from(moderationAudit)
            .where(condition)
            .orderBy(desc(moderationAudit.createdAt), desc(moderationAudit.id))
            .limit(20)
            .offset((page - 1) * 20);
          const items: AppealAction[] = [];
          for (const original of originals) items.push(await view(tx, user, original));
          return { items, page, pageCount, total };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
    async submit(actor: string | null, input: unknown): Promise<AppealSubmission> {
      const value = appealSubmissionSchema.parse(input);
      return db.transaction(async (tx) => {
        const user = await member(tx, actor, true);
        if (value.mode === "open") {
          const original = await action(tx, user, value.actionId, true);
          const [existing] = await tx
            .select()
            .from(supportTickets)
            .where(
              and(
                eq(supportTickets.userId, user),
                eq(supportTickets.originalActionId, original.id),
              ),
            )
            .for("update");
          if (existing) return { action: await view(tx, user, original), reused: true };
          await enforceRequestLimit(tx as unknown as Database, user, "appeal_open", 5);
          const [ticket] = await tx
            .insert(supportTickets)
            .values({
              userId: user,
              originalActionId: original.id,
              category: "account",
              subject: `${APPEAL_ACTION_LABELS[original.action as AppealActionType]} 조치 재검토 요청`,
              body: value.body,
            })
            .returning({ id: supportTickets.id });
          await tx.insert(moderationAudit).values({
            actorId: user,
            action: "appeal_open",
            targetType: "ticket",
            targetId: ticket!.id,
            reason: "회원이 본인 조치의 재검토를 요청했습니다.",
          });
          return { action: await view(tx, user, original), reused: false };
        }
        const [key] = await tx
          .select({ originalActionId: supportTickets.originalActionId })
          .from(supportTickets)
          .where(and(eq(supportTickets.id, value.ticketId), eq(supportTickets.userId, user)));
        if (!key?.originalActionId)
          throw new AppError("NOT_FOUND", "본인의 이의신청을 찾을 수 없어요.");
        const original = await action(tx, user, key.originalActionId, true);
        const [ticket] = await tx
          .select()
          .from(supportTickets)
          .where(
            and(
              eq(supportTickets.id, value.ticketId),
              eq(supportTickets.userId, user),
              eq(supportTickets.originalActionId, original.id),
            ),
          )
          .for("update");
        if (!ticket) throw new AppError("NOT_FOUND", "본인의 이의신청을 찾을 수 없어요.");
        if (ticket.revision !== value.expectedRevision)
          throw new AppError(
            "CONFLICT",
            "이의신청에 새 답변이나 변경이 있어요. 최신 내용을 확인해주세요.",
          );
        await enforceRequestLimit(tx as unknown as Database, user, "appeal_followup", 10);
        await tx
          .insert(supportReplies)
          .values({ ticketId: ticket.id, authorId: user, body: value.body });
        await tx
          .update(supportTickets)
          .set({
            status: "open",
            updatedAt: sql`greatest(clock_timestamp(),${supportTickets.updatedAt}+interval '1 microsecond')`,
          })
          .where(
            and(
              eq(supportTickets.id, ticket.id),
              eq(supportTickets.revision, value.expectedRevision),
            ),
          );
        await tx.insert(moderationAudit).values({
          actorId: user,
          action: "appeal_followup",
          targetType: "ticket",
          targetId: ticket.id,
          reason: "회원이 기존 이의신청에 추가 의견을 보냈습니다.",
        });
        return { action: await view(tx, user, original), reused: false };
      });
    },
  };
}
