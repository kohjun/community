/** User-facing names for the two recruitment formats, kept identical everywhere they appear. */
export const MEETUP_TYPE_LABELS = {
  event: "이벤트·행사",
  lightning: "번개·모임",
} as const;
export type MeetupType = keyof typeof MEETUP_TYPE_LABELS;
export const meetupTypeLabel = (type: MeetupType | null | undefined) =>
  MEETUP_TYPE_LABELS[type === "lightning" ? "lightning" : "event"];

/** Recruitment list narrowed to planned events, so it never mixes in lightning meetups. */
export const EVENT_RECRUITMENTS_HREF = "/?kind=모집&meetupType=event";
/** Opens the lightning form directly on the lightning page. */
export const LIGHTNING_COMPOSE_HREF = "/lightning?open=1";
