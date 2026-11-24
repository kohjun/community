export const OPEN_EVENT_COMPOSE_EVENT = "sliper:open-event-compose";
export const OPEN_LIGHTNING_COMPOSE_EVENT = "sliper:open-lightning-compose";

/**
 * Dispatches a cancelable window event so the active community/lightning screen
 * can open its recruitment composer in place without losing scroll state.
 * Returns true if the current page handled it.
 */
export function requestInPlaceCompose(kind: "event" | "lightning"): boolean {
  if (typeof window === "undefined") return false;
  const event = new CustomEvent(
    kind === "event" ? OPEN_EVENT_COMPOSE_EVENT : OPEN_LIGHTNING_COMPOSE_EVENT,
    { cancelable: true },
  );
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
