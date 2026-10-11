export const PUSH_ONBOARDING_MOMENT_EVENT = "sliper:push-onboarding:moment";
export const PUSH_ONBOARDING_CHANGED_EVENT = "sliper:push-onboarding:changed";
export const PUSH_AUTH_ENTRY_KEY = "sliper:push-onboarding:auth-entry:v1";
const AUTH_ENTRY_TTL = 30 * 60 * 1_000;

export type PushOnboardingMoment = "bookmark" | "participation" | "content" | "auth";
interface SessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export function notifyPushOnboardingMoment(moment: PushOnboardingMoment) {
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent(PUSH_ONBOARDING_MOMENT_EVENT, { detail: moment }));
}
export function notifyPushSettingsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PUSH_ONBOARDING_CHANGED_EVENT));
}
export function markPushAuthEntry(storage: SessionStorage | null, now = Date.now()) {
  try {
    storage?.setItem(PUSH_AUTH_ENTRY_KEY, String(now));
  } catch {
    /* Private browsing may disable storage. */
  }
}
export function consumePushAuthEntry(storage: SessionStorage | null, now = Date.now()): boolean {
  try {
    const raw = storage?.getItem(PUSH_AUTH_ENTRY_KEY);
    if (!raw) return false;
    storage?.removeItem(PUSH_AUTH_ENTRY_KEY);
    const entered = Number(raw);
    return (
      /^\d+$/.test(raw) &&
      Number.isSafeInteger(entered) &&
      entered <= now &&
      now - entered < AUTH_ENTRY_TTL
    );
  } catch {
    return false;
  }
}
