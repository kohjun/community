export const MOBILE_AD_SESSION_KEY = "sliper:mobile-ad:closed:v1";
export const MOBILE_AD_DAY_KEY = "sliper:mobile-ad:hidden-until:v1";
const DAY_MS = 24 * 60 * 60 * 1_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;

export interface AdStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Today's opt-out ends at the next Korean calendar midnight, in every device time zone. */
export function nextKoreanMidnight(now: number): number {
  if (!Number.isSafeInteger(now) || now < 0) throw new RangeError("Invalid timestamp");
  return (Math.floor((now + KST_OFFSET_MS) / DAY_MS) + 1) * DAY_MS - KST_OFFSET_MS;
}

/** The in-memory values preserve a dismissal across route changes when storage is unavailable. */
export class AdDismissal {
  private sessionDismissed = false;
  private dayHiddenUntil = 0;
  constructor(
    private sessionStorage: AdStorage | null,
    private localStorage: AdStorage | null,
  ) {}

  hidden(now = Date.now()): boolean {
    if (!Number.isSafeInteger(now) || now < 0) return false;
    if (this.sessionDismissed || now < this.dayHiddenUntil) return true;
    try {
      if (this.sessionStorage?.getItem(MOBILE_AD_SESSION_KEY) === "1") return true;
    } catch {
      // Private browsing can disable browser storage.
    }
    try {
      const raw = this.localStorage?.getItem(MOBILE_AD_DAY_KEY);
      if (!raw || !/^\d+$/.test(raw)) return false;
      const until = Number(raw);
      return Number.isSafeInteger(until) && now < until && until <= nextKoreanMidnight(now);
    } catch {
      return false;
    }
  }

  dismissSession(): void {
    this.sessionDismissed = true;
    try {
      this.sessionStorage?.setItem(MOBILE_AD_SESSION_KEY, "1");
    } catch {
      // Retain the in-memory dismissal.
    }
  }

  dismissToday(now = Date.now()): void {
    this.dayHiddenUntil = nextKoreanMidnight(now);
    try {
      this.localStorage?.setItem(MOBILE_AD_DAY_KEY, String(this.dayHiddenUntil));
    } catch {
      // Retain the in-memory deadline.
    }
  }
}
