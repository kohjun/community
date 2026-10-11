import assert from "node:assert/strict";
import test from "node:test";
import {
  AdDismissal,
  MOBILE_AD_DAY_KEY,
  MOBILE_AD_SESSION_KEY,
  nextKoreanMidnight,
  type AdStorage,
} from "../src/lib/ad-dismissal";

function storage(): AdStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
const now = Date.parse("2026-10-02T10:30:00Z");
const midnight = Date.parse("2026-10-02T15:00:00Z");

test("today's advertisement dismissal expires at Korean midnight rather than after 24 hours", () => {
  const session = storage(),
    local = storage();
  const policy = new AdDismissal(session, local);
  policy.dismissToday(now);
  assert.equal(nextKoreanMidnight(now), midnight);
  assert.equal(policy.hidden(midnight - 1), true);
  assert.equal(policy.hidden(midnight), false);
  assert.equal(session.getItem(MOBILE_AD_SESSION_KEY), null);
});

test("today's opt-out survives route changes and a new browser session through local storage", () => {
  const local = storage();
  new AdDismissal(storage(), local).dismissToday(now);
  assert.equal(new AdDismissal(storage(), local).hidden(now + 1_000), true);
  assert.equal(new AdDismissal(storage(), local).hidden(midnight), false);
});

test("close keeps advertisements hidden only within the browser session", () => {
  const session = storage(),
    local = storage();
  new AdDismissal(session, local).dismissSession();
  assert.equal(new AdDismissal(session, local).hidden(now), true);
  assert.equal(new AdDismissal(storage(), local).hidden(now), false);
  assert.equal(local.getItem(MOBILE_AD_DAY_KEY), null);
});

test("blocked storage preserves session and day choices in memory without throwing", () => {
  const blocked: AdStorage = {
    getItem() {
      throw new Error("Storage unavailable");
    },
    setItem() {
      throw new Error("Storage unavailable");
    },
  };
  const closed = new AdDismissal(blocked, blocked);
  closed.dismissSession();
  assert.equal(closed.hidden(now), true);
  const today = new AdDismissal(blocked, blocked);
  today.dismissToday(now);
  assert.equal(today.hidden(midnight - 1), true);
  assert.equal(today.hidden(midnight), false);
});

test("malformed or implausibly distant stored deadlines do not hide ads indefinitely", () => {
  for (const raw of ["garbage", "1e15", "-1", String(midnight + 86_400_000), "9007199254740992"]) {
    const local = storage();
    local.setItem(MOBILE_AD_DAY_KEY, raw);
    assert.equal(new AdDismissal(storage(), local).hidden(now), false);
  }
});

test("midnight itself starts a fresh Korean day", () => {
  assert.equal(nextKoreanMidnight(midnight - 1), midnight);
  assert.equal(nextKoreanMidnight(midnight), midnight + 86_400_000);
});
