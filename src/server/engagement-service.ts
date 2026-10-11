import { and, asc, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/connection";
import { categorySubscriptions, hostSubscriptions, inboxItems } from "../db/engagement-schema";
import { profiles } from "../db/schema";
import {
  categorySubscriptionsSchema,
  hostSubscriptionSchema,
  inboxQuerySchema,
  inboxReadSchema,
  type HostSubscriptionView,
  type SubscriptionSettings,
  type UnifiedInboxPage,
} from "../domain/engagement";
import { AppError } from "./errors";
import {
  afterPosition,
  decodeCursor,
  encodeCursor,
  pageScope,
  preciseTimestamp,
} from "./pagination";
import { enforceRequestLimit } from "./request-limits";
import { safetyService } from "./safety-service";
import { engagementInboxEligibility } from "./engagement-eligibility";
import type { EngagementConnection } from "./engagement-events";

const hostVisible = (user: string) => sql`
  not exists(select 1 from sliper.member_safety state where state.user_id=${profiles.id}
    and (state.status='closed' or (state.status='suspended' and (state.suspended_until is null or state.suspended_until>statement_timestamp()))))
  and not exists(select 1 from sliper.member_blocks block where
    (block.blocker_id=${user}::uuid and block.blocked_id=${profiles.id})
    or (block.blocker_id=${profiles.id} and block.blocked_id=${user}::uuid))`;
const eligible = () =>
  engagementInboxEligibility({
    recipientId: inboxItems.recipientId,
    kind: inboxItems.kind,
    postId: inboxItems.postId,
    sourceId: inboxItems.sourceId,
    dedupeKey: inboxItems.dedupeKey,
    createdAt: inboxItems.createdAt,
  });
export function engagementService(db: Database) {
  const active = safetyService(db).activeMember;
  async function unreadCount(user: string) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(inboxItems)
      .where(and(eq(inboxItems.recipientId, user), isNull(inboxItems.readAt), eligible()));
    return row?.count ?? 0;
  }
  async function inbox(actor: string | null, input: unknown = {}): Promise<UnifiedInboxPage> {
    const user = await active(actor),
      q = inboxQuerySchema.parse(input),
      scope = pageScope(["unified-inbox", user, q.kind, ...(q.unreadOnly ? ["unread"] : [])]),
      cursor = decodeCursor(q.cursor, scope);
    const [rows, unread] = await Promise.all([
      db
        .select({
          item: inboxItems,
          timestamp: preciseTimestamp(inboxItems.createdAt),
          spoiler: sql<boolean>`exists(select 1 from sliper.posts p where p.id=${inboxItems.postId} and p.spoiler)`,
        })
        .from(inboxItems)
        .where(
          and(
            eq(inboxItems.recipientId, user),
            eligible(),
            q.kind === "all" ? undefined : eq(inboxItems.kind, q.kind),
            q.unreadOnly ? isNull(inboxItems.readAt) : undefined,
            cursor ? afterPosition(inboxItems.createdAt, inboxItems.id, cursor, "desc") : undefined,
          ),
        )
        .orderBy(desc(inboxItems.createdAt), desc(inboxItems.id))
        .limit(q.limit + 1),
      unreadCount(user),
    ]);
    const items = rows.slice(0, q.limit).map(({ item, timestamp, spoiler }) => ({
        id: item.id,
        kind: item.kind,
        title: spoiler ? "스포일러 글에 새 활동이 있어요" : item.title,
        body: spoiler ? "글을 펼쳐 내용을 확인해주세요." : item.body,
        url: item.url,
        createdAt: timestamp,
        readAt: item.readAt?.toISOString() ?? null,
      })),
      tail = items.at(-1);
    return {
      items,
      nextCursor: rows.length > q.limit && tail ? encodeCursor(scope, tail) : null,
      unreadCount: unread,
    };
  }
  async function markRead(actor: string | null, input: unknown = {}) {
    const user = await active(actor),
      value = inboxReadSchema.parse(input);
    if (value.id) {
      const [found] = await db
        .select({ id: inboxItems.id })
        .from(inboxItems)
        .where(and(eq(inboxItems.id, value.id), eq(inboxItems.recipientId, user), eligible()))
        .limit(1);
      if (!found) throw new AppError("NOT_FOUND", "내 알림을 찾을 수 없어요.");
    }
    const readAt = new Date();
    await db
      .update(inboxItems)
      .set({ readAt })
      .where(
        and(
          eq(inboxItems.recipientId, user),
          isNull(inboxItems.readAt),
          eligible(),
          sql`${inboxItems.createdAt}<=${readAt.toISOString()}::timestamptz`,
          value.id ? eq(inboxItems.id, value.id) : undefined,
        ),
      );
    return {
      id: value.id ?? null,
      readAt: readAt.toISOString(),
      unreadCount: await unreadCount(user),
    };
  }
  async function settings(user: string): Promise<SubscriptionSettings> {
    const [categoryRows, hosts] = await Promise.all([
      db
        .select({ slug: categorySubscriptions.categorySlug })
        .from(categorySubscriptions)
        .where(eq(categorySubscriptions.userId, user))
        .orderBy(asc(categorySubscriptions.categorySlug)),
      db
        .select({ publicId: profiles.publicId, nickname: profiles.nickname })
        .from(hostSubscriptions)
        .innerJoin(profiles, eq(profiles.id, hostSubscriptions.hostId))
        .where(and(eq(hostSubscriptions.userId, user), hostVisible(user)))
        .orderBy(asc(hostSubscriptions.createdAt), asc(profiles.publicId)),
    ]);
    return { categories: categoryRows.map((row) => row.slug), hosts };
  }
  async function subscriptions(actor: string | null) {
    return settings(await active(actor));
  }
  async function updateCategories(actor: string | null, input: unknown) {
    const user = await active(actor),
      value = categorySubscriptionsSchema.parse(input);
    await enforceRequestLimit(db, user, "subscriptions", 60);
    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, user))
        .for("update");
      if (!profile) throw new AppError("NOT_FOUND", "프로필을 먼저 만들어주세요.");
      await tx
        .delete(categorySubscriptions)
        .where(
          and(
            eq(categorySubscriptions.userId, user),
            value.categories.length
              ? notInArray(categorySubscriptions.categorySlug, value.categories)
              : undefined,
          ),
        );
      if (value.categories.length)
        await tx
          .insert(categorySubscriptions)
          .values(value.categories.map((categorySlug) => ({ userId: user, categorySlug })))
          .onConflictDoNothing();
    });
    return settings(user);
  }
  async function hostRow(connection: EngagementConnection, user: string, publicId: string) {
    const [row] = await connection
      .select({ id: profiles.id, publicId: profiles.publicId, nickname: profiles.nickname })
      .from(profiles)
      .where(and(eq(profiles.publicId, z.uuid().parse(publicId)), hostVisible(user)))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND", "이 호스트를 찾을 수 없어요.");
    return row;
  }
  async function host(actor: string | null, publicId: string): Promise<HostSubscriptionView> {
    const user = await active(actor),
      row = await hostRow(db, user, publicId);
    const [subscription] = await db
      .select({ hostId: hostSubscriptions.hostId })
      .from(hostSubscriptions)
      .where(and(eq(hostSubscriptions.userId, user), eq(hostSubscriptions.hostId, row.id)))
      .limit(1);
    return {
      publicId: row.publicId,
      nickname: row.nickname,
      subscribed: !!subscription,
      isMe: user === row.id,
    };
  }
  async function updateHost(actor: string | null, publicId: string, input: unknown) {
    const user = await active(actor),
      value = hostSubscriptionSchema.parse(input);
    await enforceRequestLimit(db, user, "subscriptions", 60);
    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, user))
        .for("update");
      if (!profile) throw new AppError("NOT_FOUND", "프로필을 먼저 만들어주세요.");
      const row = await hostRow(tx, user, publicId);
      if (user === row.id) throw new AppError("VALIDATION", "본인에게는 구독할 수 없어요.");
      if (value.subscribed) {
        const [existing] = await tx
          .select({ hostId: hostSubscriptions.hostId })
          .from(hostSubscriptions)
          .where(and(eq(hostSubscriptions.userId, user), eq(hostSubscriptions.hostId, row.id)));
        const [count] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(hostSubscriptions)
          .where(eq(hostSubscriptions.userId, user));
        if (!existing && (count?.count ?? 0) >= 200)
          throw new AppError("VALIDATION", "호스트는 최대 200명까지 구독할 수 있어요.");
        await tx
          .insert(hostSubscriptions)
          .values({ userId: user, hostId: row.id })
          .onConflictDoNothing();
      } else
        await tx
          .delete(hostSubscriptions)
          .where(and(eq(hostSubscriptions.userId, user), eq(hostSubscriptions.hostId, row.id)));
    });
    return host(user, publicId);
  }
  return { inbox, markRead, subscriptions, updateCategories, host, updateHost };
}
