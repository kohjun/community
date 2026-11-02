import assert from "node:assert/strict";
import test from "node:test";
import { canonicalLocalNavigation, isAllowedRequestOrigin } from "../src/server/request-origin";
const canonical = "http://127.0.0.1:3000";
function request(origin: string | undefined, host: string, site = "same-origin") {
  return new Request(`${canonical}/api/community/posts/id/view`, {
    method: "POST",
    headers: { Host: host, "Sec-Fetch-Site": site, ...(origin ? { Origin: origin } : {}) },
  });
}
test("localhost and 127.0.0.1 browser requests are allowed only against their own development Host", () => {
  for (const origin of [canonical, "http://localhost:3000"])
    assert.equal(
      isAllowedRequestOrigin(request(origin, new URL(origin).host), canonical, true),
      true,
    );
  assert.equal(
    isAllowedRequestOrigin(request("http://localhost:3000", "127.0.0.1:3000"), canonical, true),
    false,
  );
  assert.equal(
    isAllowedRequestOrigin(request(canonical, "localhost:3000"), canonical, true),
    false,
  );
});
test("development alias support keeps external sites, missing origins, wrong ports and forged hosts blocked", () => {
  for (const origin of [
    undefined,
    "null",
    "https://untrusted.example",
    "http://localhost:3001",
    "http://localhost.attacker.example:3000",
    "https://localhost:3000",
  ])
    assert.equal(isAllowedRequestOrigin(request(origin, "localhost:3000"), canonical, true), false);
  assert.equal(
    isAllowedRequestOrigin(request("http://localhost:3000", "attacker.example"), canonical, true),
    false,
  );
  assert.equal(
    isAllowedRequestOrigin(request(canonical, "127.0.0.1:3000", "cross-site"), canonical, true),
    false,
  );
});
test("production and remote configurations keep exactly the configured Origin", () => {
  assert.equal(
    isAllowedRequestOrigin(request("http://localhost:3000", "localhost:3000"), canonical, false),
    false,
  );
  assert.equal(
    isAllowedRequestOrigin(request(canonical, "127.0.0.1:3000"), canonical, false),
    true,
  );
  const deployed = "https://sliper.example";
  assert.equal(
    isAllowedRequestOrigin(request("http://localhost:3000", "localhost:3000"), deployed, true),
    false,
  );
  assert.equal(isAllowedRequestOrigin(request(deployed, "sliper.example"), deployed, false), true);
});

test("Supabase loopback page navigation keeps the canonical host and preserves path and filters", () => {
  const request = new Request("http://localhost:3000/stories?sort=popular&page=2", {
    headers: { Host: "localhost:3000" },
  });
  assert.equal(
    canonicalLocalNavigation(request, canonical)?.href,
    canonical + "/stories?sort=popular&page=2",
  );
  assert.equal(canonicalLocalNavigation(new Request(canonical + "/login"), canonical), null);
  assert.equal(canonicalLocalNavigation(request, "https://sliper.example"), null);
  assert.equal(
    canonicalLocalNavigation(new Request("http://other.example:3000/"), canonical),
    null,
  );
});
test("canonical navigation never forwards mutations, API calls or OAuth callback credentials", () => {
  for (const path of [
    "/api/auth/session",
    "/api/analytics/visit",
    "/auth/callback?code=placeholder",
    "/_next/data",
  ])
    assert.equal(
      canonicalLocalNavigation(new Request("http://localhost:3000" + path), canonical),
      null,
    );
  for (const method of ["POST", "PATCH", "DELETE", "OPTIONS"])
    assert.equal(
      canonicalLocalNavigation(new Request("http://localhost:3000/login", { method }), canonical),
      null,
    );
});
test("canonical navigation cannot turn a hostile pathname into an external redirect", () => {
  for (const path of [
    "//other.example/login",
    "/%2f%2fother.example",
    "/stories?returnTo=https://other.example",
  ])
    assert.equal(
      canonicalLocalNavigation(new Request("http://localhost:3000" + path), canonical)?.origin,
      canonical,
    );
});
