import { detectPushEnvironment } from "@/lib/push-onboarding-policy";
import type { PushSettingsView } from "@/domain/push";
import { appRequest } from "@/lib/api-client";

export type { PushPreferences, PushSettingsView } from "@/domain/push";

export type PushBrowserSupport = "supported" | "insecure" | "ios-install" | "unsupported";

export function getPushEnvironment() {
  return detectPushEnvironment({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone === true,
    displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
    displayModeFullscreen: window.matchMedia("(display-mode: fullscreen)").matches,
    isSecureContext: window.isSecureContext,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
  });
}
export function pushBrowserSupport(): PushBrowserSupport {
  const env = getPushEnvironment();
  if (!env.secure) return "insecure";
  if (env.iosVersionSupported === false) return "unsupported";
  if (env.platform === "ios" && !env.standalone) return "ios-install";
  return env.canRequestPush ? "supported" : "unsupported";
}

export function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]{87}=?$/.test(value))
    throw new Error("알림 연결 정보를 확인하지 못했어요. 잠시 후 다시 시도해주세요.");
  const raw = window.atob(
    value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4),
  );
  if (raw.length !== 65 || raw.charCodeAt(0) !== 4)
    throw new Error("알림 연결 정보를 확인하지 못했어요. 잠시 후 다시 시도해주세요.");
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

export function serializePushSubscription(subscription: PushSubscription) {
  const value = subscription.toJSON();
  if (!value.endpoint || !value.keys?.p256dh || !value.keys.auth) {
    throw new Error("이 브라우저의 알림 구독 정보를 확인하지 못했어요.");
  }
  return {
    endpoint: value.endpoint,
    keys: { p256dh: value.keys.p256dh, auth: value.keys.auth },
    expirationTime: value.expirationTime ?? null,
  };
}

export async function registerPushWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  if (registration.active) return registration;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("알림 준비가 지연되고 있어요. 다시 시도해주세요.")),
          15_000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function pushDeviceHash(endpoint: string): Promise<string> {
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function getPushSettings(
  subscription: PushSubscription | null,
  signal?: AbortSignal,
): Promise<PushSettingsView> {
  const device = subscription ? await pushDeviceHash(subscription.endpoint) : null;
  return appRequest<PushSettingsView>(
    `/api/push/settings${device ? `?device=${device}` : ""}`,
    "GET",
    undefined,
    signal,
  );
}

export function pushPermissionRecoveryMessage(): string {
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios
    ? "iPhone·iPad 설정 → 알림 → Sliper에서 알림 허용을 켜주세요. 항목이 보이지 않으면 홈 화면의 Sliper를 열어주세요."
    : "브라우저의 사이트 설정 → Sliper → 알림에서 허용으로 바꿔주세요. 휴대폰 설정의 브라우저 알림도 확인해주세요.";
}

export interface PushEnrollmentResult {
  subscription: PushSubscription;
  settings: PushSettingsView;
}

/** Call directly from an explicit click: requesting permission must precede any await. */
export function startPushEnrollment(settings: PushSettingsView): Promise<PushEnrollmentResult> {
  if (!settings.enabled || !settings.publicKey)
    return Promise.reject(
      new Error("알림 발송 연결을 준비하고 있어요. 잠시 후 다시 시도해주세요."),
    );
  if (pushBrowserSupport() !== "supported")
    return Promise.reject(
      new Error("이 환경에서는 알림을 켤 수 없어요. 알림 안내를 확인해주세요."),
    );
  if (Notification.permission === "denied")
    return Promise.reject(new Error(pushPermissionRecoveryMessage()));

  let key: Uint8Array<ArrayBuffer>;
  let permission: Promise<NotificationPermission>;
  try {
    key = applicationServerKey(settings.publicKey);
    // Keep this in the synchronous click call stack, including on iOS home-screen apps.
    permission =
      Notification.permission === "granted"
        ? Promise.resolve("granted")
        : Notification.requestPermission();
  } catch (cause) {
    return Promise.reject(cause);
  }
  return completePushEnrollment(settings, key, permission);
}

async function completePushEnrollment(
  settings: PushSettingsView,
  key: Uint8Array<ArrayBuffer>,
  requested: Promise<NotificationPermission>,
): Promise<PushEnrollmentResult> {
  const permission = await requested;
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? pushPermissionRecoveryMessage()
        : "알림을 허용하면 이 기기로 새 소식을 받을 수 있어요.",
    );
  }
  const registration = await registerPushWorker();
  let current = await registration.pushManager.getSubscription();
  // Explicit opt-in on a shared device creates a fresh subscription for this account.
  if (current && !settings.currentDevice) {
    if (!(await current.unsubscribe()))
      throw new Error("이 기기의 기존 알림 연결을 해제하지 못했어요. 다시 시도해주세요.");
    current = null;
  }
  const created = current === null;
  const subscription =
    current ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    }));
  try {
    const confirmed = await appRequest<PushSettingsView>(
      "/api/push/subscriptions",
      "POST",
      serializePushSubscription(subscription),
    );
    return { subscription, settings: confirmed };
  } catch (cause) {
    if (created) await subscription.unsubscribe().catch(() => false);
    throw cause;
  }
}
