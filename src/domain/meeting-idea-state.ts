import type { IdeaView } from "./community-growth";

export function meetingIdeaState(
  idea: Pick<IdeaView, "closed" | "dateTo">,
  now = new Date(),
): "open" | "closed" | "expired" {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(now);
  return idea.dateTo < today ? "expired" : idea.closed ? "closed" : "open";
}
