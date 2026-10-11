import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import test from "node:test";
import type { ActionResult } from "../src/domain/contracts";
import type { CommunityPost, CommunitySnapshot } from "../src/domain/community";
import type { MyProfile } from "../src/domain/profile";
import { configuredLocalTestLanHost } from "../src/server/local-test-access";

const origin = "http://127.0.0.1:3000";
const database = new URL(process.env.DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  process.env.APP_ORIGIN !== origin ||
  database.hostname !== "127.0.0.1" ||
  database.port !== "55432" ||
  database.pathname !== "/sliper_dev"
)
  throw new Error("Test-login HTTP checks require the isolated local development database.");
const password = process.env.SLIPER_TEST_PASSWORD;
if (!password)
  throw new Error(
    "Supply the test password in SLIPER_TEST_PASSWORD for this process only; never commit it.",
  );
const credentials = { username: "test@sliper.local", password };
type SessionView = { available: boolean; authenticated: boolean; nickname: string | null };

async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  host = "127.0.0.1:3000",
  cookie = "",
  from = `http://${host}`,
) {
  return new Promise<{
    status: number;
    result: ActionResult<T>;
    cookie: string;
    headers: import("node:http").IncomingHttpHeaders;
  }>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = httpRequest(
      new URL(path, origin),
      {
        method,
        headers: {
          Host: host,
          Origin: from,
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        timeout: 60_000,
      },
      (incoming) => {
        const parts: Buffer[] = [];
        incoming.on("data", (part: Buffer) => parts.push(part));
        incoming.on("error", reject);
        incoming.on("end", () => {
          try {
            resolve({
              status: incoming.statusCode ?? 0,
              result: JSON.parse(Buffer.concat(parts).toString("utf8")) as ActionResult<T>,
              cookie:
                incoming.headers["set-cookie"]
                  ?.find((value) => value.startsWith("sliper_test_session="))
                  ?.split(";")[0] ?? "",
              headers: incoming.headers,
            });
          } catch {
            reject(new Error("Test-login API returned an unexpected non-JSON response."));
          }
        });
      },
    );
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("Test-login API timed out.")));
    request.end(payload);
  });
}
function data<T>(response: { status: number; result: ActionResult<T> }): T {
  assert.equal(response.status, 200, "Unexpected test-login API status");
  if (!response.result.ok) throw new Error(response.result.error.message);
  return response.result.data;
}

