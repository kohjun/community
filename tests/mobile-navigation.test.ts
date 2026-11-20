import { test } from "node:test";
import assert from "node:assert/strict";
import { mobileSection, mobileNavigationHidden } from "../src/domain/mobile-navigation";
test("mobile navigation follows real routes and home query state", () => {
  const q = (s = "") => new URLSearchParams(s);
  assert.equal(mobileSection("/", q()), "home");
  assert.equal(mobileSection("/", q("kind=모집")), null);
  assert.equal(mobileSection("/", q("kind=모집&meetupType=event")), null);
  assert.equal(mobileSection("/", q("kind=모집&meetupType=lightning")), null);
  assert.equal(mobileSection("/", q("view=bookmarks&kind=모집")), "my");
  assert.equal(mobileSection("/", q("category=party")), null);
  for (const path of ["/events/abc", "/events/abc/reunion", "/map", "/lightning", "/archive"])
    assert.equal(mobileSection(path, q()), null);
  for (const path of [
    "/management",
    "/participation",
    "/rooms/abc",
    "/discover/saved",
    "/settings/account",
  ])
    assert.equal(mobileSection(path, q()), "my");
  assert.equal(mobileSection("/notifications", q()), "notifications");
});
test("authentication, checkout and editing screens stay focused without the mobile navigation", () => {
  for (const path of [
    "/login",
    "/signup",
    "/auth/callback",
    "/checkout/abc",
    "/admin/reports",
    "/archive/new",
    "/records/abc/edit",
  ])
    assert.equal(mobileNavigationHidden(path), true);
  for (const path of ["/", "/stories", "/lightning", "/archive", "/mypage", "/settings/account"])
    assert.equal(mobileNavigationHidden(path), false);
});
