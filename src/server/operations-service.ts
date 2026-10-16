import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { profiles } from "../db/schema";
import {
  libraryEntries,
  libraryPurchases,
  libraryPurchaseAudit,
  libraryPurchaseDisputes,
} from "../db/library-schema";
import {
  memberSafety,
  moderationAudit,
  safetyReports,
  staffRoles,
  supportTickets,
} from "../db/safety-schema";
import { membershipActive, REPORT_REASONS, SUPPORT_CATEGORIES } from "../domain/safety";
import {
  operationsKindSchema,
  operationsQuerySchema,
  operationsTriageSchema,
  type OperationsAction,
  type OperationsItem,
  type OperationsKind,
  type OperationsPage,
  type OperationsStage,
} from "../domain/operations";
import { uuidSchema } from "../domain/validation";
import { AppError, requireActor } from "./errors";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Staff = { user: string; role: "admin" | "moderator" };
const disputeCategories: Record<string, string> = {
  delivery: "자료 전달",
  terms: "이용 조건",
  payment: "결제 확인",
  other: "기타 분쟁",
};
const sourceTable = (kind: OperationsKind) =>
  kind === "report" ? safetyReports : kind === "support" ? supportTickets : libraryPurchaseDisputes;
export function operationsService(db: Database) {
  async function staff(tx: Tx, actor: string | null): Promise<Staff> {
    const user = requireActor(actor);
    const [row] = await tx
      .select({
        role: staffRoles.role,
        state: memberSafety.status,
        suspendedUntil: memberSafety.suspendedUntil,
      })
      .from(staffRoles)
      .leftJoin(memberSafety, eq(memberSafety.userId, staffRoles.userId))
      .where(eq(staffRoles.userId, user));
    if (
      !row ||
      !["admin", "moderator"].includes(row.role) ||
      !membershipActive({ status: row.state ?? "active", suspendedUntil: row.suspendedUntil })
    )
      throw new AppError("FORBIDDEN", "활성 운영자만 이용할 수 있어요.");
    return { user, role: row.role as Staff["role"] };
  }
  // Read current source states directly; triage metadata never duplicates a case status.
  function queue(user: string) {
    return sql`(
 select 'report'::text as kind,r.id,r.status as source_status,
 case when r.status<>'open' then 'completed' when r.review_started_at is not null then 'reviewing' else 'pending' end as stage,
 split_part(r.snapshot,E'\n',1) as title,left(r.detail,400) as summary,r.reason as category,r.created_at,r.revision,r.assigned_to,r.review_started_at,r.due_at,
 nullif(r.resolution,'') as response_body,r.resolved_at as response_at,
 null::uuid as purchase_id,false as review_blocked from sliper.safety_reports r
 union all
 select 'support',t.id,t.status,
 case when t.status<>'open' then 'completed' when t.review_started_at is not null then 'reviewing' else 'pending' end,
 t.subject,left(t.body,400),t.category,t.created_at,t.revision,t.assigned_to,t.review_started_at,t.due_at,
 (select x.body from sliper.support_replies x where x.ticket_id=t.id and x.author_id is distinct from t.user_id order by x.created_at desc,x.id desc limit 1),
 (select x.created_at from sliper.support_replies x where x.ticket_id=t.id and x.author_id is distinct from t.user_id order by x.created_at desc,x.id desc limit 1),null::uuid,(t.original_action_id is not null and (t.user_id=${user}::uuid or exists(select 1 from sliper.moderation_audit a where a.id=t.original_action_id and a.actor_id=${user}::uuid))) from sliper.support_tickets t
 union all
 select 'dispute',d.id,d.status,
 case when d.status<>'open' then 'completed' when d.review_started_at is not null then 'reviewing' else 'pending' end,
 p.snapshot->>'title',left(d.body,400),d.kind,d.created_at,d.revision,d.assigned_to,d.review_started_at,d.due_at,
 coalesce(nullif(d.resolution_note,''),nullif(d.seller_response,'')),case when d.resolution_note<>'' then d.resolved_at else null end,p.id,false
 from sliper.library_purchase_disputes d join sliper.library_purchases p on p.id=d.purchase_id
 where p.buyer_id is distinct from ${user}::uuid and p.seller_id is distinct from ${user}::uuid
 ) as q`;
  }
  function rows(tx: Tx, user: string, condition?: ReturnType<typeof and>) {
    return tx
      .select({
        kind: sql<OperationsKind>`q.kind`,
        reviewBlocked: sql<boolean>`q.review_blocked`,
        id: sql<string>`q.id`,
        sourceStatus: sql<string>`q.source_status`,
        stage: sql<OperationsStage>`q.stage`,
        title: sql<string>`q.title`,
        summary: sql<string>`q.summary`,
        category: sql<string>`q.category`,
        createdAt: sql<string>`to_char(q.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        revision: sql<number>`q.revision`,
        assignedId: sql<string | null>`q.assigned_to`,
        reviewStartedAt: sql<
          string | null
        >`to_char(q.review_started_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        dueAt: sql<
          string | null
        >`to_char(q.due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        responseBody: sql<string | null>`q.response_body`,
        responseAt: sql<
          string | null
        >`to_char(q.response_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        purchaseId: sql<string | null>`q.purchase_id`,
        assigneePublicId: profiles.publicId,
        assigneeName: profiles.nickname,
        assigneeRole: staffRoles.role,
        assigneeState: memberSafety.status,
        assigneeSuspendedUntil: memberSafety.suspendedUntil,
      })
      .from(queue(user))
      .leftJoin(profiles, sql`${profiles.id}=q.assigned_to`)
      .leftJoin(memberSafety, eq(memberSafety.userId, profiles.id))
      .leftJoin(staffRoles, eq(staffRoles.userId, profiles.id))
      .where(condition);
  }
  type Row = Awaited<ReturnType<typeof rows>>[number];
  function view(row: Row, actor: Staff): OperationsItem {
    const mine = row.assignedId === actor.user,
      open = row.sourceStatus === "open",
      allowedActions: OperationsAction[] = [];
    if (open && !row.reviewBlocked) {
      if (!row.assignedId) allowedActions.push("claim");
      if (mine && !row.reviewStartedAt) allowedActions.push("start_review");
      if (row.assignedId && (mine || actor.role === "admin")) allowedActions.push("release");
      if (mine || actor.role === "admin") allowedActions.push("set_due");
    }
    return {
      kind: row.kind,
      id: row.id,
      sourceStatus: row.sourceStatus,
      stage: row.stage,
      title: row.title || "제목 없는 접수",
      summary: row.summary,
      category:
        row.kind === "report"
          ? (REPORT_REASONS[row.category as keyof typeof REPORT_REASONS] ?? row.category)
          : row.kind === "support"
            ? (SUPPORT_CATEGORIES[row.category as keyof typeof SUPPORT_CATEGORIES] ?? row.category)
            : (disputeCategories[row.category] ?? row.category),
      createdAt: row.createdAt,
      revision: Number(row.revision),
      assignee:
        row.assignedId && row.assigneePublicId
          ? {
              publicId: row.assigneePublicId,
              nickname: row.assigneeName ?? "탈퇴한 운영자",
              isMine: mine,
              active:
                !!row.assigneeRole &&
                membershipActive({
                  status: row.assigneeState ?? "active",
                  suspendedUntil: row.assigneeSuspendedUntil,
                }),
            }
          : null,
      reviewStartedAt: row.reviewStartedAt,
      dueAt: row.dueAt,
      lastResponse: row.responseBody ? { body: row.responseBody, at: row.responseAt } : null,
      href:
        row.kind === "dispute"
          ? `/archive/purchases/${row.purchaseId}#dispute-${row.id}`
          : `/admin?tab=${row.kind === "report" ? "reports" : "support"}&id=${row.id}`,
      allowedActions,
      canTriage: allowedActions.length > 0,
      reviewRestriction: row.reviewBlocked
        ? "원조치 담당자 또는 신청 당사자는 이 검토를 처리할 수 없어요. 다른 운영자가 검토합니다."
        : null,
    };
  }
  async function disputeContext(tx: Tx, user: string, id: string, lock: boolean) {
    const [key] = await tx
      .select({ purchaseId: libraryPurchaseDisputes.purchaseId, entryId: libraryPurchases.entryId })
      .from(libraryPurchaseDisputes)
      .innerJoin(libraryPurchases, eq(libraryPurchases.id, libraryPurchaseDisputes.purchaseId))
      .where(eq(libraryPurchaseDisputes.id, id));
    if (!key) throw new AppError("NOT_FOUND", "분쟁 접수를 찾을 수 없어요.");
    if (lock)
      await tx
        .select({ id: libraryEntries.id })
        .from(libraryEntries)
        .where(eq(libraryEntries.id, key.entryId))
        .for("update");
    const select = tx
      .select()
      .from(libraryPurchases)
      .where(eq(libraryPurchases.id, key.purchaseId));
    const [purchase] = lock ? await select.for("update") : await select;
    if (!purchase) throw new AppError("NOT_FOUND", "구매 내역을 찾을 수 없어요.");
    if (purchase.buyerId === user || purchase.sellerId === user)
      throw new AppError("FORBIDDEN", "본인 거래의 분쟁은 다른 운영자가 처리해야 해요.");
    return purchase;
  }
  async function read(tx: Tx, actor: Staff, kind: OperationsKind, id: string) {
    const [row] = await rows(tx, actor.user, and(sql`q.kind=${kind}`, sql`q.id=${id}::uuid`));
    if (!row) throw new AppError("NOT_FOUND", "접수를 찾을 수 없어요.");
    return view(row, actor);
  }
  return {
    async list(actor: string | null, input: unknown = {}): Promise<OperationsPage> {
      const value = operationsQuerySchema.parse(input);
      return db.transaction(
        async (tx) => {
          const authorized = await staff(tx, actor),
            base = and(
              value.kind !== "all" ? sql`q.kind=${value.kind}` : undefined,
              value.assignment === "mine"
                ? sql`q.assigned_to=${authorized.user}::uuid`
                : value.assignment === "unassigned"
                  ? sql`q.assigned_to is null`
                  : undefined,
            );
          const [counts] = await tx
            .select({
              pending: sql<number>`count(*) filter(where q.stage='pending')::int`,
              reviewing: sql<number>`count(*) filter(where q.stage='reviewing')::int`,
              completed: sql<number>`count(*) filter(where q.stage='completed')::int`,
            })
            .from(queue(authorized.user))
            .where(base);
          const tallies = {
              pending: Number(counts?.pending ?? 0),
              reviewing: Number(counts?.reviewing ?? 0),
              completed: Number(counts?.completed ?? 0),
            },
            total =
              value.stage === "all"
                ? tallies.pending + tallies.reviewing + tallies.completed
                : tallies[value.stage],
            pageCount = Math.max(1, Math.ceil(total / 20)),
            page = Math.min(value.page, pageCount),
            condition = and(base, value.stage !== "all" ? sql`q.stage=${value.stage}` : undefined);
          const items = await rows(tx, authorized.user, condition)
            .orderBy(sql`q.created_at desc`, sql`q.id desc`, sql`q.kind desc`)
            .limit(20)
            .offset((page - 1) * 20);
          return {
            items: items.map((row) => view(row, authorized)),
            total,
            page,
            pageCount,
            counts: tallies,
            role: authorized.role,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
    async detail(actor: string | null, kindInput: string, idInput: string) {
      const kind = operationsKindSchema.parse(kindInput),
        id = uuidSchema.parse(idInput);
      return db.transaction(
        async (tx) => {
          const authorized = await staff(tx, actor);
          if (kind === "dispute") await disputeContext(tx, authorized.user, id, false);
          return read(tx, authorized, kind, id);
        },
        { accessMode: "read only" },
      );
    },
    async triage(actor: string | null, kindInput: string, idInput: string, input: unknown) {
      const kind = operationsKindSchema.parse(kindInput),
        id = uuidSchema.parse(idInput),
        value = operationsTriageSchema.parse(input);
      if (value.action === "set_due" && value.dueAt && new Date(value.dueAt) <= new Date())
        throw new AppError("VALIDATION", "처리 목표 시각은 현재보다 늦게 설정해주세요.");
      return db.transaction(async (tx) => {
        const authorized = await staff(tx, actor),
          purchase =
            kind === "dispute" ? await disputeContext(tx, authorized.user, id, true) : null,
          table = sourceTable(kind);
        const [source] = await tx
          .select({
            status: table.status,
            revision: table.revision,
            assignedTo: table.assignedTo,
            reviewStartedAt: table.reviewStartedAt,
            dueAt: table.dueAt,
          })
          .from(table)
          .where(eq(table.id, id))
          .for("update");
        if (!source) throw new AppError("NOT_FOUND", "접수를 찾을 수 없어요.");
        if (source.revision !== value.expectedRevision || source.status !== "open")
          throw new AppError(
            "CONFLICT",
            "접수 상태가 변경되었거나 이미 처리되었어요. 최신 내용을 불러와주세요.",
          );
        const item = await read(tx, authorized, kind, id);
        if (!item.allowedActions.includes(value.action))
          throw new AppError("FORBIDDEN", "본인 담당 접수의 운영 작업만 처리할 수 있어요.");
        const patch =
          value.action === "claim"
            ? { assignedTo: authorized.user }
            : value.action === "release"
              ? { assignedTo: null }
              : value.action === "start_review"
                ? { reviewStartedAt: sql`clock_timestamp()` }
                : { dueAt: value.dueAt ? new Date(value.dueAt) : null };
        await staff(tx, actor);
        await tx
          .update(table)
          .set(patch)
          .where(and(eq(table.id, id), eq(table.revision, value.expectedRevision)));
        const reason =
          value.action === "set_due"
            ? value.dueAt
              ? `처리 목표 시각을 ${new Date(value.dueAt).toISOString()}로 변경했습니다.`
              : "처리 목표 시각을 해제했습니다."
            : value.action === "claim"
              ? "담당 운영자가 접수를 맡았습니다."
              : value.action === "release"
                ? "담당 운영자를 해제했습니다."
                : "담당 운영자가 검토를 시작했습니다.";
        await tx.insert(moderationAudit).values({
          actorId: authorized.user,
          action: `ops_${value.action}`,
          targetType: kind === "report" ? "report" : kind === "support" ? "ticket" : "dispute",
          targetId: id,
          reason,
        });
        if (purchase)
          await tx.insert(libraryPurchaseAudit).values({
            purchaseId: purchase.id,
            actorId: authorized.user,
            action: `operations_${value.action}`,
            note: reason,
          });
        return read(tx, authorized, kind, id);
      });
    },
  };
}
