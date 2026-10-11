import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PUSH_ONBOARDING_SNOOZE_KEY,
  PUSH_ONBOARDING_SNOOZE_MS,
  clearPushOnboardingSnooze,
  detectPushEnvironment,
  pushOnboardingPhase,
  readPushOnboardingSnooze,
  snoozePushOnboarding,
  type PushEnvironmentSnapshot,
  type PushOnboardingState,
  type PushOnboardingStorage,
} from "../src/lib/push-onboarding-policy";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

function snapshot(overrides: Partial<PushEnvironmentSnapshot> = {}): PushEnvironmentSnapshot {
  return {
    userAgent: IPHONE_SAFARI,
    platform: "iPhone",
    maxTouchPoints: 5,
    navigatorStandalone: false,
    displayModeStandalone: false,
    isSecureContext: true,
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
    ...overrides,
  };
}

function state(overrides: Partial<PushOnboardingState> = {}): PushOnboardingState {
  return {
    environment: detectPushEnvironment(snapshot()),
    authenticated: true,
    permission: "default",
    configured: true,
    snoozed: false,
    androidInstallAvailable: false,
    ...overrides,
  };
}

function storage(initial?: string): PushOnboardingStorage {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(PUSH_ONBOARDING_SNOOZE_KEY, initial);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

test("iOS Safari uses manual installation before requesting permission", () => {
  const environment = detectPushEnvironment(
    snapshot({ hasNotification: false, hasPushManager: false }),
  );
  assert.equal(environment.platform, "ios");
  assert.equal(environment.browser, "safari");
  assert.deepEqual(environment.iosVersion, { major: 16, minor: 4 });
  assert.equal(environment.iosVersionSupported, true);
  assert.equal(environment.canRequestPush, false);
  assert.equal(
    pushOnboardingPhase(state({ environment, permission: "unavailable" })),
    "install-ios",
  );
});

test("Chrome, Edge, and Firefox on iOS remain iOS browsers requiring installation", () => {
  const agents = [
    [IPHONE_SAFARI.replace("Version/16.4", "CriOS/140.0.0.0"), "chrome"],
    [IPHONE_SAFARI.replace("Version/16.4", "EdgiOS/140.0.0.0"), "edge"],
    [IPHONE_SAFARI.replace("Version/16.4", "FxiOS/140.0"), "firefox"],
  ] as const;
  for (const [userAgent, browser] of agents) {
    const environment = detectPushEnvironment(snapshot({ userAgent }));
    assert.equal(environment.platform, "ios");
    assert.equal(environment.browser, browser);
    assert.equal(pushOnboardingPhase(state({ environment })), "install-ios");
  }
});

test("iPad desktop mode is detected without mistaking desktop macOS for iOS", () => {
  const userAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  const ipad = detectPushEnvironment(
    snapshot({ userAgent, platform: "MacIntel", maxTouchPoints: 5 }),
  );
  assert.equal(ipad.platform, "ios");
  assert.equal(ipad.iosVersion, null);
  assert.equal(ipad.iosVersionSupported, null);
  assert.equal(pushOnboardingPhase(state({ environment: ipad })), "install-ios");
  const mac = detectPushEnvironment(
    snapshot({ userAgent, platform: "MacIntel", maxTouchPoints: 0 }),
  );
  assert.equal(mac.platform, "desktop");
  assert.equal(pushOnboardingPhase(state({ environment: mac })), "permission");
});

test("all installed display modes suppress installation while retaining explicit permission UI", () => {
  for (const mode of [
    { navigatorStandalone: true },
    { displayModeStandalone: true },
    { displayModeFullscreen: true },
  ]) {
    const environment = detectPushEnvironment(snapshot(mode));
    assert.equal(environment.standalone, true);
    assert.equal(environment.canRequestPush, true);
    assert.equal(
      pushOnboardingPhase(state({ environment, androidInstallAvailable: true })),
      "permission",
    );
  }
});

test("older iOS is unsupported while future iOS versions remain eligible", () => {
  for (const version of ["15_7", "16_0", "16_3"]) {
    const environment = detectPushEnvironment(
      snapshot({ userAgent: IPHONE_SAFARI.replace("16_4", version), navigatorStandalone: true }),
    );
    assert.equal(environment.iosVersionSupported, false);
    assert.equal(environment.canRequestPush, false);
    assert.equal(pushOnboardingPhase(state({ environment })), "unsupported");
  }
  const latest = detectPushEnvironment(
    snapshot({ userAgent: IPHONE_SAFARI.replace("16_4", "26_0"), navigatorStandalone: true }),
  );
  assert.equal(latest.iosVersionSupported, true);
  assert.equal(pushOnboardingPhase(state({ environment: latest })), "permission");
});

test("Android can enable notifications directly and only offers installation with a real deferred event", () => {
  const environment = detectPushEnvironment(
    snapshot({ userAgent: ANDROID_CHROME, platform: "Linux armv8l" }),
  );
  assert.equal(environment.platform, "android");
  assert.equal(environment.browser, "chrome");
  assert.equal(environment.canRequestPush, true);
  assert.equal(pushOnboardingPhase(state({ environment })), "permission");
  assert.equal(
    pushOnboardingPhase(state({ environment, androidInstallAvailable: true })),
    "install-android",
  );
  const installed = detectPushEnvironment(
    snapshot({ userAgent: ANDROID_CHROME, displayModeStandalone: true }),
  );
  assert.equal(
    pushOnboardingPhase(state({ environment: installed, androidInstallAvailable: true })),
    "permission",
  );
});

test("Samsung browser is distinguished from its Chromium user agent", () => {
  const environment = detectPushEnvironment(
    snapshot({ userAgent: `${ANDROID_CHROME} SamsungBrowser/27.0` }),
  );
  assert.equal(environment.platform, "android");
  assert.equal(environment.browser, "samsung");
  assert.equal(environment.canRequestPush, true);
});

test("in-app browsers are identified for opening a normal browser first", () => {
  const suffixes = [
    ["KAKAOTALK 26.0", "kakao"],
    ["Instagram 400.0", "instagram"],
    ["[FBAN/FBIOS;FBAV/500.0]", "facebook"],
    ["Line/15.0", "line"],
  ] as const;
  for (const [suffix, inAppName] of suffixes) {
    const environment = detectPushEnvironment(
      snapshot({ userAgent: `${IPHONE_SAFARI} ${suffix}` }),
    );
    assert.equal(environment.browser, "in-app");
    assert.equal(environment.inAppName, inAppName);
    assert.equal(environment.canRequestPush, false);
    assert.equal(pushOnboardingPhase(state({ environment })), "install-ios");
  }
  const android = detectPushEnvironment(
    snapshot({ userAgent: `${ANDROID_CHROME} KAKAOTALK 26.0` }),
  );
  assert.equal(android.canRequestPush, false);
  assert.equal(pushOnboardingPhase(state({ environment: android })), "unsupported");
  const webView = detectPushEnvironment(
    snapshot({ userAgent: ANDROID_CHROME.replace("Pixel 8)", "Pixel 8; wv)") }),
  );
  assert.equal(webView.inAppName, "other");
});

test("granted permission hides every installation and notification guide", () => {
  const environments = [
    detectPushEnvironment(snapshot()),
    detectPushEnvironment(snapshot({ navigatorStandalone: true })),
    detectPushEnvironment(snapshot({ userAgent: ANDROID_CHROME })),
    detectPushEnvironment(snapshot({ userAgent: `${ANDROID_CHROME} KAKAOTALK` })),
    detectPushEnvironment(snapshot({ isSecureContext: false })),
    detectPushEnvironment(snapshot({ userAgent: IPHONE_SAFARI.replace("16_4", "15_0") })),
  ];
  for (const environment of environments) {
    for (const authenticated of [true, false]) {
      assert.equal(
        pushOnboardingPhase(
          state({
            environment,
            permission: "granted",
            authenticated,
            configured: false,
            androidInstallAvailable: true,
            allowGuestInstall: true,
          }),
        ),
        "hidden",
      );
    }
  }
});

test("denied permission leads to recovery and never to another permission request", () => {
  const environment = detectPushEnvironment(snapshot({ navigatorStandalone: true }));
  assert.equal(pushOnboardingPhase(state({ environment, permission: "denied" })), "recovery");
  assert.equal(
    pushOnboardingPhase(state({ environment, permission: "denied", snoozed: true })),
    "hidden",
  );
  assert.equal(
    pushOnboardingPhase(state({ environment, permission: "denied", authenticated: false })),
    "hidden",
  );
});

test("guests are not prompted automatically and manual installation needs no account or push key", () => {
  assert.equal(pushOnboardingPhase(state({ authenticated: false })), "hidden");
  assert.equal(
    pushOnboardingPhase(
      state({ authenticated: false, configured: false, allowGuestInstall: true }),
    ),
    "install-ios",
  );
  const android = detectPushEnvironment(snapshot({ userAgent: ANDROID_CHROME }));
  assert.equal(
    pushOnboardingPhase(
      state({
        environment: android,
        authenticated: false,
        configured: false,
        allowGuestInstall: true,
        androidInstallAvailable: true,
      }),
    ),
    "install-android",
  );
  assert.equal(
    pushOnboardingPhase(
      state({ environment: android, authenticated: false, allowGuestInstall: true }),
    ),
    "hidden",
  );
  const installed = detectPushEnvironment(snapshot({ navigatorStandalone: true }));
  for (const permission of ["default", "denied"] as const) {
    assert.equal(
      pushOnboardingPhase(
        state({
          environment: installed,
          authenticated: false,
          allowGuestInstall: true,
          permission,
        }),
      ),
      "hidden",
    );
  }
});

test("missing configuration and explicit cooldown suppress automatic onboarding", () => {
  assert.equal(pushOnboardingPhase(state({ configured: false })), "hidden");
  assert.equal(pushOnboardingPhase(state({ snoozed: true })), "hidden");
});

test("insecure connections and missing installed browser APIs cannot request permission", () => {
  const insecure = detectPushEnvironment(snapshot({ isSecureContext: false }));
  assert.equal(insecure.canRequestPush, false);
  assert.equal(pushOnboardingPhase(state({ environment: insecure })), "unsupported");
  for (const missing of [
    { hasServiceWorker: false },
    { hasPushManager: false },
    { hasNotification: false },
  ]) {
    const environment = detectPushEnvironment(snapshot({ ...missing, navigatorStandalone: true }));
    assert.equal(environment.canRequestPush, false);
    assert.equal(pushOnboardingPhase(state({ environment })), "unsupported");
  }
});

test("closing onboarding hides it for exactly seven days", () => {
  const now = 1_800_000_000_000;
  const persisted = storage();
  assert.equal(snoozePushOnboarding(persisted, now), true);
  assert.equal(readPushOnboardingSnooze(persisted, now), true);
  assert.equal(readPushOnboardingSnooze(persisted, now + PUSH_ONBOARDING_SNOOZE_MS - 1), true);
  assert.equal(readPushOnboardingSnooze(persisted, now + PUSH_ONBOARDING_SNOOZE_MS), false);
  assert.equal(readPushOnboardingSnooze(persisted, now + PUSH_ONBOARDING_SNOOZE_MS + 1), false);
  assert.equal(clearPushOnboardingSnooze(persisted), true);
  assert.equal(persisted.getItem(PUSH_ONBOARDING_SNOOZE_KEY), null);
});

test("malformed, future, and clock-adjusted snooze timestamps cannot suppress guidance indefinitely", () => {
  const now = 1_800_000_000_000;
  for (const value of [
    "",
    "null",
    "NaN",
    "Infinity",
    "-1",
    " 1",
    "1.2",
    "1e12",
    "{}",
    "9".repeat(40),
  ]) {
    assert.equal(readPushOnboardingSnooze(storage(value), now), false, value);
  }
  assert.equal(readPushOnboardingSnooze(storage(String(now + 1)), now), false);
  assert.equal(readPushOnboardingSnooze(storage(String(now)), now - 1), false);
  assert.equal(readPushOnboardingSnooze(storage(String(now)), Number.NaN), false);
  assert.equal(snoozePushOnboarding(storage(), Number.NaN), false);
  assert.equal(snoozePushOnboarding(storage(), -1), false);
});

test("privacy modes and blocked local storage fail gracefully without throwing", () => {
  const blocked: PushOnboardingStorage = {
    getItem: () => {
      throw new Error("storage blocked");
    },
    setItem: () => {
      throw new Error("storage blocked");
    },
    removeItem: () => {
      throw new Error("storage blocked");
    },
  };
  for (const candidate of [blocked, null, undefined]) {
    assert.equal(readPushOnboardingSnooze(candidate), false);
    assert.equal(snoozePushOnboarding(candidate), false);
    assert.equal(clearPushOnboardingSnooze(candidate), false);
  }
});
