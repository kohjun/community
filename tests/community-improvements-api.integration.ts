import "dotenv/config";
import assert from "node:assert/strict";
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
  throw new Error("Only the isolated local test database is allowed.");
const owner = "00000000-0000-4000-8000-000000000001";
const account = loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
if (!account) throw new Error("Existing test account required; credentials are not regenerated.");
const memberCookie = `sliper_test_session=${createLocalTestSession(account, "127.0.0.1:3000")}`;
async function api(path: string, method = "GET", body?: unknown, cookie = "", from = origin) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Origin: from,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60_000),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}
test("metrics API and rendered home enforce privacy, validation, origin and period links over HTTP", async () => {
  const db = postgres(address.href, { max: 1, prepare: false });
  const original =
    await db`select user_id, role from sliper.staff_roles where user_id in (${owner}, ${account!.userId})`;
  try {
    await db`insert into sliper.staff_roles (user_id, role) values (${owner}, 'admin') on conflict (user_id) do update set role='admin'`;
    await db`delete from sliper.staff_roles where user_id=${account!.userId}`;
    const guest = await api(
      "/api/admin/metrics?days=7",
      "GET",
      undefined,
      "sliper_test_session=invalid",
    );
    assert.equal(guest.status, 401);
    assert.equal(
      (await api("/api/admin/metrics?days=7", "GET", undefined, memberCookie)).status,
      403,
    );
    const metrics = await api("/api/admin/metrics?days=28");
    assert.equal(metrics.status, 200);
    assert.equal(metrics.body.ok, true);
    assert.match(metrics.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(metrics.body.data.days, 28);
    assert.ok(metrics.body.data.collectionStartedAt);
    assert.equal(metrics.body.data.retentionDays, 90);
    assert.equal(JSON.stringify(metrics.body).includes(owner), false);
    assert.equal(JSON.stringify(metrics.body).includes(account!.userId), false);
    assert.equal((await api("/api/admin/metrics?days=999")).status, 400);
    assert.equal((await api("/api/analytics/visit", "POST", { userId: owner })).status, 400);
    assert.equal(
      (await api("/api/analytics/visit", "POST", {}, "", "https://other.example")).status,
      403,
    );
    assert.equal(
      (await api("/api/analytics/visit", "POST", {}, memberCookie)).body.data.collected,
      false,
      "known local test account is excluded",
    );
    const at = new Date(Date.now() - 1000).toISOString();
    const popular = await api(
      "/api/community?sort=popular&period=week&rankingAt=" +
        encodeURIComponent(at) +
        "&page=1&limit=20",
    );
    assert.equal(popular.status, 200);
    assert.equal(popular.body.data.rankingAt, at);
    assert.equal(popular.body.data.pagination.pageSize, 20);
    for (const post of popular.body.data.posts) assert.ok(post.popularityScore > 0);
    for (const [path, text] of [
      ["/", "기획 자료 찾기"],
      ["/stories?sort=popular&period=week", "이번 주"],
      ["/admin/metrics?days=28", "커뮤니티 이용 현황"],
    ]) {
      const response = await fetch(origin + path, { signal: AbortSignal.timeout(60_000) });
      assert.equal(response.status, 200, path ?? "page");
      const html = await response.text();
      assert.ok(html.includes(text!), text ?? "page content");
    }
    for (const path of ["/?view=mine", "/stories?view=bookmarks"]) {
      const response = await fetch(origin + path, {
        headers: { Cookie: "sliper_test_session=invalid" },
        redirect: "manual",
        signal: AbortSignal.timeout(60_000),
      });
      assert.equal(response.status, 307);
      assert.match(response.headers.get("location") ?? "", /^\/login\?returnTo=/);
    }
    const privatePage = await fetch(origin + "/admin/metrics", {
      headers: { Cookie: "sliper_test_session=invalid" },
      signal: AbortSignal.timeout(60_000),
    });
    assert.ok((await privatePage.text()).includes("관리자 권한이 있는 계정으로 로그인"));
  } finally {
    await db.begin(async (tx) => {
      await tx`delete from sliper.staff_roles where user_id in (${owner}, ${account!.userId})`;
      for (const row of original)
        await tx`insert into sliper.staff_roles (user_id,role) values (${row.user_id},${row.role})`;
    });
    await db.end();
  }
});
