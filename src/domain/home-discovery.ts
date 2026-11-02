import type { CommunityPost } from "./community";
/** Preserve editorial samples without presenting them as active recruitment. */
export function homeRecruitments(upcoming: CommunityPost[], featured: CommunityPost[]) {
  return [
    ...new Map(
      [...upcoming, ...featured].filter((p) => p.kind === "모집").map((p) => [p.id, p]),
    ).values(),
  ]
    .sort(
      (a, b) =>
        Number(!!b.eventAvailable && !b.sample) - Number(!!a.eventAvailable && !a.sample) ||
        b.likes - a.likes ||
        b.createdAt.localeCompare(a.createdAt),
    )
    .slice(0, 12);
}
export const HOME_PERIODS = [
  { value: "today", label: "오늘" },
  { value: "week", label: "이번 주" },
  { value: "month", label: "이번 달" },
] as const;
export type HomePeriod = (typeof HOME_PERIODS)[number]["value"];
