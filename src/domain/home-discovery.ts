import type { CommunityPost } from "./community";
import type { MeetupType } from "./meetup-types";
/** Keep the homepage recruitment feed limited to real, open meetups. */
export function homeRecruitments(
  upcoming: CommunityPost[],
  featured: CommunityPost[],
  feed: CommunityPost[] = [],
): Record<MeetupType, CommunityPost[]> {
  const ordered = [
    ...new Map(
      [...feed, ...upcoming, ...featured]
        .filter((p) => p.kind === "모집" && p.category !== "crew")
        .map((p) => [p.id, p]),
    ).values(),
  ]
    .filter((post) => !post.sample && post.eventAvailable && !post.eventCancelledAt)
    .sort((a, b) => b.likes - a.likes || b.createdAt.localeCompare(a.createdAt));
  return {
    event: ordered.filter((post) => post.meetupType !== "lightning").slice(0, 12),
    lightning: ordered.filter((post) => post.meetupType === "lightning").slice(0, 12),
  };
}
export const HOME_PERIODS = [
  { value: "today", label: "오늘" },
  { value: "week", label: "이번 주" },
  { value: "month", label: "이번 달" },
] as const;
export type HomePeriod = (typeof HOME_PERIODS)[number]["value"];
