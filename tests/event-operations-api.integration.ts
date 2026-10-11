import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import QRCode from "qrcode";
import type { ActionResult } from "../src/domain/contracts";
import type { CommunityPost } from "../src/domain/community";
import type {
  AdmissionCandidate,
  AdmissionRoster,
  TicketView,
} from "../src/domain/event-operations";
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
  throw new Error("QR HTTP checks require the isolated local development database.");
const account = loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
if (!account) throw new Error("Set up the existing local test account before QR HTTP checks.");
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
  assert.equal(response.status, 200, "Unexpected QR API status");
  assert.ok(response.result.ok, "QR API returned an error");
  return response.result.data;
}
test("QR issuance, private preview, explicit admission and duplicate protection work through real HTTP", async () => {
  let postId: string | null = null;
  try {
    const created = data(
      await api<CommunityPost>("/api/community/posts", "POST", {
        categorySlug: "party",
        kind: "모집",
        title: `HTTP QR 검사 ${randomUUID()}`,
        bodyMarkdown: "QR 입장 API 검사를 위한 임시 행사입니다.",
        isAnonymous: false,
        location: "검사용 행사장",
        eventDate: "검사용 일정",
        eventFee: "무료",
        imageAssetIds: [],
      }),
    );
    postId = created.id;
    const startsAt = new Date(Date.now() + 1800000),
      endsAt = new Date(Date.now() + 5400000),
      base = `/api/participation/events/${postId}`;
    data(
      await api(`${base}/settings`, "PUT", {
        amountKRW: 0,
        capacity: 5,
        open: true,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      }),
    );
    const [application] =
      await db`insert into sliper.event_applications(post_id,user_id,attendee_name,contact,amount_krw,status,confirmed_at,expires_at) values(${postId},${account.userId},'QR 테스트 참가자','test@example.invalid',0,'confirmed',now(),now()+interval '30 minutes') returning id`;
    assert.ok(application, "The temporary participant was created");
    assert.equal(
      (await api(`${base}/ticket`, "POST", { applicationId: application.id }, guest)).status,
      401,
    );
    const ticket = data(
      await api<TicketView>(
        `${base}/ticket`,
        "POST",
        { applicationId: application.id },
        participantCookie,
      ),
    );
    const qr = await QRCode.toBuffer(
      `${origin}/management/events/${postId}/check-in#ticket=${ticket.code}`,
      { type: "png", width: 360, margin: 4 },
    );
    assert.ok(qr.byteLength > 100, "A usable QR image must be generated");
    assert.equal(
      (await api(`${base}/check-in-preview`, "POST", { code: ticket.code }, participantCookie))
        .status,
      403,
    );
    assert.equal(
      (await api(`${base}/check-in-preview`, "POST", { code: ticket.code }, guest)).status,
      401,
    );
    assert.equal(
      (
        await api(
          `${base}/check-in`,
          "POST",
          { code: ticket.code },
          "",
          "https://untrusted.example.invalid",
        )
      ).status,
      403,
    );
    const preview = data(
      await api<AdmissionCandidate>(`${base}/check-in-preview`, "POST", { code: ticket.code }),
    );
    assert.equal(preview.checkedAt, null);
    assert.equal(preview.canAdmit, true);
    assert.equal(data(await api<AdmissionRoster>(`${base}/check-ins`)).checkedIn, 0);
    const admitted = data(
      await api<AdmissionCandidate>(`${base}/check-in`, "POST", { code: ticket.code }),
    );
    assert.ok(admitted.checkedAt);
    const again = data(
      await api<AdmissionCandidate>(`${base}/check-in`, "POST", { code: ticket.code }),
    );
    assert.equal(again.checkedAt, admitted.checkedAt);
    assert.equal(data(await api<AdmissionRoster>(`${base}/check-ins`)).checkedIn, 1);
    assert.equal(
      (await api(`${base}/ticket`, "POST", { applicationId: application.id }, participantCookie))
        .status,
      409,
    );
    assert.equal((await api(`${base}/finalize`, "POST", {})).status, 409);
    assert.equal(
      (
        await api(
          `${base}/reviews`,
          "POST",
          {
            title: "미리 작성하는 후기",
            bodyMarkdown: "행사가 끝나기 전에는 인증 후기를 남기지 못해야 합니다.",
            rating: 5,
          },
          participantCookie,
        )
      ).status,
      409,
    );
    assert.equal(
      (await api(`${base}/payment-review`, "GET", undefined, participantCookie)).status,
      403,
    );
    data(await api(`${base}/payment-review`));
    for (const page of [
      `/management/events/${postId}/check-in`,
      `/management/events/${postId}/payments`,
    ])
      assert.equal((await fetch(origin + page)).status, 200);
  } finally {
    try {
      if (postId)
        await db.begin(async (tx) => {
          await tx`delete from sliper.push_deliveries where post_id=${postId}`;
          await tx`delete from sliper.activity_events where source_key=${"post:" + postId}`;
          await tx`delete from sliper.event_applications where post_id=${postId}`;
          await tx`delete from sliper.posts where id=${postId}`;
        });
    } finally {
      await db.end();
    }
  }
});