test("password login sets a private session, selects a separate player, and logout prevents fixture fallback", async () => {
  assert.deepEqual(data(await api<SessionView>("/api/auth/test/session")), {
    available: true,
    authenticated: false,
    nickname: null,
  });
  assert.equal(
    (
      await api(
        "/api/auth/test/login",
        "POST",
        credentials,
        undefined,
        "",
        "https://untrusted.example.invalid",
      )
    ).status,
    403,
  );
  assert.equal(
    (await api("/api/auth/test/login", "POST", { ...credentials, userId: randomUUID() })).status,
    400,
  );
  assert.equal(
    (
      await api("/api/auth/test/login", "POST", {
        ...credentials,
        password: "incorrect-test-password",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await api("/api/auth/test/login", "POST", {
        ...credentials,
        username: "unknown@sliper.local",
      })
    ).status,
    401,
  );
  const login = await api<{ nickname: string; redirect: string }>(
    "/api/auth/test/login",
    "POST",
    credentials,
  );
  const result = data(login);
  assert.equal(result.nickname, "테스트플레이어");
  assert.ok(result.redirect === "/" || result.redirect === "/signup");
  assert.ok(login.cookie, "A signed test session must be returned");
  const cookieOptions =
    login.headers["set-cookie"]?.find((value) => value.startsWith("sliper_test_session=")) ?? "";
  assert.ok(
    /HttpOnly/i.test(cookieOptions) &&
      /SameSite=lax/i.test(cookieOptions) &&
      /Max-Age=604800/.test(cookieOptions),
    "The session needs private cookie attributes and a seven-day expiry",
  );
  assert.match(login.headers["cache-control"] ?? "", /private.*no-store/);
  try {
    assert.deepEqual(
      data(
        await api<SessionView>("/api/auth/test/session", "GET", undefined, undefined, login.cookie),
      ),
      { available: true, authenticated: true, nickname: "테스트플레이어" },
    );
    const me = data(
      await api<MyProfile>("/api/community/me", "GET", undefined, undefined, login.cookie),
    );
    assert.equal(me.nickname, "테스트플레이어");
    assert.equal(
      data(
        await api<CommunitySnapshot>("/api/community", "GET", undefined, undefined, login.cookie),
      ).canWrite,
      true,
    );
    assert.equal(
      (await api("/api/community/me", "GET", undefined, undefined, "sliper_test_session=invalid"))
        .status,
      401,
    );
    assert.equal(
      (await api("/api/community/me", "GET", undefined, "localhost:3000", login.cookie)).status,
      401,
    );
    assert.equal(
      (
        await api(
          "/api/auth/test/logout",
          "POST",
          {},
          undefined,
          login.cookie,
          "https://untrusted.example.invalid",
        )
      ).status,
      403,
    );
  } finally {
    const logout = await api<{ loggedOut: boolean }>(
      "/api/auth/test/logout",
      "POST",
      {},
      undefined,
      login.cookie,
    );
    assert.deepEqual(data(logout), { loggedOut: true });
    assert.ok(logout.cookie, "Logout must replace the session with an explicit signed guest state");
    assert.equal(
      (await api("/api/community/me", "GET", undefined, undefined, logout.cookie)).status,
      401,
    );
    assert.equal(
      data(
        await api<CommunitySnapshot>("/api/community", "GET", undefined, undefined, logout.cookie),
      ).canWrite,
      false,
    );
    assert.equal(
      data(
        await api<SessionView>(
          "/api/auth/test/session",
          "GET",
          undefined,
          undefined,
          logout.cookie,
        ),
      ).authenticated,
      false,
    );
  }
});

test("configured Wi-Fi Host requires password login for profile access and post creation", async () => {
  const host = configuredLocalTestLanHost(process.env.SLIPER_LAN_HOST);
  assert.ok(host, "Set SLIPER_LAN_HOST to the same private IPv4 used by the local server");
  assert.equal((await api("/api/community/me", "GET", undefined, host)).status, 401);
  assert.equal(
    (await api("/api/auth/test/login", "POST", credentials, "192.0.2.42:3000")).status,
    403,
  );
  const login = await api("/api/auth/test/login", "POST", credentials, host);
  data(login);
  assert.ok(login.cookie, "Wi-Fi login must return its own signed session");
  let createdId: string | undefined;
  try {
    assert.equal(
      data(await api<MyProfile>("/api/community/me", "GET", undefined, host, login.cookie))
        .nickname,
      "테스트플레이어",
    );
    assert.equal(
      data(await api<CommunitySnapshot>("/api/community", "GET", undefined, host, login.cookie))
        .canWrite,
      true,
    );
    const post = data(
      await api<CommunityPost>(
        "/api/community/posts",
        "POST",
        {
          categorySlug: "party",
          kind: "이야기",
          title: `[테스트 계정 검증 ${randomUUID().slice(0, 8)}]`,
          bodyMarkdown: "비밀번호로 로그인한 별도 테스트 플레이어의 LAN 글쓰기 확인입니다.",
          isAnonymous: true,
        },
        host,
        login.cookie,
      ),
    );
    createdId = post.id;
    assert.equal(post.isMine, true);
    assert.equal(
      (await api(`/api/community/posts/${post.id}`, "DELETE", undefined, host)).status,
      401,
    );
    assert.equal(
      (
        await api(
          `/api/community/posts/${post.id}`,
          "DELETE",
          undefined,
          host,
          login.cookie,
          "http://127.0.0.1:3000",
        )
      ).status,
      403,
    );
  } finally {
    if (createdId)
      data(await api(`/api/community/posts/${createdId}`, "DELETE", undefined, host, login.cookie));
    const logout = await api("/api/auth/test/logout", "POST", {}, host, login.cookie);
    data(logout);
    assert.equal(
      (await api("/api/community/me", "GET", undefined, host, logout.cookie)).status,
      401,
    );
  }
});
