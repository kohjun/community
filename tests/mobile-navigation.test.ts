import { test } from "node:test";
import assert from "node:assert/strict";
import { mobileSection, mobileNavigationHidden } from "../src/domain/mobile-navigation";
import { EVENT_COMPOSE_HREF, LIGHTNING_COMPOSE_HREF } from "../src/domain/meetup-types";
test("mobile navigation follows real routes and home query state", () => {
  const q = (s = "") => new URLSearchParams(s);
  assert.equal(mobileSection("/", q()), "home");
  assert.equal(mobileSection("/", q("kind=모집")), "meetups");
  assert.equal(mobileSection("/", q("kind=모집&meetupType=event")), "meetups");
  assert.equal(mobileSection("/lightning", q()), "explore");
  assert.equal(mobileSection("/", q("view=bookmarks")), "my");
  assert.equal(mobileSection("/", q("category=party")), "explore");
  for (const path of ["/events/abc", "/events/abc/reunion", "/map"])
    assert.equal(mobileSection(path, q()), "meetups");
  for (const path of [
    "/management",
    "/participation",
    "/rooms/abc",
    "/discover/saved",
    "/settings/account",
  ])
    assert.equal(mobileSection(path, q()), "my");
  assert.equal(mobileSection("/notifications", q()), "notifications");
  assert.equal(mobileSection("/archive", q()), "explore");
});
test("mobile recruitment compose shortcuts point to event and lightning compose routes", () => {
  assert.equal(EVENT_COMPOSE_HREF, "/?compose=event");
  assert.equal(LIGHTNING_COMPOSE_HREF, "/lightning?open=1");
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
