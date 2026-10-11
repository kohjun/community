import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { ActionResult } from "../src/domain/contracts";
import type { BlockView, ReportView, SupportView } from "../src/domain/safety";

const origin = "http://127.0.0.1:3000";
const url = new URL(process.env.DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  process.env.APP_ORIGIN !== origin ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.pathname !== "/sliper_dev"
)
  throw new Error("Safety HTTP checks require the isolated local development database.");
const db = postgres(url.toString(), { prepare: false, max: 1 });
async function api<T>(path: string, method = "GET", body?: unknown, cookie = "", from = origin) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: from,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? null : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  return {
    status: response.status,
    result: (await response.json()) as ActionResult<T>,
    headers: response.headers,
  };
}
function data<T>(response: { status: number; result: ActionResult<T> }): T {
  assert.equal(response.status, 200, "Unexpected safety API status");
  assert.ok(response.result.ok, "Safety API did not return a success response");
  return response.result.data;
}

test("safety HTTP routes enforce identity and origin, preserve anonymity, and apply moderation/blocking/support", async () => {
  const memberId = randomUUID(),
    postId = randomUUID(),
    label = `http-safety-${randomUUID()}`;
  const invalidCookie = "sliper_test_session=invalid";
  try {
    const session = data(
      await api<{ authenticated: boolean; role: string | null }>("/api/auth/session"),
    );
    assert.equal(session.authenticated, true, "Loopback development identity must be available");
    assert.equal(session.role, "admin", "Run npm run staff:local before this local check");
    await db`insert into auth.users(id) values(${memberId})`;
    await db`insert into sliper.profiles(id,nickname) values(${memberId},'HTTP 검증 작성자')`;
    await db`insert into sliper.posts(id,category_slug,author_id,is_anonymous,title,body_markdown) values(${postId},'party',${memberId},true,${label},'신고와 차단 API 검증용으로만 생성한 임시 글입니다.')`;
    const payload = {
      targetType: "post",
      targetId: postId,
      reason: "spam",
      detail: "HTTP 통합 검증",
    };
    assert.equal(
      (await api("/api/safety/admin/reports", "GET", undefined, invalidCookie)).status,
      401,
    );
    assert.equal((await api("/api/safety/reports", "POST", payload, invalidCookie)).status, 401);
    assert.equal(
      (await api("/api/safety/reports", "POST", payload, "", "https://untrusted.example.invalid"))
        .status,
      403,
    );
    const report = data(await api<ReportView>("/api/safety/reports", "POST", payload));
    assert.equal(report.status, "open");
    assert.equal("snapshot" in report, false);
    assert.equal(
      JSON.stringify(report).includes(memberId),
      false,
      "Anonymous account IDs must stay private",
    );
    assert.equal((await api("/api/safety/reports", "POST", payload)).status, 409);
    const queue = data(await api<{ items: ReportView[] }>("/api/safety/admin/reports"));
    assert.ok(queue.items.some((item) => item.id === report.id && item.snapshot?.includes(label)));
    data(
      await api(`/api/safety/admin/reports/${report.id}`, "POST", {
        action: "hide",
        reason: "통합 검사에서 숨김 동작 확인",
      }),
    );
    assert.equal(
      (await api(`/api/community/posts/${postId}`, "GET", undefined, invalidCookie)).status,
      404,
    );
    const [original] = await db`select status,body_markdown from sliper.posts where id=${postId}`;
    assert.equal(original?.status, "published");
    assert.ok(original?.body_markdown, "Moderation must preserve the original post");
    data(
      await api(`/api/safety/admin/reports/${report.id}`, "POST", {
        action: "restore",
        reason: "통합 검사 완료로 원문 복원",
      }),
    );
    assert.equal(
      (await api(`/api/community/posts/${postId}`, "GET", undefined, invalidCookie)).status,
      200,
    );
    const block = data(
      await api<BlockView>("/api/safety/blocks", "POST", { targetType: "post", targetId: postId }),
    );
    assert.equal(block.label, "익명 사용자");
    assert.equal(JSON.stringify(block).includes(memberId), false);
    assert.equal((await api(`/api/community/posts/${postId}`)).status, 404);
    assert.equal(
      (await api(`/api/community/posts/${postId}`, "GET", undefined, invalidCookie)).status,
      200,
    );
    data(await api(`/api/safety/blocks/${block.id}`, "DELETE"));
    assert.equal((await api(`/api/community/posts/${postId}`)).status, 200);
    const ticket = data(
      await api<{ id: string }>("/api/safety/support", "POST", {
        category: "other",
        subject: label,
        body: "문의 접수 및 운영 답변 경계를 실제 HTTP로 확인합니다.",
      }),
    );
    data(
      await api(`/api/safety/admin/support/${ticket.id}`, "POST", {
        body: "문의 처리 검증을 완료했습니다.",
        close: true,
      }),
    );
    const tickets = data(await api<{ items: SupportView[] }>("/api/safety/support"));
    const answered = tickets.items.find((item) => item.id === ticket.id);
    assert.equal(answered?.status, "closed");
    assert.equal(answered?.replies.length, 1);
    assert.equal("userId" in (answered ?? {}), false);
    assert.equal("authorId" in (answered?.replies[0] ?? {}), false);
    assert.equal((await api("/api/safety/support", "GET", undefined, invalidCookie)).status, 401);
    const logout = await api<{ loggedOut: boolean }>("/api/auth/logout", "POST", {});
    data(logout);
    const guest = logout.headers.get("set-cookie")?.split(";")[0];
    assert.ok(guest, "Logout must establish an explicit guest state");
    assert.equal(
      data(await api<{ authenticated: boolean }>("/api/auth/session", "GET", undefined, guest))
        .authenticated,
      false,
    );
    assert.equal((await api("/api/safety/admin/reports", "GET", undefined, guest)).status, 401);
  } finally {
    await db.begin(async (tx) => {
      await tx`delete from sliper.moderation_audit where target_id=${postId} or target_id in (select id from sliper.support_tickets where subject=${label})`;
      await tx`delete from sliper.support_tickets where subject=${label}`;
      await tx`delete from sliper.content_restrictions where target_type='post' and target_id=${postId}`;
      await tx`delete from sliper.safety_reports where target_type='post' and target_id=${postId}`;
      await tx`delete from sliper.posts where id=${postId} and author_id=${memberId}`;
      await tx`delete from auth.users where id=${memberId}`;
    });
    await db.end();
  }
});
