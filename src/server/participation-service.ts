import { createHash } from "node:crypto";
import { and, eq, sql, desc, lt, or } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/connection";
import {
  posts,
  profiles,
  eventSettings,
  eventApplications,
  paymentOrders,
  paymentEvents,
  roomManagers,
  roomMessages,
  externalReceipts,
  refundRequests,
} from "../db/schema";
import {
  applicationSchema,
  eventConfigSchema,
  paymentEventSchema,
  type EventOverview,
  type ApplicationView,
  type ApplicationStatus,
  type RoomView,
  type RoomMemberPage,
  type ParticipationHome,
} from "../domain/participation";
import { AppError, requireActor } from "./errors";
import { isProfileReadyForApplication, normalizePhoneNumber } from "../domain/profile";
import {
  snapshotApplicationAnswers,
  type ApplicationQuestion,
  type ApplicationAnswerSnapshot,
} from "../domain/application-questions";
import { preciseTimestamp, pageQuerySchema } from "./pagination";
import { authorizeRoom, readRoomRoster } from "./room-roster-service";
import { eventManagementService } from "./event-management-service";
import { enqueueAnnouncementPush } from "./push-events";
import { publishRoomWake } from "./room-realtime";
import { assertContentVisible } from "./safety-visibility";
import { bindEventVenue, readEventVenueReference } from "./event-venue-service";
import {
  assertEventRunning,
  isEventCancelled,
  readEventLifecycle,
} from "./event-lifecycle-service";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
const idSchema = z.uuid();
const active = sql`(status='confirmed' or (status='pending_payment' and expires_at>statement_timestamp()))`;
const expired = sql`status='pending_payment' and expires_at<=statement_timestamp()`;
const cursorSchema = z.object({ at: z.iso.datetime({ offset: true }), id: z.uuid() }).strict();
function parseCursor(value?: string | null) {
  if (!value) return null;
  try {
    if (value.length > 500) throw new Error();
    return cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString()));
  } catch {
    throw new AppError("VALIDATION", "페이지 정보를 확인해주세요.");
  }
}
function makeCursor(value: { createdAt: string; id: string }) {
  return Buffer.from(JSON.stringify({ at: value.createdAt, id: value.id })).toString("base64url");
}
export const appProjection = {
  id: eventApplications.id,
  postId: eventApplications.postId,
  title: posts.title,
  status: eventApplications.status,
  amountKRW: eventApplications.amountKRW,
  createdAt: preciseTimestamp(eventApplications.createdAt),
  expiresAt: eventApplications.expiresAt,
  attendeeName: eventApplications.attendeeName,
  contact: eventApplications.contact,
  note: eventApplications.note,
  answers: eventApplications.answers,
  questionnaireVersion: eventApplications.questionnaireVersion,
  orderId: paymentOrders.id,
  source: eventApplications.source,
  externalReference: eventApplications.externalReference,
  decisionNote: eventApplications.decisionNote,
  eventStartsAt: eventApplications.eventStartsAt,
  refundPolicy: eventApplications.refundPolicy,
  externalPaymentVerified: sql<boolean>`exists(select 1 from sliper.external_receipts r where r.application_id=${eventApplications.id} and r.state='paid')`,
};
export function applicationView(row: {
  id: string;
  postId: string;
  title: string;
  status: string;
  amountKRW: number;
  createdAt: string;
  expiresAt: Date | null;
  source: string;
  externalReference: string | null;
  decisionNote: string;
  externalPaymentVerified: boolean;
  eventStartsAt: Date | null;
  refundPolicy: string;
  attendeeName: string;
  contact: string;
  note: string;
  answers: ApplicationAnswerSnapshot[];
  questionnaireVersion: string | null;
  orderId: string | null;
}): ApplicationView {
  const { questionnaireVersion: version, ...safe } = row;
  return {
    ...safe,
    questionnaireCompleted: version !== null,
    status: (row.status === "pending_payment" && row.expiresAt!.getTime() <= Date.now()
      ? "expired"
      : row.status) as ApplicationStatus,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    eventStartsAt: row.eventStartsAt?.toISOString() ?? null,
    source: row.source as "site" | "external",
  };
}
export function questionnaireVersion(questions: readonly ApplicationQuestion[]): string {
  return "q1-" + createHash("sha256").update(JSON.stringify(questions)).digest("hex");
}
export function participationService(db: Database) {
  async function prepareApplication(
    tx: Tx,
    user: string,
    settings: typeof eventSettings.$inferSelect,
    value: z.infer<typeof applicationSchema>,
  ) {
    const version = questionnaireVersion(settings.questions);
    if (
      (settings.questions.length > 0 || value.questionnaireVersion !== undefined) &&
      value.questionnaireVersion !== version
    )
      throw new AppError(
        "CONFLICT",
        "신청 질문이 변경되었어요. 새로고침 후 답변을 확인하고 다시 제출해주세요.",
      );
    const answers = snapshotApplicationAnswers(settings.questions, value.answers);
    const [profile] = await tx
      .select({
        nickname: profiles.nickname,
        phoneNumber: profiles.phoneNumber,
        profileCompletedAt: profiles.profileCompletedAt,
        onboardingConsentAt: profiles.onboardingConsentAt,
      })
      .from(profiles)
      .where(eq(profiles.id, user))
      .for("share");
    if (!profile || !isProfileReadyForApplication(profile))
      throw new AppError(
        "VALIDATION",
        "참가 신청 전에 가입 기본 정보에서 닉네임과 연락처를 입력하고 기본정보 저장에 동의해주세요.",
      );
    if (settings.startsAt && settings.amountKRW > 0 && !value.refundConsent)
      throw new AppError("VALIDATION", "한국 날짜 기준 취소·환불 정책을 확인하고 동의해주세요.");
    return {
      attendeeName: profile.nickname,
      contact: normalizePhoneNumber(profile.phoneNumber!)!,
      note: value.note,
      answers,
      questionnaireVersion: version,
      refundConsentAt: value.refundConsent ? sql`statement_timestamp()` : null,
    };
  }
  async function lockEvent(tx: Tx, postId: string) {
    const [post] = await tx
      .select()
      .from(posts)
      .where(eq(posts.id, idSchema.parse(postId)))
      .for("update");
    if (!post || post.kind !== "모집" || post.status !== "published")
      throw new AppError("NOT_FOUND", "모집글을 찾을 수 없어요.");
    await tx
      .update(eventApplications)
      .set({ status: "expired", updatedAt: sql`statement_timestamp()` })
      .where(and(eq(eventApplications.postId, postId), expired));
    const [settings] = await tx
      .select()
      .from(eventSettings)
      .where(eq(eventSettings.postId, postId))
      .for("update");
    return { post, settings };
  }
  async function configure(actor: string | null, postId: string, input: unknown) {
    const user = requireActor(actor),
      value = eventConfigSchema.parse(input);
    await db.transaction(async (tx) => {
      const { post, settings } = await lockEvent(tx, postId);
      if (post.authorId !== user)
        throw new AppError("FORBIDDEN", "모집글 등록자만 신청 설정을 변경할 수 있어요.");
      await assertEventRunning(tx, postId);
      if (settings?.completedAt)
        throw new AppError(
          "CONFLICT",
          "완료된 행사는 모집 설정을 변경할 수 없어요. 참가 전적과 회고에서 기록을 관리해주세요.",
        );
      const dates = {
        startsAt:
          value.startsAt === undefined
            ? (settings?.startsAt ?? null)
            : value.startsAt
              ? new Date(value.startsAt)
              : null,
        endsAt:
          value.endsAt === undefined
            ? (settings?.endsAt ?? null)
            : value.endsAt
              ? new Date(value.endsAt)
              : null,
      };
      if (dates.endsAt && (!dates.startsAt || dates.endsAt <= dates.startsAt))
        throw new AppError("VALIDATION", "행사 종료 시각은 시작 시각 이후로 설정해주세요.");
      if (
        settings &&
        (settings.startsAt?.getTime() !== dates.startsAt?.getTime() ||
          settings.endsAt?.getTime() !== dates.endsAt?.getTime())
      ) {
        const [application] = await tx
          .select({ id: eventApplications.id })
          .from(eventApplications)
          .where(eq(eventApplications.postId, postId))
          .limit(1);
        if (application && settings.startsAt !== null)
          throw new AppError(
            "CONFLICT",
            "참가 내역이 있는 행사의 일정은 변경할 수 없어요. 기존 참가자의 환불 기준을 유지합니다.",
          );
      }
      let venue =
        value.venue === undefined
          ? {
              venueLatitude: settings?.venueLatitude ?? null,
              venueLongitude: settings?.venueLongitude ?? null,
            }
          : {
              venueLatitude: value.venue?.latitude ?? null,
              venueLongitude: value.venue?.longitude ?? null,
            };
      if (
        settings?.meetupType === "lightning" &&
        ((value.amountKRW !== 0 && !post.applicationUrl) ||
          value.capacity < 2 ||
          value.capacity > 12 ||
          !dates.startsAt ||
          !dates.endsAt ||
          venue.venueLatitude === null ||
          venue.venueLongitude === null ||
          dates.startsAt <= settings.createdAt ||
          dates.startsAt.getTime() > settings.createdAt.getTime() + 7 * 86400000 ||
          dates.endsAt.getTime() - dates.startsAt.getTime() < 15 * 60000 ||
          dates.endsAt.getTime() - dates.startsAt.getTime() > 12 * 3600000)
      )
        throw new AppError(
          "VALIDATION",
          "번개는 2~12명, 개설 후 7일 이내 일정과 행사장 위치가 필요해요. 유료 참가비는 외부 신청 링크가 있을 때만 설정할 수 있어요.",
        );
      venue = await bindEventVenue(tx, user, postId, value.venue);
      if (
        settings?.venueLatitude !== null &&
        settings?.venueLatitude !== undefined &&
        (venue.venueLatitude !== settings.venueLatitude ||
          venue.venueLongitude !== settings.venueLongitude)
      ) {
        const [application] = await tx
          .select({ id: eventApplications.id })
          .from(eventApplications)
          .where(eq(eventApplications.postId, postId))
          .limit(1);
        if (application)
          throw new AppError("CONFLICT", "참가 내역이 있는 행사의 위치는 변경할 수 없어요.");
      }
      const configuration = {
        amountKRW: value.amountKRW,
        capacity: value.capacity,
        open: value.open,
        approvalMode: value.approvalMode,
        questions: value.questions ?? settings?.questions ?? [],
      };
      const [total] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(eventApplications)
        .where(and(eq(eventApplications.postId, postId), active));
      if (value.capacity < total!.count)
        throw new AppError("CONFLICT", "정원을 현재 참가 확정·결제 대기 인원보다 줄일 수 없어요.");
      await tx
        .insert(eventSettings)
        .values({ postId, ...configuration, ...dates, ...venue })
        .onConflictDoUpdate({
          target: eventSettings.postId,
          set: { ...configuration, ...dates, ...venue, updatedAt: sql`statement_timestamp()` },
        });
      if (settings?.meetupType === "lightning")
        await tx
          .update(posts)
          .set({
            eventFee:
              value.amountKRW === 0 ? "무료" : value.amountKRW.toLocaleString("ko-KR") + "원",
          })
          .where(eq(posts.id, postId));
    });
    return overview(actor, postId);
  }
  async function overview(actor: string | null, postId: string): Promise<EventOverview> {
    const [p] = await db
      .select({
        id: posts.id,
        title: posts.title,
        authorId: posts.authorId,
        location: posts.location,
        eventDate: posts.eventDate,
        externalUrl: posts.applicationUrl,
      })
      .from(posts)
      .where(
        and(
          eq(posts.id, idSchema.parse(postId)),
          eq(posts.kind, "모집"),
          eq(posts.status, "published"),
        ),
      );
    if (!p) throw new AppError("NOT_FOUND", "모집글을 찾을 수 없어요.");
    const lifecycle = await readEventLifecycle(db, postId);
    const [settings] = await db
      .select()
      .from(eventSettings)
      .where(eq(eventSettings.postId, postId));
    const venueReference = settings ? await readEventVenueReference(db, actor, postId) : {};
    const [total] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(eventApplications)
      .where(and(eq(eventApplications.postId, postId), active));
    const [application] = actor
      ? await db
          .select(appProjection)
          .from(eventApplications)
          .innerJoin(posts, eq(posts.id, eventApplications.postId))
          .leftJoin(paymentOrders, eq(paymentOrders.applicationId, eventApplications.id))
          .where(and(eq(eventApplications.postId, postId), eq(eventApplications.userId, actor)))
          .orderBy(
            sql`case when ${eventApplications.source}='external' then case when ${eventApplications.status} in ('pending_approval','confirmed') then 0 when ${eventApplications.status}='review' then 1 else 2 end else 0 end`,
            desc(eventApplications.createdAt),
            desc(eventApplications.id),
          )
          .limit(1)
      : [];
    const [profile] = actor
      ? await db
          .select({
            publicId: profiles.publicId,
            nickname: profiles.nickname,
            phoneNumber: profiles.phoneNumber,
            profileCompletedAt: profiles.profileCompletedAt,
            onboardingConsentAt: profiles.onboardingConsentAt,
          })
          .from(profiles)
          .where(eq(profiles.id, actor))
      : [];
    const [manager] = actor
      ? await db
          .select({ id: roomManagers.userId })
          .from(roomManagers)
          .where(and(eq(roomManagers.postId, postId), eq(roomManagers.userId, actor)))
      : [];
    return {
      canManage: p.authorId === actor || !!manager,
      publicProfileId: profile?.publicId ?? null,
      postId: p.id,
      title: p.title,
      location: p.location,
      eventDate: p.eventDate,
      externalUrl: p.externalUrl,
      isOwner: p.authorId === actor,
      canApply: !!actor && !lifecycle.cancelledAt,
      applicantProfile: profile
        ? {
            nickname: profile.nickname,
            phoneNumber: profile.phoneNumber,
            ready: isProfileReadyForApplication(profile),
          }
        : null,
      config: settings
        ? {
            cancelledAt: lifecycle.cancelledAt?.toISOString() ?? null,
            lifecycleRevision: lifecycle.revision,
            amountKRW: settings.amountKRW,
            capacity: settings.capacity,
            open: settings.open,
            occupied: total!.count,
            approvalMode: settings.approvalMode as "manual" | "automatic",
            startsAt: settings.startsAt?.toISOString() ?? null,
            endsAt: settings.endsAt?.toISOString() ?? null,
            refundPolicy: settings.refundPolicy,
            completedAt: settings.completedAt?.toISOString() ?? null,
            questions: settings.questions,
            questionnaireVersion: questionnaireVersion(settings.questions),
            meetupType: settings.meetupType as "event" | "lightning",
            venue:
              settings.venueLatitude === null || settings.venueLongitude === null
                ? null
                : {
                    latitude: settings.venueLatitude,
                    longitude: settings.venueLongitude,
                    ...venueReference,
                  },
          }
        : null,
      application: application ? applicationView(application) : null,
    };
  }
  async function apply(
    actor: string | null,
    postId: string,
    input: unknown,
    provider: string | null,
  ) {
    const user = requireActor(actor),
      value = applicationSchema.parse(input);
    await assertContentVisible(db, "post", idSchema.parse(postId));
    if (provider && !/^[a-zA-Z0-9_-]{1,40}$/.test(provider))
      throw new AppError("VALIDATION", "결제 플랫폼 설정을 확인해주세요.");
    await db.transaction(async (tx) => {
      const { post, settings } = await lockEvent(tx, postId);
      await assertEventRunning(tx, postId);
      if (post.applicationUrl)
        throw new AppError(
          "CONFLICT",
          "이 모집글은 외부 플랫폼에서 신청·결제해주세요. 결제 후 참가 확인을 요청할 수 있어요.",
        );
      const [existing] = await tx
        .select({ id: eventApplications.id })
        .from(eventApplications)
        .where(
          and(eq(eventApplications.postId, postId), eq(eventApplications.userId, user), active),
        );
      if (existing) return; // Retry is idempotent; never create a second order.
      if (!settings?.open)
        throw new AppError("CONFLICT", "사이트 내 참가 신청이 열려 있지 않아요.");
      if (settings.startsAt && settings.startsAt.getTime() <= Date.now())
        throw new AppError("CONFLICT", "이미 시작된 행사에는 새로 신청할 수 없어요.");
      const submission = await prepareApplication(tx, user, settings, value);
      const [total] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(eventApplications)
        .where(and(eq(eventApplications.postId, postId), active));
      if (total!.count >= settings.capacity) throw new AppError("CONFLICT", "모집 정원이 찼어요.");
      if (settings.amountKRW > 0 && !provider)
        throw new AppError("CONFLICT", "결제 플랫폼 연결 준비 중이에요. 담당자에게 문의해주세요.");
      const [app] = await tx
        .insert(eventApplications)
        .values({
          postId,
          userId: user,
          ...submission,
          amountKRW: settings.amountKRW,
          status: settings.amountKRW === 0 ? "confirmed" : "pending_payment",
          expiresAt: sql`statement_timestamp()+interval '30 minutes'`,
          confirmedAt: settings.amountKRW === 0 ? sql`statement_timestamp()` : null,
        })
        .returning({ id: eventApplications.id });
      if (settings.amountKRW > 0)
        await tx
          .insert(paymentOrders)
          .values({ applicationId: app!.id, provider: provider!, amountKRW: settings.amountKRW });
    });
    return overview(actor, postId);
  }
  async function cancel(actor: string | null, applicationId: string) {
    const user = requireActor(actor);
    const [lookup] = await db
      .select({ postId: eventApplications.postId })
      .from(eventApplications)
      .where(
        and(
          eq(eventApplications.id, idSchema.parse(applicationId)),
          eq(eventApplications.userId, user),
        ),
      );
    if (!lookup) throw new AppError("NOT_FOUND", "신청 정보를 찾을 수 없어요.");
    await db.transaction(async (tx) => {
      await lockEvent(tx, lookup.postId);
      const [app] = await tx
        .select()
        .from(eventApplications)
        .where(eq(eventApplications.id, applicationId));
      const [externalReceipt] =
        app!.source === "external"
          ? await tx
              .select({ id: externalReceipts.applicationId })
              .from(externalReceipts)
              .where(eq(externalReceipts.applicationId, applicationId))
          : [];
      if (
        (app!.status === "confirmed" && (app!.amountKRW > 0 || app!.source === "external")) ||
        (app!.status === "pending_approval" && externalReceipt)
      )
        throw new AppError(
          "CONFLICT",
          "결제된 신청은 외부 결제 플랫폼에서 환불을 진행해주세요. 환불 확인 후 공지방 참여가 종료됩니다.",
        );
      if (
        app!.status === "pending_payment" ||
        app!.status === "pending_approval" ||
        (app!.status === "confirmed" && app!.amountKRW === 0)
      )
        await tx
          .update(eventApplications)
          .set({ status: "cancelled", updatedAt: sql`statement_timestamp()` })
          .where(eq(eventApplications.id, applicationId));
    });
    return overview(actor, lookup.postId);
  }
  async function checkoutOrder(actor: string | null, orderId: string) {
    const user = requireActor(actor);
    const [lookup] = await db
      .select({ postId: eventApplications.postId })
      .from(paymentOrders)
      .innerJoin(eventApplications, eq(paymentOrders.applicationId, eventApplications.id))
      .where(
        and(eq(paymentOrders.id, idSchema.parse(orderId)), eq(eventApplications.userId, user)),
      );
    if (!lookup) throw new AppError("NOT_FOUND", "결제 주문을 찾을 수 없어요.");
    return db.transaction(async (tx) => {
      const { post, settings } = await lockEvent(tx, lookup.postId);
      await assertEventRunning(tx, lookup.postId);
      if (settings?.endsAt && settings.endsAt.getTime() <= Date.now())
        throw new AppError("CONFLICT", "종료된 행사는 새 결제를 진행할 수 없어요.");
      if (post.applicationUrl)
        throw new AppError("CONFLICT", "외부 플랫폼에서 직접 신청·결제하는 모집글이에요.");
      const [row] = await tx
        .select({ order: paymentOrders, application: eventApplications })
        .from(paymentOrders)
        .innerJoin(eventApplications, eq(paymentOrders.applicationId, eventApplications.id))
        .where(eq(paymentOrders.id, orderId));
      if (row!.order.state !== "pending" || row!.application.status !== "pending_payment")
        throw new AppError("CONFLICT", "결제 가능한 신청이 아니에요. 신청 상태를 확인해주세요.");
      return {
        id: row!.order.id,
        provider: row!.order.provider,
        amountKRW: row!.order.amountKRW,
        checkoutUrl: row!.order.checkoutUrl,
        postId: post.id,
        title: post.title,
      };
    });
  }
  async function saveCheckout(actor: string | null, orderId: string, url: string) {
    await checkoutOrder(actor, orderId);
    await db
      .update(paymentOrders)
      .set({ checkoutUrl: url, updatedAt: sql`statement_timestamp()` })
      .where(and(eq(paymentOrders.id, orderId), eq(paymentOrders.state, "pending")));
    return { checkoutUrl: url };
  }
  async function payment(provider: string, input: unknown) {
    const event = paymentEventSchema.parse(input),
      digest = createHash("sha256").update(JSON.stringify(event)).digest("hex");
    if (
      event.refundAmountKRW !== undefined &&
      (event.status !== "refunded" || event.refundAmountKRW > event.amountKRW)
    )
      throw new AppError("VALIDATION", "환불 알림 금액을 확인해주세요.");
    const [lookup] = await db
      .select({ postId: eventApplications.postId })
      .from(paymentOrders)
      .innerJoin(eventApplications, eq(paymentOrders.applicationId, eventApplications.id))
      .where(and(eq(paymentOrders.id, event.orderId), eq(paymentOrders.provider, provider)));
    if (!lookup) throw new AppError("NOT_FOUND", "일치하는 결제 주문이 없어요.");
    try {
      return await db.transaction(async (tx) => {
        // Match the lock order used by apply/cancel/configure, including late callbacks.
        const [post] = await tx
          .select({ id: posts.id })
          .from(posts)
          .where(eq(posts.id, lookup.postId))
          .for("update");
        if (!post) throw new AppError("NOT_FOUND", "모집 정보를 찾을 수 없어요.");
        const cancelled = await isEventCancelled(tx, lookup.postId);
        const [order] = await tx
          .select()
          .from(paymentOrders)
          .where(eq(paymentOrders.id, event.orderId))
          .for("update");
        const [app] = await tx
          .select()
          .from(eventApplications)
          .where(eq(eventApplications.id, order!.applicationId));
        if (
          order!.amountKRW !== event.amountKRW ||
          order!.currency !== event.currency ||
          (order!.paymentId && order!.paymentId !== event.paymentId)
        )
          throw new AppError("CONFLICT", "결제 정보가 주문과 일치하지 않아요.");
        const [saved] = await tx
          .select()
          .from(paymentEvents)
          .where(
            and(eq(paymentEvents.provider, provider), eq(paymentEvents.eventId, event.eventId)),
          );
        if (saved) {
          if (saved.digest !== digest) throw new AppError("CONFLICT", "중복 알림의 내용이 달라요.");
          return { duplicate: true, status: app!.status };
        }
        const [inserted] = await tx
          .insert(paymentEvents)
          .values({
            provider,
            eventId: event.eventId,
            orderId: event.orderId,
            digest,
            kind: event.status,
          })
          .onConflictDoNothing()
          .returning();
        if (!inserted) {
          const [prior] = await tx
            .select()
            .from(paymentEvents)
            .where(
              and(eq(paymentEvents.provider, provider), eq(paymentEvents.eventId, event.eventId)),
            );
          if (prior?.digest !== digest)
            throw new AppError("CONFLICT", "중복 알림의 내용이 달라요.");
          return { duplicate: true, status: app!.status };
        }
        if (order!.state === "refunded") {
          if (
            event.status === "refunded" &&
            order!.refundedAmountKRW !== (event.refundAmountKRW ?? event.amountKRW)
          )
            throw new AppError("CONFLICT", "이미 확인한 실제 환불 금액과 알림 금액이 달라요.");
          return { duplicate: false, status: app!.status };
        }
        await tx
          .update(paymentOrders)
          .set({
            state: event.status,
            ...(event.status === "refunded"
              ? { refundedAmountKRW: event.refundAmountKRW ?? event.amountKRW }
              : {}),
            paymentId: event.paymentId,
            updatedAt: sql`statement_timestamp()`,
          })
          .where(eq(paymentOrders.id, order!.id));
        let status = app!.status;
        if (event.status === "refunded") status = "refunded";
        else if (app!.status === "pending_payment") {
          const [timely] = await tx
            .select({ id: eventApplications.id })
            .from(eventApplications)
            .where(
              and(
                eq(eventApplications.id, app!.id),
                sql`${eventApplications.expiresAt}>statement_timestamp()`,
                sql`not exists(select 1 from sliper.event_settings es where es.post_id=${app!.postId} and es.ends_at<=statement_timestamp())`,
              ),
            );
          status = timely && !cancelled ? "confirmed" : "review";
        } else if (app!.status === "cancelled" || app!.status === "expired") status = "review";
        if (status !== app!.status)
          await tx
            .update(eventApplications)
            .set({
              status,
              confirmedAt: status === "confirmed" ? sql`statement_timestamp()` : app!.confirmedAt,
              updatedAt: sql`statement_timestamp()`,
            })
            .where(eq(eventApplications.id, app!.id));
        if (event.status === "refunded")
          await tx
            .update(refundRequests)
            .set({
              state: "completed",
              actualRefundKRW: event.refundAmountKRW ?? event.amountKRW,
              processedAt: sql`statement_timestamp()`,
              decisionNote: "외부 플랫폼의 검증된 취소·환불 알림 확인",
            })
            .where(
              and(eq(refundRequests.applicationId, app!.id), eq(refundRequests.state, "pending")),
            );
        return { duplicate: false, status };
      });
    } catch (error) {
      const state =
        (error as { code?: string; cause?: { code?: string } })?.code ||
        (error as { cause?: { code?: string } })?.cause?.code;
      if (state === "23505") throw new AppError("CONFLICT", "이미 처리된 결제 정보예요.");
      throw error;
    }
  }
  async function room(
    actor: string | null,
    postId: string,
    cursor?: string | null,
  ): Promise<RoomView> {
    const user = requireActor(actor),
      id = idSchema.parse(postId),
      before = parseCursor(cursor);
    return db.transaction(async (tx) => {
      const { post, canWrite, isOwner } = await authorizeRoom(tx, user, id);
      const roster = await readRoomRoster(tx, user, id, post.authorId, 8);
      const rows = await tx
        .select({
          id: roomMessages.id,
          body: roomMessages.body,
          author: sql<string>`coalesce(${profiles.nickname},'담당자')`,
          createdAt: preciseTimestamp(roomMessages.createdAt),
        })
        .from(roomMessages)
        .leftJoin(profiles, eq(profiles.id, roomMessages.authorId))
        .where(
          and(
            eq(roomMessages.postId, id),
            before
              ? or(
                  sql`${roomMessages.createdAt}<${before.at}::timestamptz`,
                  and(
                    sql`${roomMessages.createdAt}=${before.at}::timestamptz`,
                    lt(roomMessages.id, before.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(roomMessages.createdAt), desc(roomMessages.id))
        .limit(31);
      const selected = rows.slice(0, 30),
        last = selected.at(-1);
      return {
        postId: id,
        title: post.title,
        canWrite,
        isOwner,
        memberCount: roster.memberCount,
        memberPreview: roster.members,
        memberRevision: roster.memberRevision,
        messages: selected.reverse().map((m) => ({ ...m, createdAt: m.createdAt })),
        nextCursor: rows.length > 30 && last ? makeCursor(last) : null,
      };
    });
  }
  async function members(
    actor: string | null,
    postId: string,
    input: unknown = {},
  ): Promise<RoomMemberPage> {
    const user = requireActor(actor),
      id = idSchema.parse(postId),
      query = pageQuerySchema.parse(input);
    return db.transaction(async (tx) => {
      const { post } = await authorizeRoom(tx, user, id);
      return readRoomRoster(tx, user, id, post.authorId, query.limit, query.cursor);
    });
  }
  async function send(actor: string | null, postId: string, input: unknown) {
    const user = requireActor(actor),
      value = z
        .object({ body: z.string().trim().min(1).max(10000) })
        .strict()
        .parse(input);
    await db.transaction(async (tx) => {
      const { post, settings } = await lockEvent(tx, postId);
      if (!settings) throw new AppError("NOT_FOUND", "공지방을 찾을 수 없어요.");
      const [manager] = await tx
        .select({ userId: roomManagers.userId })
        .from(roomManagers)
        .where(and(eq(roomManagers.postId, postId), eq(roomManagers.userId, user)));
      if (post.authorId !== user && !manager)
        throw new AppError("FORBIDDEN", "담당자만 공지를 보낼 수 있어요.");
      const [recent] = await tx
        .select({ id: roomMessages.id })
        .from(roomMessages)
        .where(
          and(
            eq(roomMessages.postId, postId),
            eq(roomMessages.authorId, user),
            sql`${roomMessages.createdAt}>statement_timestamp()-interval '2 seconds'`,
          ),
        )
        .limit(1);
      if (recent) throw new AppError("RATE_LIMITED", "잠시 후 다음 공지를 보내주세요.");
      const [message] = await tx
        .insert(roomMessages)
        .values({ postId, authorId: user, body: value.body })
        .returning({ id: roomMessages.id });
      await enqueueAnnouncementPush(tx, {
        postId,
        messageId: message!.id,
        actorId: user,
      });
    });
    // Publish only after the announcement and its existing push outbox have committed.
    await publishRoomWake(postId);
    return room(actor, postId);
  }
  async function managers(actor: string | null, postId: string) {
    const user = requireActor(actor);
    const [post] = await db
      .select({ authorId: posts.authorId })
      .from(posts)
      .where(eq(posts.id, idSchema.parse(postId)));
    if (post?.authorId !== user)
      throw new AppError("FORBIDDEN", "등록자만 담당자를 관리할 수 있어요.");
    return db
      .select({ publicId: profiles.publicId, nickname: profiles.nickname })
      .from(roomManagers)
      .innerJoin(profiles, eq(profiles.id, roomManagers.userId))
      .where(eq(roomManagers.postId, postId));
  }
  async function setManager(actor: string | null, postId: string, input: unknown) {
    const user = requireActor(actor),
      value = z.object({ publicId: z.uuid(), enabled: z.boolean() }).strict().parse(input);
    await db.transaction(async (tx) => {
      const { post, settings } = await lockEvent(tx, postId);
      if (post.authorId !== user)
        throw new AppError("FORBIDDEN", "등록자만 담당자를 지정할 수 있어요.");
      if (!settings) throw new AppError("CONFLICT", "사이트 신청을 먼저 설정해주세요.");
      const [profile] = await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.publicId, value.publicId));
      if (!profile) throw new AppError("NOT_FOUND", "해당 공개 프로필 ID의 회원이 없어요.");
      if (value.enabled)
        await tx.insert(roomManagers).values({ postId, userId: profile.id }).onConflictDoNothing();
      else
        await tx
          .delete(roomManagers)
          .where(and(eq(roomManagers.postId, postId), eq(roomManagers.userId, profile.id)));
    });
    return managers(actor, postId);
  }
  async function attendees(actor: string | null, postId: string, cursor?: string | null) {
    const user = requireActor(actor),
      before = parseCursor(cursor);
    // Holds the same event lock as manager revocation for the entire private read.
    return db.transaction(async (tx) => {
      const { post, settings } = await lockEvent(tx, postId);
      const [manager] = await tx
        .select({ id: roomManagers.userId })
        .from(roomManagers)
        .where(and(eq(roomManagers.postId, postId), eq(roomManagers.userId, user)));
      if (!settings || (post.authorId !== user && !manager))
        throw new AppError("FORBIDDEN", "담당자만 신청 정보를 볼 수 있어요.");
      const rows = await tx
        .select(appProjection)
        .from(eventApplications)
        .innerJoin(posts, eq(posts.id, eventApplications.postId))
        .leftJoin(paymentOrders, eq(paymentOrders.applicationId, eventApplications.id))
        .where(
          and(
            eq(eventApplications.postId, postId),
            before
              ? or(
                  sql`${eventApplications.createdAt}<${before.at}::timestamptz`,
                  and(
                    sql`${eventApplications.createdAt}=${before.at}::timestamptz`,
                    lt(eventApplications.id, before.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(eventApplications.createdAt), desc(eventApplications.id))
        .limit(31);
      return {
        items: rows.slice(0, 30).map(applicationView),
        nextCursor: rows.length > 30 ? makeCursor(rows[29]!) : null,
      };
    });
  }
  async function home(actor: string | null, cursor?: string | null): Promise<ParticipationHome> {
    const user = requireActor(actor),
      before = parseCursor(cursor);
    const rows = await db
      .select(appProjection)
      .from(eventApplications)
      .innerJoin(posts, eq(posts.id, eventApplications.postId))
      .leftJoin(paymentOrders, eq(paymentOrders.applicationId, eventApplications.id))
      .where(
        and(
          eq(eventApplications.userId, user),
          before
            ? or(
                sql`${eventApplications.createdAt}<${before.at}::timestamptz`,
                and(
                  sql`${eventApplications.createdAt}=${before.at}::timestamptz`,
                  lt(eventApplications.id, before.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(eventApplications.createdAt), desc(eventApplications.id))
      .limit(31);
    const rooms = await db
      .select({
        postId: posts.id,
        title: posts.title,
        role: sql<
          "manager" | "participant"
        >`case when ${posts.authorId}=${user} or exists(select 1 from sliper.room_managers m where m.post_id=${posts.id} and m.user_id=${user}) then 'manager' else 'participant' end`,
      })
      .from(posts)
      .innerJoin(eventSettings, eq(eventSettings.postId, posts.id))
      .where(
        and(
          eq(posts.status, "published"),
          sql`(${posts.authorId}=${user} or exists(select 1 from sliper.room_managers m where m.post_id=${posts.id} and m.user_id=${user}) or exists(select 1 from sliper.room_members m join sliper.event_applications a on a.id=m.application_id where m.post_id=${posts.id} and m.user_id=${user} and m.revoked_at is null and a.status='confirmed'))`,
        ),
      )
      .orderBy(desc(posts.createdAt))
      .limit(100);
    return {
      applications: rows.slice(0, 30).map(applicationView),
      nextCursor: rows.length > 30 ? makeCursor(rows[29]!) : null,
      rooms,
    };
  }
  const management = eventManagementService(db, {
    lockEvent,
    overview,
    appProjection,
    applicationView,
    prepareApplication,
    questionnaireVersion,
  });
  return {
    ...management,
    configure,
    overview,
    apply,
    cancel,
    checkoutOrder,
    saveCheckout,
    payment,
    room,
    members,
    send,
    managers,
    setManager,
    attendees,
    home,
  };
}
