import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { profiles } from "../db/schema";
import { pushDeliveries, pushPreferences, pushSubscriptions } from "../db/push-schema";
import {
  DEFAULT_PUSH_PREFERENCES,
  endpointInputSchema,
  pushPreferencesSchema,
  pushSubscriptionSchema,
  type PushSettingsView,
} from "../domain/push";
import { AppError, requireActor } from "./errors";
import { pushConfiguration, type PushConfiguration } from "./push-configuration";
import { validPushEndpoint, validateSubscriptionKeys } from "./push-validation";

export function pushService(db: Database, config: PushConfiguration | null = pushConfiguration()) {
  async function lockUser(tx: Parameters<Parameters<Database["transaction"]>[0]>[0], user: string) {
    const [row] = await tx
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.id, user))
      .for("no key update");
    if (!row) throw new AppError("UNAUTHENTICATED", "회원 정보를 확인해주세요.");
  }
  async function settings(actor: string | null, device?: string | null): Promise<PushSettingsView> {
    const user = requireActor(actor);
    if (device && !/^[a-f0-9]{64}$/.test(device))
      throw new AppError("VALIDATION", "기기 정보가 올바르지 않아요.");
    const [prefs, subscriptions] = await Promise.all([
      db
        .select({
          comments: pushPreferences.comments,
          announcements: pushPreferences.announcements,
          participation: pushPreferences.participation,
          subscriptions: pushPreferences.subscriptions,
          reminders: pushPreferences.reminders,
        })
        .from(pushPreferences)
        .where(eq(pushPreferences.userId, user)),
      db
        .select({ endpoint: pushSubscriptions.endpoint, vapid: pushSubscriptions.vapidPublicKey })
        .from(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.userId, user),
            sql`(${pushSubscriptions.expirationTime} is null or ${pushSubscriptions.expirationTime}>statement_timestamp())`,
          ),
        ),
    ]);
    const current = subscriptions.filter((s) => s.vapid === config?.publicKey);
    return {
      enabled: !!config,
      publicKey: config?.publicKey ?? null,
      preferences: prefs[0] ?? { ...DEFAULT_PUSH_PREFERENCES },
      subscriptions: current.length,
      currentDevice:
        !!device &&
        current.some((s) => createHash("sha256").update(s.endpoint).digest("hex") === device),
    };
  }
  async function subscribe(actor: string | null, input: unknown) {
    const user = requireActor(actor),
      value = pushSubscriptionSchema.parse(input);
    if (!config)
      throw new AppError("CONFLICT", "알림 발송 설정을 준비 중이에요. 잠시 후 다시 시도해주세요.");
    if (!validPushEndpoint(value.endpoint))
      throw new AppError("VALIDATION", "지원하는 브라우저의 알림 구독 정보를 사용해주세요.");
    validateSubscriptionKeys(value.keys.p256dh, value.keys.auth);
    const expirationTime = value.expirationTime == null ? null : new Date(value.expirationTime);
    if (expirationTime && expirationTime.getTime() <= Date.now())
      throw new AppError("VALIDATION", "만료된 알림 구독이에요. 다시 연결해주세요.");
    try {
      await db.transaction(async (tx) => {
        await lockUser(tx, user);
        const [existing] = await tx
          .select()
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.endpoint, value.endpoint));
        if (existing && existing.userId !== user)
          throw new AppError(
            "CONFLICT",
            "이 기기가 다른 계정에 연결돼 있어요. 기기 알림을 새로 연결해주세요.",
          );
        await tx
          .delete(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.userId, user),
              sql`(${pushSubscriptions.expirationTime} <= statement_timestamp() or ${pushSubscriptions.vapidPublicKey} <> ${config.publicKey})`,
              sql`${pushSubscriptions.endpoint} <> ${value.endpoint}`,
            ),
          );
        const own = await tx
          .select({ id: pushSubscriptions.id })
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.userId, user));
        if (!existing && own.length >= 10)
          throw new AppError(
            "CONFLICT",
            "기기는 최대 10개까지 연결할 수 있어요. 사용하지 않는 기기를 해제해주세요.",
          );
        await tx.insert(pushPreferences).values({ userId: user }).onConflictDoNothing();
        const row = {
          userId: user,
          endpoint: value.endpoint,
          p256dh: value.keys.p256dh.replace(/=+$/, ""),
          auth: value.keys.auth.replace(/=+$/, ""),
          vapidPublicKey: config.publicKey,
          expirationTime,
        };
        if (existing) {
          await tx
            .update(pushSubscriptions)
            .set({ ...row, updatedAt: sql`statement_timestamp()` })
            .where(and(eq(pushSubscriptions.id, existing.id), eq(pushSubscriptions.userId, user)));
        } else await tx.insert(pushSubscriptions).values(row);
      });
    } catch (e) {
      if (
        (e as { cause?: { code?: string }; code?: string }).cause?.code === "23505" ||
        (e as { code?: string }).code === "23505"
      )
        throw new AppError("CONFLICT", "기기의 연결 상태가 바뀌었어요. 알림을 다시 연결해주세요.");
      throw e;
    }
    return settings(user, createHash("sha256").update(value.endpoint).digest("hex"));
  }
  async function unsubscribe(actor: string | null, input: unknown) {
    const user = requireActor(actor),
      value = endpointInputSchema.parse(input);
    await db
      .delete(pushSubscriptions)
      .where(
        and(eq(pushSubscriptions.userId, user), eq(pushSubscriptions.endpoint, value.endpoint)),
      );
    return settings(user);
  }
  async function update(actor: string | null, input: unknown) {
    const user = requireActor(actor),
      value = pushPreferencesSchema.parse(input);
    await db.transaction(async (tx) => {
      await lockUser(tx, user);
      const [saved] = await tx
        .select()
        .from(pushPreferences)
        .where(eq(pushPreferences.userId, user));
      const preferences = {
        ...value,
        subscriptions:
          value.subscriptions ?? saved?.subscriptions ?? DEFAULT_PUSH_PREFERENCES.subscriptions,
        reminders: value.reminders ?? saved?.reminders ?? DEFAULT_PUSH_PREFERENCES.reminders,
      };
      await tx
        .insert(pushPreferences)
        .values({ userId: user, ...preferences })
        .onConflictDoUpdate({
          target: pushPreferences.userId,
          set: { ...preferences, updatedAt: sql`statement_timestamp()` },
        });
      const disabled = [
        ...(!preferences.comments ? ["comment"] : []),
        ...(!preferences.announcements ? ["announcement"] : []),
        ...(!preferences.participation ? ["participation"] : []),
        ...(!preferences.subscriptions ? ["subscription"] : []),
        ...(!preferences.reminders ? ["reminder"] : []),
      ];
      if (disabled.length)
        await tx
          .update(pushDeliveries)
          .set({
            status: "cancelled",
            lockedAt: null,
            lockToken: null,
            lastErrorCode: "PREFERENCE_DISABLED",
          })
          .where(
            and(
              eq(pushDeliveries.recipientId, user),
              sql`${pushDeliveries.status} in ('pending','processing')`,
              sql`${pushDeliveries.kind} in (${sql.join(
                disabled.map((kind) => sql`${kind}`),
                sql`, `,
              )})`,
            ),
          );
    });
    return settings(user);
  }
  async function test(actor: string | null, input: unknown) {
    const user = requireActor(actor),
      value = endpointInputSchema.parse(input);
    if (!config) throw new AppError("CONFLICT", "알림 발송 설정을 준비 중이에요.");
    await db.transaction(async (tx) => {
      await lockUser(tx, user);
      const [sub] = await tx
        .select()
        .from(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.userId, user),
            eq(pushSubscriptions.endpoint, value.endpoint),
            eq(pushSubscriptions.vapidPublicKey, config.publicKey),
          ),
        );
      if (!sub) throw new AppError("NOT_FOUND", "이 기기의 알림을 먼저 연결해주세요.");
      if (sub.expirationTime && sub.expirationTime.getTime() <= Date.now())
        throw new AppError("CONFLICT", "기기 알림이 만료됐어요. 다시 연결해주세요.");
      const [recent] = await tx
        .select({ id: pushDeliveries.id })
        .from(pushDeliveries)
        .where(
          and(
            eq(pushDeliveries.recipientId, user),
            eq(pushDeliveries.kind, "test"),
            sql`${pushDeliveries.createdAt}>statement_timestamp()-interval '1 minute'`,
          ),
        )
        .limit(1);
      if (recent) throw new AppError("RATE_LIMITED", "테스트 알림은 1분 뒤에 다시 보낼 수 있어요.");
      await tx.insert(pushDeliveries).values({
        subscriptionId: sub.id,
        recipientId: user,
        kind: "test",
        dedupeKey: "test:" + Date.now(),
        title: "Sliper 알림이 연결됐어요",
        body: "공지와 댓글을 이 기기에서 받아볼 수 있어요.",
        url: "/mypage",
      });
    });
    return { queued: true };
  }
  return { settings, subscribe, unsubscribe, update, test };
}
