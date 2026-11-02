import { test } from "node:test";
import assert from "node:assert/strict";
import { loginReturnTo, loginHref } from "../src/domain/login-return";
import { applicationAccepting, currentWaitlist } from "../src/domain/participation-availability";
import { meetingIdeaState } from "../src/domain/meeting-idea-state";
import { mayCloseWriteDialog } from "../src/domain/write-close";
import type { EventOverview } from "../src/domain/participation";
import type { WaitlistView } from "../src/domain/community-growth";
test("canonical and legacy login links preserve safe destinations and reject redirects", () => {
  for (const path of ["/players?tab=crews", "/posts/abc#comments", "/discover/saved", "/ideas"]) {
    assert.equal(loginReturnTo({ returnTo: path }), path);
    assert.equal(loginReturnTo({ next: path }), path);
    assert.equal(new URL(loginHref(path), "https://local").searchParams.get("returnTo"), path);
  }
  assert.equal(loginReturnTo({ returnTo: "/archive", next: "/players" }), "/archive");
  for (const path of [
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example/",
    "/%2f%2fevil.example/",
    "/login",
  ]) {
    assert.equal(loginReturnTo({ returnTo: path }), "/mypage");
  }
  assert.equal(loginReturnTo({ returnTo: "/signup?returnTo=%2Fevents%2Fabc" }), "/events/abc");
});
test("own unexpired waitlist offer opens a stale full form while expired/other seats stay closed", () => {
  const now = Date.parse("2026-10-25T00:00:00Z"),
    config = {
      open: true,
      capacity: 1,
      occupied: 1,
      cancelledAt: null,
      completedAt: null,
    } as NonNullable<EventOverview["config"]>;
  const offer = {
    available: true,
    full: true,
    state: "offered",
    offerUntil: new Date(now + 1000).toISOString(),
  } as WaitlistView;
  assert.equal(applicationAccepting(config, null, now), false);
  assert.equal(applicationAccepting(config, offer, now), true);
  assert.equal(applicationAccepting(config, offer, now + 1000), false);
  assert.equal(currentWaitlist(offer, now + 1000).state, "expired");
  assert.equal(applicationAccepting({ ...config, open: false }, offer, now), false);
  assert.equal(
    applicationAccepting({ ...config, occupied: 0 }, { ...offer, state: "waiting" }, now),
    false,
  );
  assert.equal(
    applicationAccepting({ ...config, occupied: 0 }, { ...offer, full: false, state: null }, now),
    true,
  );
});
test("Korean calendar distinguishes manual closure from expired proposals", () => {
  const now = new Date("2026-10-25T15:01:00Z");
  assert.equal(meetingIdeaState({ closed: true, dateTo: "2026-10-25" }, now), "expired");
  assert.equal(meetingIdeaState({ closed: true, dateTo: "2026-10-26" }, now), "closed");
  assert.equal(meetingIdeaState({ closed: false, dateTo: "2026-10-26" }, now), "open");
});
test("dirty dismissals require explicit discard and never discard while a request is running", () => {
  let confirmations = 0;
  assert.equal(
    mayCloseWriteDialog(false, false, () => {
      confirmations++;
      return false;
    }),
    true,
  );
  assert.equal(confirmations, 0);
  assert.equal(
    mayCloseWriteDialog(true, false, () => false),
    false,
  );
  assert.equal(
    mayCloseWriteDialog(true, false, () => true),
    true,
  );
  assert.equal(
    mayCloseWriteDialog(true, true, () => {
      throw Error("must not prompt while busy");
    }),
    false,
  );
});
