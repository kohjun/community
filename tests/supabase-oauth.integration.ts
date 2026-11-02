import "dotenv/config";
import assert from "node:assert/strict";
import { before, test } from "node:test";

function targetOrigin() {
  try {
    const origin = new URL(process.env.APP_ORIGIN ?? "");
    const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    if (
      process.env.SLIPER_AUTH_MODE !== "supabase" ||
      process.env.LOCAL_DATABASE !== "0" ||
      origin.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(origin.hostname) ||
      origin.port !== "3000" ||
      project.protocol !== "https:" ||
      !project.hostname.endsWith(".supabase.co")
    )
      throw new Error();
    return { origin: origin.origin, project: project.origin };
  } catch {
    throw new Error(
      "OAuth integration checks require an explicit loopback Supabase development configuration.",
    );
  }
}
const target = targetOrigin();
const request = (url: string, init: RequestInit = {}) =>
  fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(15000) });

before(async () => {
  const response = await request(target.origin + "/api/auth/session");
  const value = await response.json();
  assert.equal(response.status, 200);
  assert.ok(value.ok && value.data?.mode === "supabase" && value.data.available);
  assert.equal(
    value.data.authenticated,
    false,
    "A fresh HTTP client must not inherit a local test identity.",
  );
});

test("OAuth POST rejects foreign origins and unsupported providers before leaving the app", async () => {
  for (const fields of [
    { origin: "https://untrusted.invalid", provider: "kakao" },
    { origin: target.origin, provider: "github" },
  ]) {
    const response = await request(target.origin + "/api/auth/start", {
      method: "POST",
      headers: { origin: fields.origin, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ provider: fields.provider }),
    });
    const location = new URL(response.headers.get("location") ?? "/", target.origin);
    assert.equal(response.status, 303);
    assert.ok(location.origin === target.origin && location.pathname === "/login");
    assert.equal(location.searchParams.get("error"), "provider");
  }
});

test("real Supabase handoff omits Kakao email, preserves Google defaults and ignores forged OAuth fields", async () => {
  for (const provider of ["kakao", "google"]) {
    const response = await request(target.origin + "/api/auth/start", {
      method: "POST",
      headers: { origin: target.origin, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        provider,
        returnTo: "/mypage",
        scope: "account_email",
        redirect_uri: "https://untrusted.invalid",
      }),
    });
    assert.equal(response.status, 303);
    const start = new URL(response.headers.get("location") ?? "/", target.origin);
    assert.ok(start.origin === target.project && start.pathname === "/auth/v1/authorize");
    assert.ok(start.searchParams.get("code_challenge"));
    assert.equal(start.searchParams.get("code_challenge_method"), "s256");
    assert.ok(
      /httponly/i.test(response.headers.get("set-cookie") ?? ""),
      "PKCE cookies must be HTTP-only; values are never printed.",
    );
    const callback = new URL(start.searchParams.get("redirect_to") ?? "/", target.origin);
    assert.ok(callback.origin === target.origin && callback.pathname === "/auth/callback");
    assert.equal(callback.searchParams.get("returnTo"), "/mypage");
    const handoff = await request(start.href);
    assert.equal(handoff.status, 302);
    const destination = new URL(handoff.headers.get("location") ?? "/", target.project);
    assert.equal(
      destination.hostname,
      provider === "kakao" ? "kauth.kakao.com" : "accounts.google.com",
    );
    assert.ok(
      destination.searchParams.get("redirect_uri") === target.project + "/auth/v1/callback",
    );
    const scopes = (destination.searchParams.get("scope") ?? "")
      .split(/[ ,]+/)
      .filter(Boolean)
      .sort();
    assert.deepEqual(
      scopes,
      provider === "kakao" ? ["profile_image", "profile_nickname"] : ["email", "profile"],
    );
  }
});
