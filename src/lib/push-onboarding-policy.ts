export const PUSH_ONBOARDING_SNOOZE_MS = 7 * 24 * 60 * 60 * 1_000;
export const PUSH_ONBOARDING_SNOOZE_KEY = "sliper:push-onboarding:dismissed-at:v1";

export type PushPlatform = "ios" | "android" | "desktop";
export type PushBrowser = "safari" | "chrome" | "edge" | "firefox" | "samsung" | "in-app" | "other";
export type PushInAppBrowser = "kakao" | "instagram" | "facebook" | "line" | "other";
export type PushPermission = "default" | "denied" | "granted" | "unavailable";
export type PushOnboardingPhase =
  "hidden" | "install-ios" | "install-android" | "permission" | "recovery" | "unsupported";

export interface PushEnvironmentSnapshot {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  navigatorStandalone: boolean;
  displayModeStandalone: boolean;
  displayModeFullscreen?: boolean;
  isSecureContext: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
}

export interface PushEnvironment {
  platform: PushPlatform;
  browser: PushBrowser;
  inAppName: PushInAppBrowser | null;
  standalone: boolean;
  secure: boolean;
  iosVersion: { major: number; minor: number } | null;
  iosVersionSupported: boolean | null;
  pushApiSupported: boolean;
  canRequestPush: boolean;
}

function inAppBrowser(userAgent: string): PushInAppBrowser | null {
  if (/KAKAOTALK/i.test(userAgent)) return "kakao";
  if (/Instagram/i.test(userAgent)) return "instagram";
  if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(userAgent)) return "facebook";
  if (/\bLine\//i.test(userAgent)) return "line";
  if (/; wv\)|\bwv\b|WebView/i.test(userAgent)) return "other";
  return null;
}

function browser(userAgent: string, inAppName: PushInAppBrowser | null): PushBrowser {
  if (inAppName) return "in-app";
  if (/Edg(?:e|A|iOS)?\//i.test(userAgent)) return "edge";
  if (/FxiOS|Firefox\//i.test(userAgent)) return "firefox";
  if (/SamsungBrowser\//i.test(userAgent)) return "samsung";
  if (/CriOS|Chrome\//i.test(userAgent)) return "chrome";
  if (/Safari\//i.test(userAgent)) return "safari";
  return "other";
}

export function detectPushEnvironment(snapshot: PushEnvironmentSnapshot): PushEnvironment {
  const ios =
    /iPad|iPhone|iPod/i.test(snapshot.userAgent) ||
    (snapshot.platform === "MacIntel" && snapshot.maxTouchPoints > 1);
  const platform: PushPlatform = ios
    ? "ios"
    : /Android/i.test(snapshot.userAgent)
      ? "android"
      : "desktop";
  const standalone =
    snapshot.navigatorStandalone ||
    snapshot.displayModeStandalone ||
    snapshot.displayModeFullscreen === true;
  const version = ios ? /(?:CPU(?: iPhone)? )?OS (\d+)[_.](\d+)/i.exec(snapshot.userAgent) : null;
  const iosVersion = version ? { major: Number(version[1]), minor: Number(version[2]) } : null;
  const iosVersionSupported = iosVersion
    ? iosVersion.major > 16 || (iosVersion.major === 16 && iosVersion.minor >= 4)
    : null;
  const inAppName = inAppBrowser(snapshot.userAgent);
  const pushApiSupported =
    snapshot.hasServiceWorker && snapshot.hasPushManager && snapshot.hasNotification;
  const canRequestPush =
    snapshot.isSecureContext &&
    pushApiSupported &&
    (platform !== "ios" || (standalone && iosVersionSupported !== false)) &&
    (!inAppName || standalone);
  return {
    platform,
    browser: browser(snapshot.userAgent, inAppName),
    inAppName,
    standalone,
    secure: snapshot.isSecureContext,
    iosVersion,
    iosVersionSupported,
    pushApiSupported,
    canRequestPush,
  };
}

export interface PushOnboardingState {
  environment: PushEnvironment;
  authenticated: boolean;
  permission: PushPermission;
  configured: boolean;
  snoozed: boolean;
  androidInstallAvailable: boolean;
  allowGuestInstall?: boolean;
}

export function pushOnboardingPhase(state: PushOnboardingState): PushOnboardingPhase {
  if (state.permission === "granted" || state.snoozed) return "hidden";
  const environment = state.environment;
  if (!state.authenticated) {
    if (!state.allowGuestInstall) return "hidden";
    if (!environment.secure || environment.iosVersionSupported === false) return "unsupported";
    if (environment.platform === "ios" && !environment.standalone) return "install-ios";
    if (
      environment.platform === "android" &&
      !environment.standalone &&
      state.androidInstallAvailable &&
      environment.canRequestPush
    ) {
      return "install-android";
    }
    return "hidden";
  }
  if (!state.configured) return "hidden";
  if (!environment.secure || environment.iosVersionSupported === false) return "unsupported";
  if (state.permission === "denied") return "recovery";
  if (environment.platform === "ios" && !environment.standalone) return "install-ios";
  if (!environment.canRequestPush || state.permission === "unavailable") return "unsupported";
  if (
    environment.platform === "android" &&
    !environment.standalone &&
    state.androidInstallAvailable
  ) {
    return "install-android";
  }
  return "permission";
}

export interface PushOnboardingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readPushOnboardingSnooze(
  storage: PushOnboardingStorage | null | undefined,
  now = Date.now(),
): boolean {
  if (!storage || !Number.isSafeInteger(now) || now < 0) return false;
  try {
    const value = storage.getItem(PUSH_ONBOARDING_SNOOZE_KEY);
    if (value === null || !/^\d+$/.test(value)) return false;
    const dismissedAt = Number(value);
    if (!Number.isSafeInteger(dismissedAt) || dismissedAt > now) return false;
    return now - dismissedAt < PUSH_ONBOARDING_SNOOZE_MS;
  } catch {
    return false;
  }
}

export function snoozePushOnboarding(
  storage: PushOnboardingStorage | null | undefined,
  now = Date.now(),
): boolean {
  if (!storage || !Number.isSafeInteger(now) || now < 0) return false;
  try {
    storage.setItem(PUSH_ONBOARDING_SNOOZE_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

export function clearPushOnboardingSnooze(
  storage: PushOnboardingStorage | null | undefined,
): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(PUSH_ONBOARDING_SNOOZE_KEY);
    return true;
  } catch {
    return false;
  }
}
