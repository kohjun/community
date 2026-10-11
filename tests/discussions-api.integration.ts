import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { createLocalTestSession, loadLocalTestAccount } from "../src/server/local-test-auth";
const origin = "http://127.0.0.1:3000";
const address = new URL(process.env.DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  address.hostname !== "127.0.0.1" ||
  address.port !== "55432" ||
  address.pathname !== "/sliper_dev" ||
  process.env.APP_ORIGIN !== origin
)
  throw new Error("Only the isolated local database is allowed.");
const account = loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
if (!account) throw new Error("Existing test account is required.");
const cookie = `sliper_test_session=${createLocalTestSession(account, "127.0.0.1:3000")}`;
async function api(path: string, method = "GET", body?: unknown, auth = "", from = origin) {
  const res = await fetch(origin + path, {
    method,
    headers: {
      Origin: from,
      "Content-Type": "application/json",
      ...(auth ? { Cookie: auth } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60000),
  });
  return { status: res.status, headers: res.headers, body: await res.json() };
}
test("HTTP story lifecycle: subtype, concurrent answer acceptance, deletion, safe search/share and server page markup", async () => {
  const db = postgres(address.href, { max: 1, prepare: false });
  const ids: string[] = [];
  const key = "discussion-" + randomUUID().slice(0, 8);
  try {
    const input = {
      categorySlug: "party",
      kind: "이야기",
      discussionType: "question",
      title: key + " 원본 제목",
      bodyMarkdown: key + " 비밀 정답",
      isAnonymous: false,
    };
    const created = await api("/api/community/posts", "POST", input);
    assert.equal(created.status, 200);
    let p = created.body.data;
    ids.push(p.id);
    assert.equal(
      (
        await api(
          `/api/community/posts/${p.id}/resolve`,
          "POST",
          { commentId: null, expectedUpdatedAt: p.updatedAt },
          "sliper_test_session=invalid",
        )
      ).status,
      401,
    );
    const comment = await api(
      "/api/community/comments",
      "POST",
      { postId: p.id, bodyMarkdown: "HTTP 검증 답변", isAnonymous: true },
      cookie,
    );
    assert.equal(comment.status, 200);
    const answerId = comment.body.data.comment.id;
    assert.equal(
      (
        await api(
          `/api/community/posts/${p.id}/resolve`,
          "POST",
          { commentId: answerId, expectedUpdatedAt: p.updatedAt },
          cookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await api(
          `/api/community/posts/${p.id}/resolve`,
          "POST",
          { commentId: answerId, expectedUpdatedAt: p.updatedAt },
          "",
          "https://invalid.example",
        )
      ).status,
      403,
    );
    const results = await Promise.all(
      [1, 2].map(() =>
        api(`/api/community/posts/${p.id}/resolve`, "POST", {
          commentId: answerId,
          expectedUpdatedAt: p.updatedAt,
        }),
      ),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const detail = (await api(`/api/community/posts/${p.id}`)).body.data;
    assert.equal(detail.acceptedAnswer.id, answerId);
    p = detail.post;
    assert.equal(
      (await api(`/api/community?focus=unanswered&search=${key}`)).body.data.posts.length,
      0,
    );
    assert.equal(
      (await api(`/api/community/comments/${answerId}`, "DELETE", undefined, cookie)).status,
      200,
    );
    assert.equal(
      (await api(`/api/community?focus=unanswered&search=${key}`)).body.data.posts[0].id,
      p.id,
    );
    p = (await api(`/api/community/posts/${p.id}`)).body.data.post;
    const spoiler = {
      ...input,
      spoiler: true,
      spoilerTitle: key + " 안전한 소개",
      spoilerSummary: "시청한 후 함께 읽어주세요",
      expectedUpdatedAt: p.updatedAt,
    };
    assert.equal((await api(`/api/community/posts/${p.id}`, "PATCH", spoiler)).status, 200);
    const list = await api(`/api/community?discussionType=question&search=${key}&page=1&limit=20`);
    assert.equal(list.status, 200);
    assert.match(list.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(list.body.data.posts[0].body, "");
    assert.equal(list.body.data.posts[0].title, spoiler.spoilerTitle);
    const search = await api(`/api/search?q=${encodeURIComponent(key + " 비밀")}`);
    assert.equal(search.status, 200);
    assert.equal(search.body.data.total, 0);
    const found = await api(`/api/search?q=${key}&discussionType=question`);
    assert.equal(found.status, 200);
    assert.equal(found.body.data.items[0].spoiler, true);
    for (const [path, expected] of [
      [`/stories?discussionType=question&focus=unanswered`, "답변 기다리는 질문"],
      [`/posts/${p.id}`, "본문과 댓글 펼쳐보기"],
      [`/search?q=${key}&discussionType=question`, "안전한 소개"],
    ]) {
      const response = await fetch(origin + path, { signal: AbortSignal.timeout(60000) });
      assert.equal(response.status, 200);
      const raw = await response.text();
      assert.ok(raw.includes(expected!));
      const rendered = raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
      assert.equal(rendered.includes(input.bodyMarkdown), false);
      assert.equal(rendered.includes(input.title), false);
    }
    const guest = await api(
      "/api/community?focus=interests",
      "GET",
      undefined,
      "sliper_test_session=invalid",
    );
    assert.equal(guest.body.data.interestFeed, "login");
    assert.equal((await api("/api/community?discussionType=invalid")).status, 400);
  } finally {
    for (const id of ids) await db`delete from sliper.posts where id=${id}`;
    await db.end();
  }
});
