import "dotenv/config";
import assert from "node:assert/strict";
import test from "node:test";

const origin = "http://127.0.0.1:3000";
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  process.env.APP_ORIGIN !== origin
)
  throw new Error("Advertising HTTP checks require the isolated local development server.");

test("local advertising keeps Google requests and publisher verification absent across public and personal routes", async () => {
  for (const path of [
    "/",
    "/stories",
    "/lightning",
    "/archive",
    "/archive?mine=true",
    "/stories?view=bookmarks",
    "/settings/appeals",
    "/policies/privacy",
  ]) {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(60000) });
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.equal(
      /<script[^>]*src=["'][^"']*pagead2[.]googlesyndication[.]com/i.test(html),
      false,
      path,
    );
    assert.equal(/<ins[^>]*class=["'][^"']*adsbygoogle/i.test(html), false, path);
    assert.equal(/<meta[^>]*name=["']google-adsense-account/i.test(html), false, path);
    assert.equal(html.includes("ca-pub-"), false, path);
    if (path === "/policies/privacy") assert.ok(html.includes("외부 광고 서비스"));
  }
  for (const method of ["GET", "HEAD"]) {
    const response = await fetch(origin + "/ads.txt", {
      method,
      signal: AbortSignal.timeout(60000),
    });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.text()).includes("google.com,"), false);
  }
});
