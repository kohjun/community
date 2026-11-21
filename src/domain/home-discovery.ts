import type { CommunityPost } from "./community";
import type { MeetupType } from "./meetup-types";
import { isJanuaryRecruitmentSample } from "@/demo/january-recruitments";

const HOME_RECRUITMENT_LIMIT = 12;

/** Prefer real open meetups and fill an empty section with curated upcoming samples. */
export function homeRecruitments(
  upcoming: CommunityPost[],
  featured: CommunityPost[],
  feed: CommunityPost[] = [],
  now = Date.now(),
): Record<MeetupType, CommunityPost[]> {
  const candidates = [
    ...new Map(
      [...feed, ...upcoming, ...featured]
        .filter((p) => p.kind === "모집" && p.category !== "crew")
        .map((p) => [p.id, p]),
    ).values(),
  ].filter((post) => !post.eventCancelledAt);
  const select = (type: MeetupType) => {
    const typed = candidates.filter((post) => (post.meetupType ?? "event") === type);
    const open = typed
      .filter((post) => !post.sample && post.eventAvailable)
      .sort((a, b) => b.likes - a.likes || b.createdAt.localeCompare(a.createdAt));
    if (open.length) return open.slice(0, HOME_RECRUITMENT_LIMIT);
    return typed
      .filter(
        (post) => isJanuaryRecruitmentSample(post) && Date.parse(post.eventStartsAt ?? "") > now,
      )
      .sort((a, b) => a.eventStartsAt!.localeCompare(b.eventStartsAt!))
      .slice(0, HOME_RECRUITMENT_LIMIT);
  };
  return {
    event: select("event"),
    lightning: select("lightning"),
  };
}
export const HOME_PERIODS = [
  { value: "today", label: "오늘" },
  { value: "week", label: "이번 주" },
  { value: "month", label: "이번 달" },
] as const;
export type HomePeriod = (typeof HOME_PERIODS)[number]["value"];
