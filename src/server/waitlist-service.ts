import { resultRows } from "./saved-search-service";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/connection";
import { eventWaitlist } from "../db/growth-schema";
import { eventApplications, eventSettings, posts } from "../db/schema";
import type { WaitlistView } from "../domain/community-growth";
import { safetyService } from "./safety-service";
import { growthMemberVisible } from "./growth-policy";
import { contentVisible } from "./safety-visibility";
import { AppError } from "./errors";
import { insertInbox } from "./engagement-events";
import { enqueueInboxPush } from "./engagement-push-events";
import { enforceRequestLimit } from "./request-limits";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export const occupiedSeats = sql`(status='confirmed' or (status='pending_payment' and expires_at>statement_timestamp()))`;
export async function waitlistReservations(tx: Tx, postId: string, exceptUser?: string) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(eventWaitlist)
    .where(
      and(
        eq(eventWaitlist.postId, postId),
        sql`(state='offered' and offer_until>statement_timestamp() or state='submitted' and exists(select 1 from sliper.event_applications a where a.post_id=${eventWaitlist.postId} and a.user_id=${eventWaitlist.userId} and a.status='pending_approval'))`,
        exceptUser ? sql`${eventWaitlist.userId}<>${exceptUser}::uuid` : undefined,
      ),
    );
  return row!.n;
}
/** All callers must already hold the post row lock. Reservations share the application lock. */
export async function advanceWaitlist(tx: Tx, postId: string) {
  const [pending] = await tx
    .select({ id: eventWaitlist.id })
    .from(eventWaitlist)
    .where(and(eq(eventWaitlist.postId, postId), sql`state in ('waiting','offered')`))
    .limit(1);
  if (!pending) return;
  const [p] = await tx.select().from(posts).where(eq(posts.id, postId));
  const [e] = await tx.select().from(eventSettings).where(eq(eventSettings.postId, postId));
  if (!p || !e) return;
  await tx
    .update(eventWaitlist)
    .set({ state: "expired" })
    .where(
      and(
        eq(eventWaitlist.postId, postId),
        eq(eventWaitlist.state, "offered"),
        sql`offer_until<=statement_timestamp()`,
      ),
    );
  const [eligible] = await tx
    .select({ id: posts.id })
    .from(posts)
    .where(
      and(
        eq(posts.id, postId),
        eq(posts.status, "published"),
        contentVisible("post", posts.id),
        sql`${growthMemberVisible(posts.authorId, sql`null::uuid`)} and not exists(select 1 from sliper.event_lifecycle l where l.post_id=${postId} and l.cancelled_at is not null)`,
      ),
    );
  if (
    !eligible ||
    p.applicationUrl ||
    !e.open ||
    e.completedAt ||
    !e.startsAt ||
    e.startsAt <= new Date()
  ) {
    await tx
      .update(eventWaitlist)
      .set({ state: "cancelled" })
      .where(and(eq(eventWaitlist.postId, postId), sql`state in ('waiting','offered')`));
    return;
  }
  // Remove ineligible queue entries and members who applied by another route.
  await tx
    .update(eventWaitlist)
    .set({ state: "cancelled" })
    .where(
      and(
        eq(eventWaitlist.postId, postId),
        sql`state in ('waiting','offered') and (not (${growthMemberVisible(eventWaitlist.userId, sql`${p.authorId}::uuid`)}) or exists(select 1 from sliper.event_applications a where a.post_id=${postId} and a.user_id=${eventWaitlist.userId} and (a.status in ('confirmed','pending_approval','review') or (a.status='pending_payment' and a.expires_at>statement_timestamp()))))`,
      ),
    );
  const [used] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(eventApplications)
    .where(and(eq(eventApplications.postId, postId), occupiedSeats));
  const seats = e.capacity - used!.n - (await waitlistReservations(tx, postId));
  if (seats <= 0) return;
  const queue = await tx
    .select()
    .from(eventWaitlist)
    .where(and(eq(eventWaitlist.postId, postId), eq(eventWaitlist.state, "waiting")))
    .orderBy(asc(eventWaitlist.createdAt), asc(eventWaitlist.id))
    .limit(Math.min(seats, 100));
  for (const w of queue) {
    const until = new Date(Math.min(Date.now() + 2 * 3600000, e.startsAt.getTime()));
    await tx
      .update(eventWaitlist)
      .set({ state: "offered", offerUntil: until })
      .where(eq(eventWaitlist.id, w.id));
    const item = {
      recipientId: w.userId,
      postId,
      sourceId: w.id,
      kind: "participation" as const,
      dedupeKey: `waitlist:${w.id}:${w.createdAt.getTime()}`,
      title: "기다리던 모임에 자리가 생겼어요",
      body: "안내 기한 안에 신청서를 제출해주세요. 참가 확정은 기존 승인 절차를 따릅니다.",
      url: "/events/" + postId,
    };
    if ((await insertInbox(tx, item)).length) await enqueueInboxPush(tx, item, until);
  }
}
export function waitlistService(db: Database) {
  async function view(actor: string | null, postId: string): Promise<WaitlistView> {
    const user = await safetyService(db).activeMember(actor);
    z.uuid().parse(postId);
    const [e] = await db
      .select({ setting: eventSettings, post: posts })
      .from(eventSettings)
      .innerJoin(posts, eq(posts.id, eventSettings.postId))
      .where(
        and(
          eq(posts.id, postId),
          eq(posts.status, "published"),
          contentVisible("post", posts.id),
          growthMemberVisible(posts.authorId, sql`${user}::uuid`),
        ),
      );
    if (!e) throw new AppError("NOT_FOUND", "모임을 찾을 수 없어요.");
    const [w] = await db
      .select()
      .from(eventWaitlist)
      .where(and(eq(eventWaitlist.postId, postId), eq(eventWaitlist.userId, user)));
    const [n] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(eventWaitlist)
      .where(
        and(
          eq(eventWaitlist.postId, postId),
          eq(eventWaitlist.state, "waiting"),
          w
            ? sql`(created_at,id)<=(select own.created_at,own.id from sliper.event_waitlist own where own.id=${w.id}::uuid)`
            : sql`false`,
        ),
      );
    const [closed] = resultRows<{ closed: boolean }>(
      await db.execute(
        sql`select exists(select 1 from sliper.event_lifecycle where post_id=${postId} and cancelled_at is not null) closed`,
      ),
    );
    const [used] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(eventApplications)
      .where(and(eq(eventApplications.postId, postId), occupiedSeats));
    const reserved = await waitlistReservations(db as unknown as Tx, postId);
    return {
      full: used!.n + reserved >= e.setting.capacity,
      state: w?.state === "offered" && w.offerUntil! <= new Date() ? "expired" : (w?.state ?? null),
      position: w?.state === "waiting" ? n!.n : null,
      offerUntil: w?.offerUntil?.toISOString() ?? null,
      available:
        !e.post.applicationUrl &&
        e.setting.open &&
        !e.setting.completedAt &&
        !!e.setting.startsAt &&
        e.setting.startsAt > new Date() &&
        !closed?.closed &&
        e.post.authorId !== user,
    };
  }
  async function update(actor: string | null, postId: string, input: unknown) {
    const user = await safetyService(db).activeMember(actor),
      v = z.strictObject({ join: z.boolean() }).parse(input);
    z.uuid().parse(postId);
    await enforceRequestLimit(db, user, "waitlist", 30);
    await db.transaction(async (tx) => {
      const [p] = await tx.select().from(posts).where(eq(posts.id, postId)).for("update");
      if (!p) throw new AppError("NOT_FOUND", "모임을 찾을 수 없어요.");
      if (!v.join) {
        await tx
          .update(eventWaitlist)
          .set({ state: "cancelled" })
          .where(
            and(
              eq(eventWaitlist.postId, postId),
              eq(eventWaitlist.userId, user),
              sql`state in ('waiting','offered')`,
            ),
          );
        await advanceWaitlist(tx, postId);
        return;
      }
      // Use the same connection: no pool acquisition while holding the event lock.
      const state = await waitlistService(tx as unknown as Database).view(user, postId);
      if (!state.available) throw new AppError("CONFLICT", "지금은 대기 신청을 받을 수 없어요.");
      const [app] = await tx
        .select({ id: eventApplications.id })
        .from(eventApplications)
        .where(
          and(
            eq(eventApplications.postId, postId),
            eq(eventApplications.userId, user),
            sql`(status in ('confirmed','pending_approval','review') or (status='pending_payment' and expires_at>statement_timestamp()))`,
          ),
        );
      if (app) throw new AppError("CONFLICT", "이미 참가 신청 내역이 있어요.");
      if (state.state === "waiting" || state.state === "offered") return;
      const [e] = await tx.select().from(eventSettings).where(eq(eventSettings.postId, postId));
      const [n] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(eventApplications)
        .where(and(eq(eventApplications.postId, postId), occupiedSeats));
      if (n!.n + (await waitlistReservations(tx, postId)) < e!.capacity)
        throw new AppError("CONFLICT", "신청 가능한 자리가 있어요. 참가 신청서를 제출해주세요.");
      const [queued] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(eventWaitlist)
        .where(and(eq(eventWaitlist.postId, postId), eq(eventWaitlist.state, "waiting")));
      if (queued!.n >= 500) throw new AppError("CONFLICT", "대기 접수가 가득 찼어요.");
      await tx
        .insert(eventWaitlist)
        .values({ postId, userId: user })
        .onConflictDoUpdate({
          target: [eventWaitlist.postId, eventWaitlist.userId],
          set: {
            state: "waiting",
            createdAt: new Date(),
            nextScanAt: new Date(),
            offerUntil: null,
          },
        });
    });
    return view(user, postId);
  }
  async function scan() {
    const rows = await db
      .select({ postId: eventWaitlist.postId })
      .from(eventWaitlist)
      .where(sql`state in ('waiting','offered') and next_scan_at<=statement_timestamp()`)
      .groupBy(eventWaitlist.postId)
      .orderBy(sql`min(next_scan_at)`)
      .limit(100);
    for (const row of rows)
      await db.transaction(async (tx) => {
        const [p] = await tx
          .select({ id: posts.id })
          .from(posts)
          .where(eq(posts.id, row.postId))
          .for("update", { skipLocked: true });
        if (p) {
          await advanceWaitlist(tx, row.postId);
          await tx
            .update(eventWaitlist)
            .set({ nextScanAt: new Date(Date.now() + 60000) })
            .where(eq(eventWaitlist.postId, row.postId));
        }
      });
    return rows.length;
  }
  return { view, update, scan };
}
