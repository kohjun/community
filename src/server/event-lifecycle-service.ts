import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/connection";
import {
  eventApplications,
  eventSettings,
  posts,
  profiles,
  refundRequests,
  roomMessages,
} from "../db/schema";
import { eventAdmissions, admissionTickets } from "../db/event-operations-schema";
import { eventResults } from "../db/player-schema";
import { eventLifecycle, eventChanges, eventChangeRecipients } from "../db/event-lifecycle-schema";
import { memberSafety } from "../db/safety-schema";
import { membershipActive } from "../domain/safety";
import {
  eventChangeInputSchema,
  type EventChangeView,
  type EventLifecycleView,
  type EventNoticePage,
  type RefundCause,
} from "../domain/event-lifecycle";
import { AppError, requireActor } from "./errors";
import { assertContentVisible, authorVisible, contentVisible } from "./safety-visibility";
import { enforceRequestLimit } from "./request-limits";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryDb = Database | Tx;
export async function readEventLifecycle(db: QueryDb, postId: string) {
  const [row] = await db
    .select({ cancelledAt: eventLifecycle.cancelledAt, revision: eventLifecycle.revision })
    .from(eventLifecycle)
    .where(eq(eventLifecycle.postId, postId));
  return row ?? { cancelledAt: null, revision: 0 };
}
export async function isEventCancelled(db: QueryDb, postId: string) {
  return !!(await readEventLifecycle(db, postId)).cancelledAt;
}
export async function assertEventRunning(db: QueryDb, postId: string) {
  if (await isEventCancelled(db, postId))
    throw new AppError(
      "CONFLICT",
      "주최자가 취소한 행사예요. 변경 안내와 환불 내역을 확인해주세요.",
    );
}
export async function hostRefundCause(
  db: QueryDb,
  application: typeof eventApplications.$inferSelect,
): Promise<RefundCause> {
  if (await isEventCancelled(db, application.postId)) return "host_cancel";
  const [row] = await db
    .select({ id: eventChanges.id })
    .from(eventChangeRecipients)
    .innerJoin(eventChanges, eq(eventChanges.id, eventChangeRecipients.changeId))
    .innerJoin(eventSettings, eq(eventSettings.postId, eventChangeRecipients.postId))
    .where(
      and(
        eq(eventChangeRecipients.applicationId, application.id),
        eq(eventChanges.kind, "reschedule"),
        sql`${eventSettings.startsAt}>statement_timestamp()`,
        sql`not exists(select 1 from sliper.event_admissions a where a.application_id=${application.id})`,
      ),
    )
    .limit(1);
  return row ? "schedule_change" : "participant";
}
export function eventLifecycleService(db: Database, clock = () => new Date()) {
  async function active(user: string) {
    const [state] = await db.select().from(memberSafety).where(eq(memberSafety.userId, user));
    if (!membershipActive(state)) throw new AppError("FORBIDDEN", "계정 이용이 제한되어 있어요.");
  }
  const projected = {
    id: eventChanges.id,
    kind: eventChanges.kind,
    reason: eventChanges.reason,
    beforeStartsAt: eventChanges.beforeStartsAt,
    beforeEndsAt: eventChanges.beforeEndsAt,
    startsAt: eventChanges.startsAt,
    endsAt: eventChanges.endsAt,
    createdAt: eventChanges.createdAt,
  };
  function view(row: {
    id: string;
    kind: "cancel" | "reschedule";
    reason: string;
    beforeStartsAt: Date | null;
    beforeEndsAt: Date | null;
    startsAt: Date | null;
    endsAt: Date | null;
    createdAt: Date;
  }): EventChangeView {
    return {
      ...row,
      beforeStartsAt: row.beforeStartsAt?.toISOString() ?? null,
      beforeEndsAt: row.beforeEndsAt?.toISOString() ?? null,
      startsAt: row.startsAt?.toISOString() ?? null,
      endsAt: row.endsAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
  async function overview(
    actor: string | null,
    postId: string,
    page = 1,
  ): Promise<EventLifecycleView> {
    z.uuid().parse(postId);
    z.number().int().min(1).max(10000).parse(page);
    const [event] = await db
      .select({
        title: posts.title,
        authorId: posts.authorId,
        startsAt: eventSettings.startsAt,
        endsAt: eventSettings.endsAt,
      })
      .from(posts)
      .innerJoin(eventSettings, eq(eventSettings.postId, posts.id))
      .where(
        and(
          eq(posts.id, postId),
          eq(posts.status, "published"),
          eq(posts.kind, "모집"),
          contentVisible("post", posts.id),
          authorVisible(posts.authorId, actor),
        ),
      );
    if (!event) throw new AppError("NOT_FOUND", "행사를 찾을 수 없어요.");
    const state = await readEventLifecycle(db, postId);
    const rows = await db
      .select(projected)
      .from(eventChanges)
      .where(eq(eventChanges.postId, postId))
      .orderBy(desc(eventChanges.revision))
      .limit(21)
      .offset((page - 1) * 20);
    return {
      postId,
      title: event.title,
      canManage: !!actor && actor === event.authorId,
      cancelledAt: state.cancelledAt?.toISOString() ?? null,
      revision: state.revision,
      startsAt: event.startsAt?.toISOString() ?? null,
      endsAt: event.endsAt?.toISOString() ?? null,
      changes: rows.slice(0, 20).map(view),
      page,
      hasMore: rows.length > 20,
    };
  }
  async function change(actor: string | null, postId: string, input: unknown) {
    const user = requireActor(actor),
      value = eventChangeInputSchema.parse(input);
    await active(user);
    await assertContentVisible(db, "post", z.uuid().parse(postId));
    await enforceRequestLimit(db, user, "event_change", 20);
    await db.transaction(async (tx) => {
      const [post] = await tx.select().from(posts).where(eq(posts.id, postId)).for("update");
      if (!post || post.kind !== "모집" || post.status !== "published")
        throw new AppError("NOT_FOUND", "행사를 찾을 수 없어요.");
      if (post.authorId !== user)
        throw new AppError("FORBIDDEN", "행사 주최자만 취소·일정을 변경할 수 있어요.");
      const [settings] = await tx
        .select()
        .from(eventSettings)
        .where(eq(eventSettings.postId, postId));
      if (!settings) throw new AppError("CONFLICT", "먼저 행사 설정을 저장해주세요.");
      const state = await readEventLifecycle(tx, postId),
        now = clock();
      if (state.revision !== value.expectedRevision)
        throw new AppError(
          "CONFLICT",
          "행사 상태가 변경됐어요. 최신 안내를 확인한 뒤 다시 시도해주세요.",
        );
      if (state.cancelledAt)
        throw new AppError("CONFLICT", "취소된 행사는 다시 열거나 일정을 변경할 수 없어요.");
      if (settings.startsAt && settings.startsAt <= now)
        throw new AppError(
          "CONFLICT",
          "이미 시작한 행사는 이 화면에서 취소·일정을 변경할 수 없어요.",
        );
      const [entry] = await tx
        .select({ id: eventAdmissions.applicationId })
        .from(eventAdmissions)
        .where(eq(eventAdmissions.postId, postId))
        .limit(1);
      const [result] = await tx
        .select({ id: eventResults.applicationId })
        .from(eventResults)
        .where(eq(eventResults.postId, postId))
        .limit(1);
      if (entry || result)
        throw new AppError("CONFLICT", "입장이나 참가 전적이 기록된 행사는 변경할 수 없어요.");
      const starts = value.kind === "reschedule" ? new Date(value.startsAt) : settings.startsAt,
        ends = value.kind === "reschedule" ? new Date(value.endsAt) : settings.endsAt;
      if (value.kind === "reschedule") {
        if (!starts || !ends || starts <= now || ends <= starts)
          throw new AppError(
            "VALIDATION",
            "미래의 시작 시각과 그 이후의 종료 시각을 지정해주세요.",
          );
        if (
          starts.getTime() === settings.startsAt?.getTime() &&
          ends.getTime() === settings.endsAt?.getTime()
        )
          throw new AppError("VALIDATION", "현재 일정과 같은 일정이에요.");
        if (
          settings.meetupType === "lightning" &&
          (starts <= settings.createdAt ||
            starts.getTime() > settings.createdAt.getTime() + 7 * 86400000 ||
            ends.getTime() - starts.getTime() < 15 * 60000 ||
            ends.getTime() - starts.getTime() > 12 * 3600000)
        )
          throw new AppError(
            "VALIDATION",
            "번개는 개설 후 7일 이내, 15분~12시간 일정으로 변경해주세요.",
          );
      }
      const [record] = await tx
        .insert(eventChanges)
        .values({
          postId,
          kind: value.kind,
          revision: state.revision + 1,
          reason: value.reason,
          beforeStartsAt: settings.startsAt,
          beforeEndsAt: settings.endsAt,
          startsAt: starts,
          endsAt: ends,
          createdBy: user,
        })
        .returning();
      await tx.insert(eventChangeRecipients).select(
        tx
          .select({
            changeId: sql<string>`${record!.id}::uuid`.as("change_id"),
            applicationId: eventApplications.id,
            postId: eventApplications.postId,
            userId: eventApplications.userId,
            readAt: sql<Date | null>`null::timestamptz`.as("read_at"),
            createdAt: sql<Date>`statement_timestamp()`.as("created_at"),
          })
          .from(eventApplications)
          .where(
            and(
              eq(eventApplications.postId, postId),
              inArray(eventApplications.status, [
                "confirmed",
                "pending_payment",
                "pending_approval",
                "review",
              ]),
            ),
          ),
      );
      await tx
        .insert(eventLifecycle)
        .values({
          postId,
          revision: state.revision + 1,
          cancelledAt: value.kind === "cancel" ? now : null,
          cancellationReason: value.kind === "cancel" ? value.reason : "",
        })
        .onConflictDoUpdate({
          target: eventLifecycle.postId,
          set: {
            revision: state.revision + 1,
            cancelledAt: value.kind === "cancel" ? now : null,
            cancellationReason: value.kind === "cancel" ? value.reason : "",
            updatedAt: sql`statement_timestamp()`,
          },
        });
      if (value.kind === "reschedule") {
        await tx
          .update(eventSettings)
          .set({ startsAt: starts, endsAt: ends, updatedAt: sql`statement_timestamp()` })
          .where(eq(eventSettings.postId, postId));
        const pending = await tx
          .select()
          .from(refundRequests)
          .where(
            and(
              eq(refundRequests.postId, postId),
              eq(refundRequests.state, "pending"),
              eq(refundRequests.cause, "participant"),
            ),
          );
        if (pending.length) {
          await tx
            .update(refundRequests)
            .set({
              state: "rejected",
              processedBy: user,
              processedAt: sql`statement_timestamp()`,
              decisionNote: "주최자 일정 변경으로 전액 환불 요청을 새로 생성합니다.",
            })
            .where(
              inArray(
                refundRequests.id,
                pending.map((r) => r.id),
              ),
            );
          await tx.insert(refundRequests).values(
            pending.map((r) => ({
              applicationId: r.applicationId,
              postId,
              userId: r.userId,
              eventStartsAt: r.eventStartsAt,
              amountKRW: r.amountKRW,
              rate: 100,
              refundableKRW: r.amountKRW,
              reason: value.reason,
              cause: "schedule_change",
            })),
          );
        }
      } else {
        await tx
          .update(eventSettings)
          .set({ open: false, updatedAt: sql`statement_timestamp()` })
          .where(eq(eventSettings.postId, postId));
        // The quote is an immutable snapshot: preserve the old request, then create a full-refund request.
        await tx
          .update(refundRequests)
          .set({
            state: "rejected",
            processedBy: user,
            processedAt: sql`statement_timestamp()`,
            decisionNote: "주최자 행사 취소로 전액 환불 요청을 새로 생성합니다.",
          })
          .where(
            and(
              eq(refundRequests.postId, postId),
              eq(refundRequests.state, "pending"),
              sql`${refundRequests.cause}<>'host_cancel'`,
            ),
          );
        await tx
          .update(eventApplications)
          .set({ status: "review", updatedAt: sql`statement_timestamp()` })
          .where(
            and(
              eq(eventApplications.postId, postId),
              inArray(eventApplications.status, ["pending_payment", "pending_approval"]),
              sql`(exists(select 1 from sliper.payment_orders p where p.application_id=${eventApplications.id} and p.state='paid') or exists(select 1 from sliper.external_receipts r where r.application_id=${eventApplications.id} and r.state='paid'))`,
            ),
          );
        const paid = await tx
          .select()
          .from(eventApplications)
          .where(
            and(
              eq(eventApplications.postId, postId),
              sql`status in ('confirmed','review') and amount_krw>0 and (exists(select 1 from sliper.payment_orders p where p.application_id=${eventApplications.id} and p.state='paid' and p.amount_krw=${eventApplications.amountKRW}) or exists(select 1 from sliper.external_receipts r where r.application_id=${eventApplications.id} and r.state='paid' and r.amount_krw=${eventApplications.amountKRW}))`,
            ),
          );
        if (paid.length)
          await tx
            .insert(refundRequests)
            .values(
              paid.map((app) => ({
                applicationId: app.id,
                postId,
                userId: app.userId,
                eventStartsAt: app.eventStartsAt ?? settings.startsAt ?? now,
                amountKRW: app.amountKRW,
                rate: 100,
                refundableKRW: app.amountKRW,
                reason: value.reason,
                cause: "host_cancel",
              })),
            )
            .onConflictDoNothing();
        await tx
          .update(eventApplications)
          .set({
            status: "cancelled",
            updatedAt: sql`statement_timestamp()`,
            decisionNote: "주최자가 행사를 취소했습니다.",
          })
          .where(
            and(
              eq(eventApplications.postId, postId),
              inArray(eventApplications.status, ["pending_payment", "pending_approval"]),
              sql`not exists(select 1 from sliper.payment_orders p where p.application_id=${eventApplications.id} and p.state='paid') and not exists(select 1 from sliper.external_receipts r where r.application_id=${eventApplications.id} and r.state='paid')`,
            ),
          );
      }
      await tx
        .delete(admissionTickets)
        .where(
          sql`application_id in (select id from sliper.event_applications where post_id=${postId})`,
        );
      const schedule =
        starts && ends
          ? starts.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) +
            " ~ " +
            ends.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
          : "기존 일정";
      await tx.insert(roomMessages).values({
        postId,
        authorId: user,
        body:
          (value.kind === "cancel" ? "[행사 취소 안내]\n" : "[행사 일정 변경]\n") +
          value.reason +
          (value.kind === "reschedule"
            ? "\n변경 일정: " +
              schedule +
              "\n참가는 유지됩니다. 변경 일정 시작 전까지 전액 취소·환불을 요청할 수 있어요."
            : "\n유료 참가 내역은 전액 환불 검토로 접수되며 실제 환불은 외부 플랫폼에서 처리됩니다."),
      });
      await tx.execute(sql`insert into sliper.push_deliveries(subscription_id,recipient_id,dedupe_key,kind,post_id,title,body,url)
    select s.id,s.user_id,${"event-change:" + record!.id},'participation',${postId}::uuid,${value.kind === "cancel" ? "참가한 행사가 취소되었어요" : "참가한 행사의 일정이 변경됐어요"},'Sliper 내 참가 내역에서 안내와 환불 기준을 확인해주세요.','/participation'
    from sliper.push_subscriptions s left join sliper.push_preferences p on p.user_id=s.user_id
    where coalesce(p.participation,true) and (s.expiration_time is null or s.expiration_time>statement_timestamp()) and exists(select 1 from sliper.event_change_recipients r where r.change_id=${record!.id}::uuid and r.user_id=s.user_id)
    on conflict(subscription_id,dedupe_key) do nothing`);
    });
    return overview(user, postId);
  }
  async function notices(actor: string | null, page = 1): Promise<EventNoticePage> {
    const user = requireActor(actor);
    await active(user);
    z.number().int().min(1).max(10000).parse(page);
    const unread = sql<number>`(select count(distinct r.change_id)::int from sliper.event_change_recipients r join sliper.posts p on p.id=r.post_id where r.user_id=${user} and r.read_at is null and p.status='published' and not exists(select 1 from sliper.content_restrictions cr where cr.target_type='post' and cr.target_id=p.id and cr.hidden))`;
    const [stats] = await db.select({ unread }).from(profiles).where(eq(profiles.id, user));
    const rows = await db
      .select({
        ...projected,
        postId: eventChanges.postId,
        title: posts.title,
        readAt: sql<Date | null>`min(${eventChangeRecipients.readAt})`.mapWith(
          eventChangeRecipients.readAt,
        ),
      })
      .from(eventChangeRecipients)
      .innerJoin(eventChanges, eq(eventChanges.id, eventChangeRecipients.changeId))
      .innerJoin(posts, eq(posts.id, eventChangeRecipients.postId))
      .where(
        and(
          eq(eventChangeRecipients.userId, user),
          eq(posts.status, "published"),
          contentVisible("post", posts.id),
        ),
      )
      .groupBy(eventChanges.id, posts.title)
      .orderBy(desc(eventChanges.createdAt), desc(eventChanges.id))
      .limit(21)
      .offset((page - 1) * 20);
    return {
      items: rows.slice(0, 20).map((row) => ({
        ...view(row),
        postId: row.postId,
        title: row.title,
        readAt: row.readAt?.toISOString() ?? null,
      })),
      page,
      hasMore: rows.length > 20,
      unread: stats?.unread ?? 0,
    };
  }
  async function markRead(actor: string | null, postId: string, input: unknown) {
    const user = requireActor(actor),
      value = z.strictObject({ changeId: z.uuid() }).parse(input);
    await active(user);
    z.uuid().parse(postId);
    const rows = await db
      .update(eventChangeRecipients)
      .set({ readAt: sql`coalesce(read_at,statement_timestamp())` })
      .where(
        and(
          eq(eventChangeRecipients.changeId, value.changeId),
          eq(eventChangeRecipients.postId, postId),
          eq(eventChangeRecipients.userId, user),
        ),
      )
      .returning({ id: eventChangeRecipients.changeId });
    if (!rows.length) throw new AppError("NOT_FOUND", "본인의 변경 안내를 찾을 수 없어요.");
    return { read: true };
  }
  return { overview, change, notices, markRead };
}
