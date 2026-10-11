import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PUSH_AUTH_ENTRY_KEY,
  PUSH_ONBOARDING_CHANGED_EVENT,
  PUSH_ONBOARDING_MOMENT_EVENT,
  consumePushAuthEntry,
  markPushAuthEntry,
  notifyPushOnboardingMoment,
  notifyPushSettingsChanged,
} from "../src/lib/push-onboarding-events";

const AUTH_ENTRY_TTL = 30 * 60 * 1_000;

function storage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(PUSH_AUTH_ENTRY_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

test("auth entry is consumed once after the server confirms a logged-in account", () => {
  const persisted = storage();
  const now = 1_800_000_000_000;
  markPushAuthEntry(persisted, now);
  assert.equal(persisted.getItem(PUSH_AUTH_ENTRY_KEY), String(now));
  assert.equal(consumePushAuthEntry(persisted, now + 1_000), true);
  assert.equal(persisted.getItem(PUSH_AUTH_ENTRY_KEY), null);
  assert.equal(consumePushAuthEntry(persisted, now + 2_000), false);
});

test("session auth entry expires at thirty minutes and expired entries are removed", () => {
  const now = 1_800_000_000_000;
  const eligible = storage(String(now));
  assert.equal(consumePushAuthEntry(eligible, now + AUTH_ENTRY_TTL - 1), true);
  const expired = storage(String(now));
  assert.equal(consumePushAuthEntry(expired, now + AUTH_ENTRY_TTL), false);
  assert.equal(expired.getItem(PUSH_AUTH_ENTRY_KEY), null);
  assert.equal(consumePushAuthEntry(storage(String(now)), now + AUTH_ENTRY_TTL + 1), false);
});

test("future, malformed, and unsafe auth timestamps never count as successful auth intent", () => {
  const now = 1_800_000_000_000;
  for (const value of [
    "null",
    "NaN",
    "Infinity",
    "-1",
    " 1",
    "1.2",
    "1e12",
    "{}",
    "9".repeat(40),
    String(now + 1),
  ]) {
    const persisted = storage(value);
    assert.equal(consumePushAuthEntry(persisted, now), false, value);
    assert.equal(persisted.getItem(PUSH_AUTH_ENTRY_KEY), null, value);
  }
  assert.equal(consumePushAuthEntry(storage(""), now), false);
  assert.equal(consumePushAuthEntry(storage(String(now)), Number.NaN), false);
  assert.equal(consumePushAuthEntry(storage(String(now)), Number.POSITIVE_INFINITY), false);
});

test("missing storage and blocked storage do not interrupt authentication", () => {
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  assert.doesNotThrow(() => markPushAuthEntry(null));
  assert.doesNotThrow(() => markPushAuthEntry(blocked));
  assert.equal(consumePushAuthEntry(null), false);
  assert.equal(consumePushAuthEntry(blocked), false);
  const removeBlocked = {
    ...storage(String(1_800_000_000_000)),
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(consumePushAuthEntry(removeBlocked, 1_800_000_000_001), false);
});

test("onboarding events are safe during server rendering without a window", () => {
  assert.equal(typeof window, "undefined");
  for (const moment of ["bookmark", "participation", "content", "auth"] as const) {
    assert.doesNotThrow(() => notifyPushOnboardingMoment(moment));
  }
  assert.doesNotThrow(() => notifyPushSettingsChanged());
});

test("browser events carry the value moment and settings change on separate channels", () => {
  const dispatched: Event[] = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      dispatchEvent: (event: Event) => {
        dispatched.push(event);
        return true;
      },
    },
  });
  try {
    notifyPushOnboardingMoment("participation");
    notifyPushSettingsChanged();
    assert.equal(dispatched.length, 2);
    assert.equal(dispatched[0]?.type, PUSH_ONBOARDING_MOMENT_EVENT);
    assert.equal((dispatched[0] as CustomEvent<string>).detail, "participation");
    assert.equal(dispatched[1]?.type, PUSH_ONBOARDING_CHANGED_EVENT);
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
