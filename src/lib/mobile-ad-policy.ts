export const MOBILE_AD_VISIBLE_DELAY_MS = 30_000;
export function mobileAdAllowedPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    !/^\/(?:login|signup|auth|admin|account|settings|mypage|management|participation|rooms|events|checkout|payment)(?:\/|$)/.test(
      pathname,
    ) && !/(?:^|\/)(?:new|write|edit|apply|check-in)(?:\/|$)/.test(pathname)
  );
}
/** Only uninterrupted eligible foreground intervals contribute to the delay. */
export class VisibleAdClock {
  private elapsed = 0;
  private last = 0;
  private eligible = false;
  tick(at: number, eligible: boolean): boolean {
    if (this.eligible) this.elapsed += Math.max(0, Math.min(at - this.last, 1500));
    this.last = at;
    this.eligible = eligible;
    return eligible && this.elapsed >= MOBILE_AD_VISIBLE_DELAY_MS;
  }
}
