import { posts } from "../db/schema";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import webpush from "web-push";
import type { Database } from "../db/connection";
import { pushDeliveries, pushSubscriptions } from "../db/push-schema";
import { engagementInboxEligibility } from "./engagement-eligibility";
import type { PushConfiguration } from "./push-configuration";
import { safePushPath, validPushEndpoint, validateSubscriptionKeys } from "./push-validation";

const LEASE_SECONDS = 120;
const MAX_ATTEMPTS = 6;
type Delivery = typeof pushDeliveries.$inferSelect;
type Subscription = typeof pushSubscriptions.$inferSelect;
export type PushSender = (
  subscription: Subscription,
  delivery: Delivery,
  config: PushConfiguration,
) => Promise<void>;
export const sendBrowserPush: PushSender = async (subscription, delivery, config) => {
  await webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
    JSON.stringify({
      title: delivery.title,
      body: delivery.body,
      url: delivery.url,
      tag: delivery.id,
    }),
    {
      vapidDetails: config,
      contentEncoding: "aes128gcm",
      timeout: 10_000,
      TTL: Math.max(
        1,
        Math.min(86400, Math.floor((delivery.expiresAt.getTime() - Date.now()) / 1000)),
      ),
      urgency: "normal",
      topic: createHash("sha256").update(delivery.id).digest("base64url").slice(0, 32),
    },
  );
};
export function pushFailure(error: unknown, attempt: number) {
  const status = Number((error as { statusCode?: number })?.statusCode) || 0;
  if (status === 404 || status === 410)
    return { remove: true, retry: false, delaySeconds: 0, code: "SUBSCRIPTION_EXPIRED" };
  const transient = !status || status === 408 || status === 429 || status >= 500;
  const header = (error as { headers?: Record<string, unknown> })?.headers?.["retry-after"];
  let retryAfter = 0;
  if (typeof header === "string") {
    const seconds = Number(header);
    retryAfter = Number.isFinite(seconds)
      ? seconds
      : Math.ceil((Date.parse(header) - Date.now()) / 1000);
  }
  return {
    remove: false,
    retry: transient && attempt < MAX_ATTEMPTS,
    delaySeconds: Math.min(
      3600,
      Math.max(30 * 2 ** Math.max(0, attempt - 1), Number.isFinite(retryAfter) ? retryAfter : 0),
    ),
    code: status ? "HTTP_" + status : "NETWORK_ERROR",
  };
}
export function pushDispatcher(
  db: Database,
  config: PushConfiguration,
  sender: PushSender = sendBrowserPush,
) {
  async function claim(limit: number) {
    const count = Math.min(20, Math.max(1, Math.floor(limit)));
    return db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: pushDeliveries.id })
        .from(pushDeliveries)
        .where(
          or(
            and(
              eq(pushDeliveries.status, "pending"),
              sql`${pushDeliveries.availableAt}<=statement_timestamp()`,
            ),
            and(
              eq(pushDeliveries.status, "processing"),
              sql`${pushDeliveries.lockedAt}<statement_timestamp()-${LEASE_SECONDS}*interval '1 second'`,
            ),
          ),
        )
        .orderBy(
          asc(pushDeliveries.availableAt),
          asc(pushDeliveries.createdAt),
          asc(pushDeliveries.id),
        )
        .limit(count)
        .for("update", { skipLocked: true });
      if (!rows.length) return [];
      return tx
        .update(pushDeliveries)
        .set({
          status: "processing",
          attempts: sql`least(${pushDeliveries.attempts}+1,100)`,
          lockedAt: sql`statement_timestamp()`,
          lockToken: randomUUID(),
          lastErrorCode: null,
        })
        .where(
          inArray(
            pushDeliveries.id,
            rows.map((row) => row.id),
          ),
        )
        .returning();
    });
  }
  async function finish(
    delivery: Delivery,
    status: "sent" | "failed" | "cancelled" | "pending",
    code: string | null,
    delay = 0,
  ) {
    await db
      .update(pushDeliveries)
      .set({
        status,
        lockedAt: null,
        lockToken: null,
        lastErrorCode: code,
        sentAt: status === "sent" ? sql`statement_timestamp()` : null,
        ...(status === "pending"
          ? { availableAt: sql`statement_timestamp()+${delay}*interval '1 second'` }
          : {}),
      })
      .where(
        and(
          eq(pushDeliveries.id, delivery.id),
          eq(pushDeliveries.status, "processing"),
          eq(pushDeliveries.lockToken, delivery.lockToken!),
        ),
      );
  }
  async function maySend(delivery: Delivery) {
    const applicationMatch =
      /^application:([0-9a-f-]{36}):(confirmed|refunded|cancelled|rejected|pending_approval|review)$/i.exec(
        delivery.dedupeKey,
      );
    const roomMatch = /^room:([0-9a-f-]{36})$/i.exec(delivery.dedupeKey);
    const eventChangeMatch = /^event-change:([0-9a-f-]{36})$/i.exec(delivery.dedupeKey);
    const engagementEligible = sql`exists(select 1 from sliper.inbox_items inbox
      where inbox.recipient_id=${delivery.recipientId}::uuid and inbox.post_id=${delivery.postId}::uuid
        and inbox.dedupe_key=${delivery.dedupeKey} and inbox.kind=${delivery.kind === "subscription" ? "subscriptions" : "reminders"}
        and ${engagementInboxEligibility({ recipientId: sql`inbox.recipient_id`, kind: sql`inbox.kind`, postId: sql`inbox.post_id`, sourceId: sql`inbox.source_id`, dedupeKey: sql`inbox.dedupe_key`, createdAt: sql`inbox.created_at` }, { delivery: true })})`;
    const sourceId =
      delivery.kind === "comment"
        ? delivery.commentId
        : delivery.kind === "announcement"
          ? roomMatch?.[1]
          : (eventChangeMatch?.[1] ?? applicationMatch?.[1]);
    const currentSourceEligible = ["comment", "announcement", "participation"].includes(
      delivery.kind,
    )
      ? engagementInboxEligibility(
          {
            recipientId: sql`${delivery.recipientId}::uuid`,
            kind: sql`${delivery.kind === "comment" ? "comments" : delivery.kind === "announcement" ? "announcements" : "participation"}`,
            postId: sql`${delivery.postId}::uuid`,
            sourceId: sql`${sourceId ?? null}::uuid`,
            dedupeKey: sql`${delivery.dedupeKey}`,
            createdAt: sql`${delivery.createdAt.toISOString()}::timestamptz`,
          },
          { delivery: true },
        )
      : sql`true`;
    const eligible =
      delivery.kind === "subscription" || delivery.kind === "reminder"
        ? engagementEligible
        : delivery.kind === "comment"
          ? sql`
      exists(select 1 from sliper.notifications n
        join sliper.comments c on c.id=n.comment_id and c.post_id=n.post_id
        join sliper.posts p on p.id=n.post_id
        where n.recipient_id=${delivery.recipientId}::uuid and n.comment_id=${delivery.commentId}::uuid
          and n.post_id=${delivery.postId}::uuid and p.status='published' and c.status='published')`
          : delivery.kind === "announcement" && roomMatch
            ? sql`
      exists(select 1 from sliper.posts p
        join sliper.room_messages message on message.post_id=p.id and message.id=${roomMatch[1]}::uuid
        where p.id=${delivery.postId}::uuid and p.status='published' and (
          p.author_id=${delivery.recipientId}::uuid
          or exists(select 1 from sliper.room_managers mgr where mgr.post_id=p.id and mgr.user_id=${delivery.recipientId}::uuid)
          or exists(select 1 from sliper.room_members m join sliper.event_applications a on a.id=m.application_id
            where m.post_id=p.id and m.user_id=${delivery.recipientId}::uuid and m.revoked_at is null and a.status='confirmed')
        ))`
            : delivery.kind === "participation" && eventChangeMatch
              ? sql`
      exists(select 1 from sliper.event_changes change
        join sliper.event_change_recipients recipient on recipient.change_id=change.id and recipient.post_id=change.post_id
        join sliper.posts p on p.id=change.post_id
        where change.id=${eventChangeMatch[1]}::uuid and change.post_id=${delivery.postId}::uuid
          and recipient.user_id=${delivery.recipientId}::uuid and p.status='published')`
              : delivery.kind === "participation" && applicationMatch
                ? sql`
      exists(select 1 from sliper.event_applications a join sliper.posts p on p.id=a.post_id
        where a.id=${applicationMatch[1]}::uuid and a.user_id=${delivery.recipientId}::uuid and a.post_id=${delivery.postId}::uuid
          and a.status=${applicationMatch[2]} and p.status='published'
          and (a.status<>'confirmed' or exists(select 1 from sliper.room_members m where m.application_id=a.id and m.revoked_at is null)))`
                : delivery.kind === "test"
                  ? sql`true`
                  : sql`false`;
    const [row] = await db
      .select({ id: pushDeliveries.id })
      .from(pushDeliveries)
      .where(
        and(
          eq(pushDeliveries.id, delivery.id),
          eq(pushDeliveries.status, "processing"),
          eq(pushDeliveries.lockToken, delivery.lockToken!),
          eligible,
          currentSourceEligible,
          sql`not exists(select 1 from sliper.member_safety state where state.user_id=${delivery.recipientId}::uuid and (state.status='closed' or (state.status='suspended' and (state.suspended_until is null or state.suspended_until>statement_timestamp()))))`,
          sql`${pushDeliveries.expiresAt}>statement_timestamp()`,
          sql`coalesce((select case
          when ${pushDeliveries.kind}='comment' then pref.comments
          when ${pushDeliveries.kind}='announcement' then pref.announcements
          when ${pushDeliveries.kind}='participation' then pref.participation
          when ${pushDeliveries.kind}='subscription' then pref.subscriptions
          when ${pushDeliveries.kind}='reminder' then pref.reminders
          else true end from sliper.push_preferences pref where pref.user_id=${delivery.recipientId}::uuid),true)`,
        ),
      );
    return !!row;
  }
  async function processDelivery(delivery: Delivery) {
    if (delivery.attempts > MAX_ATTEMPTS) {
      await finish(delivery, "failed", "ATTEMPTS_EXHAUSTED");
      return;
    }
    if (!safePushPath(delivery.url)) {
      await finish(delivery, "cancelled", "INVALID_DESTINATION");
      return;
    }
    const [subscription] = await db
      .select()
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.id, delivery.subscriptionId),
          eq(pushSubscriptions.userId, delivery.recipientId),
        ),
      );
    if (
      !subscription ||
      subscription.vapidPublicKey !== config.publicKey ||
      (subscription.expirationTime && subscription.expirationTime.getTime() <= Date.now()) ||
      !validPushEndpoint(subscription.endpoint)
    ) {
      await finish(delivery, "cancelled", "INVALID_SUBSCRIPTION");
      return;
    }
    try {
      validateSubscriptionKeys(subscription.p256dh, subscription.auth);
    } catch {
      await finish(delivery, "failed", "INVALID_KEYS");
      return;
    }
    if (!(await maySend(delivery))) {
      await finish(delivery, "cancelled", "NO_LONGER_ELIGIBLE");
      return;
    }
    try {
      const [source] = delivery.postId
        ? await db
            .select({ spoiler: posts.spoiler })
            .from(posts)
            .where(eq(posts.id, delivery.postId))
        : [];
      await sender(
        subscription,
        source?.spoiler
          ? {
              ...delivery,
              title: "스포일러 글에 새 활동이 있어요",
              body: "글을 펼쳐 내용을 확인해주세요.",
            }
          : delivery,
        config,
      );
      // "sent" means accepted by the push provider, not viewed on the device.
      await finish(delivery, "sent", null);
    } catch (error) {
      const failure = pushFailure(error, delivery.attempts);
      if (failure.remove) {
        await db
          .delete(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.id, subscription.id),
              eq(pushSubscriptions.p256dh, subscription.p256dh),
              eq(pushSubscriptions.auth, subscription.auth),
              eq(pushSubscriptions.vapidPublicKey, subscription.vapidPublicKey),
            ),
          );
        await finish(delivery, "cancelled", failure.code);
      } else
        await finish(
          delivery,
          failure.retry ? "pending" : "failed",
          failure.code,
          failure.delaySeconds,
        );
    }
  }
  async function drain(limit = 20) {
    const jobs = await claim(limit);
    let position = 0;
    const outcomes = await Promise.allSettled(
      Array.from({ length: Math.min(4, jobs.length) }, async () => {
        for (;;) {
          const delivery = jobs[position++];
          if (!delivery) return;
          await processDelivery(delivery);
        }
      }),
    );
    if (outcomes.some((result) => result.status === "rejected"))
      throw new Error("Push delivery batch requires lease recovery.");
    return { processed: jobs.length };
  }
  return { drain };
}
