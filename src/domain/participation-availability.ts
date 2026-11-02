import type { WaitlistView } from "./community-growth";
import type { EventOverview } from "./participation";

export function currentWaitlist(value: WaitlistView, now = Date.now()): WaitlistView {
  if (
    value.state === "offered" &&
    (!value.offerUntil ||
      Date.parse(value.offerUntil) <= now ||
      !Number.isFinite(Date.parse(value.offerUntil)))
  )
    return { ...value, state: "expired" };
  return value;
}

/** A live offer reserves this member's seat even when the old overview was full. */
export function applicationAccepting(
  config: EventOverview["config"],
  waitlist: WaitlistView | null,
  now = Date.now(),
): boolean {
  if (!config?.open || config.cancelledAt || config.completedAt) return false;
  const offer = waitlist?.available && currentWaitlist(waitlist, now).state === "offered";
  return !!offer || (!waitlist?.full && config.occupied < config.capacity);
}
