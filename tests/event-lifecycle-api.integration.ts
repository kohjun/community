import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { ActionResult } from "../src/domain/contracts";
import type { CommunityPost } from "../src/domain/community";
import type { EventLifecycleView, EventNoticePage } from "../src/domain/event-lifecycle";
import type { TicketView } from "../src/domain/event-operations";
import type { EventOverview, RoomView } from "../src/domain/participation";
import type { RefundView } from "../src/domain/refund";
import { createLocalTestSession, loadLocalTestAccount } from "../src/server/local-test-auth";

const origin = "http://127.0.0.1:3000",
  url = new URL(process.env.DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  process.env.APP_ORIGIN !== origin ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.pathname !== "/sliper_dev"
)
  throw new Error("Event lifecycle HTTP checks require the isolated local development database.");
const account = loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
if (!account)
  throw new Error("Set up the existing local test account before lifecycle HTTP checks.");
const participantCookie = `sliper_test_session=${createLocalTestSession(account, "127.0.0.1:3000")}`,
  guest = "sliper_test_session=invalid",
  db = postgres(url.toString(), { prepare: false, max: 1 });

async function api<T>(path: string, method = "GET", body?: unknown, cookie = "", from = origin) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Origin: from,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? null : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  return { status: response.status, result: (await response.json()) as ActionResult<T> };
}
function data<T>(response: { status: number; result: ActionResult<T> }) {
  assert.equal(response.status, 200, "Unexpected event lifecycle API status");
  assert.ok(response.result.ok, "Event lifecycle API returned an error");
  return response.result.data;
}

