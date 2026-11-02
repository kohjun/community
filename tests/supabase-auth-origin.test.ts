import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthOriginError,
  configureAuthOrigin,
  normalizeAuthOrigin,
  planAuthOrigin,
} from "../scripts/lib/supabase-auth-origin";

const origin = "https://211.188.59.204:13000";
const projectRef = "a".repeat(20);
const token = ["sbp", "test".repeat(8)].join("_");
const current = {
  site_url: "http://localhost:3000",
  uri_allow_list: "http://localhost:3000/**, http://127.0.0.1:3000/auth/callback**",
};
function mockApi(config = current, patchStatus = 200) {
  let state = { ...config };
  const calls: { method: string; body: unknown }[] = [];
  const fetcher = (async (input, init) => {
    assert.equal(String(input), `https://api.supabase.com/v1/projects/${projectRef}/config/auth`);
    assert.equal(init?.redirect, "error");
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${token}`);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init?.method ?? "GET", body });
    if (init?.method === "PATCH") {
      if (patchStatus !== 200)
        return new Response("provider-secret-must-not-be-shown", { status: patchStatus });
      assert.deepEqual(Object.keys(body).sort(), ["site_url", "uri_allow_list"]);
      state = body;
    }
    return Response.json({ ...state, external_google_secret: "must-not-be-retained" });
  }) as typeof fetch;
  return { fetcher, calls, getState: () => state };
}
test("origin validation requires public HTTPS and no URL path, credentials or query", () => {
  assert.equal(normalizeAuthOrigin(origin + "/"), origin);
  for (const invalid of [
    "http://211.188.59.204:13000",
    "https://localhost",
    origin + "/login",
    origin + "?a=b",
    "https://u:p@example.com",
    "https://*.example.com",
  ])
    assert.throws(() => normalizeAuthOrigin(invalid), /INVALID_ORIGIN/);
});
test("plan changes Site URL for public IP, preserves redirects and limits wildcard to callback query", () => {
  const plan = planAuthOrigin({ ...current, external_google_secret: "private" }, origin);
  assert.equal(plan.next.site_url, origin);
  assert.ok(plan.next.uri_allow_list.startsWith(current.uri_allow_list + ","));
  assert.ok(plan.next.uri_allow_list.endsWith(origin + "/auth/callback\\?returnTo=**"));
  assert.equal(plan.addedRedirectCount, 2);
  assert.deepEqual(Object.keys(plan.previous).sort(), ["site_url", "uri_allow_list"]);
  assert.equal(JSON.stringify(plan).includes("private"), false);
  assert.equal(planAuthOrigin(plan.next, origin).changed, false);
});
test("default plan uses GET only and never backs up or mutates", async () => {
  const api = mockApi();
  const result = await configureAuthOrigin({
    projectRef,
    origin,
    token,
    apply: false,
    fetcher: api.fetcher,
    backup: async () => assert.fail("unexpected backup"),
  });
  assert.equal(result.applied, false);
  assert.equal(result.verified, false);
  assert.deepEqual(
    api.calls.map((call) => call.method),
    ["GET"],
  );
  assert.equal(JSON.stringify(result).includes(token), false);
});
test("apply backs up URL fields, patches only two fields, verifies, and next apply is a no-op", async () => {
  const api = mockApi();
  const backups: unknown[] = [];
  const options = {
    projectRef,
    origin,
    token,
    apply: true,
    fetcher: api.fetcher,
    backup: async (value: unknown) => {
      backups.push(value);
    },
  };
  const result = await configureAuthOrigin(options);
  assert.equal(result.applied, true);
  assert.equal(result.verified, true);
  assert.deepEqual(backups, [current]);
  assert.deepEqual(
    api.calls.map((call) => call.method),
    ["GET", "GET", "PATCH", "GET"],
  );
  assert.equal((await configureAuthOrigin(options)).applied, false);
  assert.equal(backups.length, 1);
});
test("HTTP failures expose status only and abort before verification", async () => {
  const api = mockApi(current, 403);
  await assert.rejects(
    configureAuthOrigin({
      projectRef,
      origin,
      token,
      apply: true,
      fetcher: api.fetcher,
      backup: async () => {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof AuthOriginError);
      assert.equal(error.code, "MANAGEMENT_HTTP_403");
      assert.equal(error.message.includes("provider-secret"), false);
      return true;
    },
  );
});
test("rejects changed configuration before patch and rejects non-Management credentials", async () => {
  let reads = 0;
  const fetcher = (async () =>
    Response.json({
      ...current,
      site_url: ++reads > 1 ? "https://changed.example" : current.site_url,
    })) as typeof fetch;
  await assert.rejects(
    configureAuthOrigin({
      projectRef,
      origin,
      token,
      apply: true,
      fetcher,
      backup: async () => assert.fail("backup should not run"),
    }),
    /CONFIGURATION_CHANGED/,
  );
  for (const invalidToken of [
    "",
    "sb_publishable_example",
    "sb_secret_example",
    "eyJhbGci.invalid.jwt",
  ]) {
    await assert.rejects(
      configureAuthOrigin({
        projectRef,
        origin,
        token: invalidToken,
        apply: false,
        fetcher: (() => assert.fail("network should not run")) as typeof fetch,
      }),
      /SCOPED_MANAGEMENT_TOKEN_REQUIRED/,
    );
  }
});
