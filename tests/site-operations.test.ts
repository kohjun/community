import test from "node:test";
import assert from "node:assert/strict";
import { readSiteOperations, supportMailto } from "../src/domain/site-operations";
import {
  publicPageMetadata,
  publicSitemap,
  searchOrigin,
  skipSessionRefresh,
} from "../src/domain/search-visibility";
const env = {
  NODE_ENV: "production",
  APP_ORIGIN: "https://sliper.kr",
  SLIPER_SEARCH_INDEXING_ENABLED: "true",
};
test("contact is publicly usable without account identity and unsafe mail headers cannot be injected", () => {
  const config = readSiteOperations({
    SLIPER_SUPPORT_EMAIL: "bad\r\nBcc: x@test.com",
    SLIPER_OPERATOR_NAME: "\u0000invalid",
  });
  assert.equal(config.supportEmail, "kohjun1234@gmail.com");
  assert.equal(config.operatorName, "Team sliper");
  assert.equal(config.businessComplete, false);
  assert.equal(config.privacyReviewed, false);
  assert.equal(supportMailto("valid@example.com\r\nBcc:test@example.com"), null);
  assert.equal(
    supportMailto(config.supportEmail, "개인정보 삭제 요청"),
    "mailto:kohjun1234@gmail.com?subject=" + encodeURIComponent("개인정보 삭제 요청"),
  );
});
test("only explicit public pages enter sitemap and indexing never includes member records or query state", () => {
  const urls = publicSitemap(env).map((item) => item.url);
  assert.ok(urls.includes("https://sliper.kr/archive"));
  assert.ok(urls.includes("https://sliper.kr/hosting-guide"));
  for (const route of [
    "/records/id",
    "/mypage",
    "/players/id",
    "/search",
    "/support",
    "/archive/id",
    "/posts/id",
    "/admin",
  ]) {
    assert.equal(
      urls.some((url) => url === "https://sliper.kr" + route),
      false,
    );
    assert.deepEqual(publicPageMetadata(route, false, env).robots, { index: false, follow: false });
  }
  assert.deepEqual(publicPageMetadata("/archive", true, env).robots, {
    index: false,
    follow: false,
  });
  assert.deepEqual(publicPageMetadata("/archive", false, env).alternates, {
    canonical: "https://sliper.kr/archive",
  });
  for (const override of [
    { NODE_ENV: "development" },
    { LOCAL_DATABASE: "1" },
    { SLIPER_SEARCH_INDEXING_ENABLED: "false" },
    { APP_ORIGIN: "http://127.0.0.1:3000" },
    { APP_ORIGIN: "https://secret:pass@sliper.kr" },
    { APP_ORIGIN: "https://sliper.kr/private" },
    { APP_ORIGIN: "https://192.168.0.2" },
  ])
    assert.equal(searchOrigin({ ...env, ...override }), null);
});
test("cookie refresh bypass is exact, read-only and keeps mutations and protected API paths on the normal path", () => {
  const id = "01234567-89ab-4def-a123-0123456789ab";
  for (const method of ["GET", "HEAD"])
    for (const path of [
      "/robots.txt",
      "/sitemap.xml",
      "/ads.txt",
      "/support",
      "/api/media/" + id,
      "/api/profile-photos/" + id,
    ])
      assert.equal(skipSessionRefresh(path, method), true);
  for (const path of [
    "/api/media",
    "/api/media/" + id + "/extra",
    "/api/auth/session",
    "/api/safety/admin/readiness",
    "/auth/callback",
    "/api/profile-photos",
  ])
    assert.equal(skipSessionRefresh(path, "GET"), false);
  assert.equal(skipSessionRefresh("/api/media/" + id, "POST"), false);
});