test("host changes, participant notices, QR invalidation and full external refund review work through real HTTP", async () => {
  const fixturePosts: string[] = [];
  async function createEvent(external = false) {
    const created = data(
      await api<CommunityPost>("/api/community/posts", "POST", {
        categorySlug: "party",
        kind: "모집",
        title: `HTTP 행사 변경 검사 ${randomUUID()}`,
        bodyMarkdown: "주최자 행사 취소·일정 변경 API 검사를 위한 임시 행사입니다.",
        isAnonymous: false,
        location: "검사용 행사장",
        eventDate: "검사용 일정",
        eventFee: external ? "10001원" : "무료",
        imageAssetIds: [],
        ...(external ? { applicationUrl: "https://events.example.invalid/lifecycle-fixture" } : {}),
      }),
    );
    fixturePosts.push(created.id);
    const startsAt = new Date(Date.now() + 6 * 3600000),
      endsAt = new Date(startsAt.getTime() + 2 * 3600000);
    const base = `/api/participation/events/${created.id}`;
    data(
      await api(`${base}/settings`, "PUT", {
        amountKRW: external ? 10001 : 0,
        capacity: 5,
        open: true,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      }),
    );
    return { postId: created.id, base, startsAt, endsAt };
  }
  try {
    const { postId, base, startsAt, endsAt } = await createEvent();
    const [application] =
      await db`insert into sliper.event_applications(post_id,user_id,attendee_name,contact,amount_krw,status,confirmed_at,expires_at) values(${postId},${account.userId},'행사 변경 테스트 참가자','test@example.invalid',0,'confirmed',now(),now()+interval '30 minutes') returning id,event_starts_at,refund_consent_at`;
    assert.ok(application, "The temporary participant was created");
    const ticket = data(
      await api<TicketView>(
        `${base}/ticket`,
        "POST",
        { applicationId: application.id },
        participantCookie,
      ),
    );
    const input = {
      kind: "reschedule",
      expectedRevision: 0,
      confirmed: true,
      reason: "장소 운영 사정으로 다음 날로 변경합니다.",
      startsAt: new Date(startsAt.getTime() + 86400000).toISOString(),
      endsAt: new Date(endsAt.getTime() + 86400000).toISOString(),
    };
    const initial = data(await api<EventLifecycleView>(`${base}/lifecycle`));
    assert.equal(initial.revision, 0);
    assert.equal(initial.canManage, true);
    assert.equal((await api(`${base}/lifecycle`, "POST", input, guest)).status, 401);
    assert.equal((await api(`${base}/lifecycle`, "POST", input, participantCookie)).status, 403);
    assert.equal(
      (await api(`${base}/lifecycle`, "POST", input, "", "https://untrusted.example.invalid"))
        .status,
      403,
    );
    const changed = data(await api<EventLifecycleView>(`${base}/lifecycle`, "POST", input));
    assert.equal(changed.revision, 1);
    assert.equal(changed.startsAt, input.startsAt);
    assert.equal(changed.changes.length, 1);
    assert.equal((await api(`${base}/lifecycle`, "POST", input)).status, 409);
    const [preserved] =
      await db`select status,event_starts_at,refund_consent_at from sliper.event_applications where id=${application.id}`;
    assert.equal(preserved!.status, "confirmed");
    assert.equal(
      new Date(preserved!.event_starts_at).toISOString(),
      new Date(application.event_starts_at).toISOString(),
    );
    assert.equal(preserved!.refund_consent_at, application.refund_consent_at);
    assert.equal(
      (await api(`${base}/check-in-preview`, "POST", { code: ticket.code })).status,
      404,
    );
    const replacement = data(
      await api<TicketView>(
        `${base}/ticket`,
        "POST",
        { applicationId: application.id },
        participantCookie,
      ),
    );
    assert.notEqual(replacement.code, ticket.code);
    assert.equal((await api("/api/participation/notices", "GET", undefined, guest)).status, 401);
    const notices = data(
      await api<EventNoticePage>("/api/participation/notices", "GET", undefined, participantCookie),
    );
    const notice = notices.items.find((item) => item.postId === postId);
    assert.ok(notice, "The affected participant receives a durable notice");
    assert.equal(notice.readAt, null);
    assert.equal(JSON.stringify(notices).includes(account.userId), false);
    assert.equal((await api(`${base}/notice-read`, "POST", { changeId: notice.id })).status, 404);
    assert.equal(
      (await api(`${base}/notice-read`, "POST", { changeId: notice.id }, guest)).status,
      401,
    );
    data(await api(`${base}/notice-read`, "POST", { changeId: notice.id }, participantCookie));
    const read = data(
      await api<EventNoticePage>("/api/participation/notices", "GET", undefined, participantCookie),
    );
    assert.ok(read.items.find((item) => item.id === notice.id)?.readAt);
    assert.equal(
      (
        await api(`${base}/lifecycle`, "POST", {
          ...input,
          expectedRevision: 1,
          endsAt: input.startsAt,
        })
      ).status,
      400,
    );
    assert.equal(data(await api<EventLifecycleView>(`${base}/lifecycle`)).revision, 1);
    const cancelled = data(
      await api<EventLifecycleView>(`${base}/lifecycle`, "POST", {
        kind: "cancel",
        expectedRevision: 1,
        confirmed: true,
        reason: "운영상 사정으로 행사를 취소합니다.",
      }),
    );
    assert.equal(cancelled.revision, 2);
    assert.ok(cancelled.cancelledAt);
    assert.equal(
      (await api(`${base}/ticket`, "POST", { applicationId: application.id }, participantCookie))
        .status,
      409,
    );
    assert.equal((await api(`${base}/check-in`, "POST", { code: replacement.code })).status, 409);
    assert.equal(
      (await api(`${base}/applications`, "POST", { consent: true }, participantCookie)).status,
      409,
    );
    assert.equal(
      (await api(`${base}/settings`, "PUT", { amountKRW: 0, capacity: 5, open: true })).status,
      409,
    );
    assert.equal(
      (await api(`${base}/lifecycle`, "POST", { ...input, expectedRevision: 2 })).status,
      409,
    );
    const overview = data(await api<EventOverview>(base, "GET", undefined, participantCookie));
    assert.equal(overview.application?.status, "confirmed");
    assert.equal(overview.canApply, false);
    assert.ok(overview.config?.cancelledAt);
    const room = data(
      await api<RoomView>(
        `/api/participation/rooms/${postId}`,
        "GET",
        undefined,
        participantCookie,
      ),
    );
    assert.ok(room.messages.some((message) => message.body.includes("행사 취소 안내")));
    assert.equal(
      (await fetch(origin + "/participation", { headers: { Cookie: participantCookie } })).status,
      200,
    );

    const external = await createEvent(true),
      reference = `fixture-${randomUUID()}`;
    const [post] = await db`select author_id from sliper.posts where id=${external.postId}`;
    const [externalApp] =
      await db`insert into sliper.event_applications(post_id,user_id,source,external_reference,attendee_name,contact,amount_krw,status,refund_consent_at) values(${external.postId},${account.userId},'external',${reference},'외부 결제 테스트 참가자','test@example.invalid',10001,'pending_approval',now()) returning id`;
    assert.ok(externalApp);
    await db`insert into sliper.external_receipts(application_id,post_id,reference,amount_krw,provider,verification,verified_by,state) values(${externalApp.id},${external.postId},${reference},10001,'http-fixture','manual',${post!.author_id},'paid')`;
    await db`update sliper.event_applications set status='confirmed',confirmed_at=now() where id=${externalApp.id}`;
    data(
      await api(`${external.base}/lifecycle`, "POST", {
        kind: "cancel",
        expectedRevision: 0,
        confirmed: true,
        reason: "외부 신청 행사 운영을 취소합니다.",
      }),
    );
    assert.equal(
      (
        await api(
          `${external.base}/external-confirmation`,
          "POST",
          { consent: true, refundConsent: true, externalReference: reference },
          participantCookie,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await api(`/api/participation/applications/${externalApp.id}/decision`, "POST", {
          decision: "approve",
          paymentChecked: true,
        })
      ).status,
      409,
    );
    const refunds = data(
      await api<RefundView>(`${external.base}/refunds`, "GET", undefined, participantCookie),
    );
    assert.equal(refunds.quote?.rate, 100);
    assert.equal(
      refunds.requests.find((request) => request.state === "pending")?.refundableKRW,
      10001,
    );
    assert.equal(
      refunds.requests.find((request) => request.state === "pending")?.cause,
      "host_cancel",
    );
    const [receipt] =
      await db`select state,refunded_amount_krw from sliper.external_receipts where application_id=${externalApp.id}`;
    assert.equal(receipt!.state, "paid");
    assert.equal(receipt!.refunded_amount_krw, null);
  } finally {
    try {
      for (const postId of fixturePosts)
        await db.begin(async (tx) => {
          await tx`delete from sliper.push_deliveries where post_id=${postId}`;
          await tx`delete from sliper.activity_events where source_key=${"post:" + postId}`;
          await tx`delete from sliper.refund_requests where post_id=${postId}`;
          await tx`delete from sliper.external_receipts where post_id=${postId}`;
          await tx`delete from sliper.event_changes where post_id=${postId}`;
          await tx`delete from sliper.event_applications where post_id=${postId}`;
          await tx`delete from sliper.posts where id=${postId}`;
        });
    } finally {
      await db.end();
    }
  }
});
