import type { CrewPage } from "../domain/crew";
export function appendCrewPage<T extends { id: string }>(
  current: CrewPage<T>,
  next: CrewPage<T>,
): CrewPage<T> {
  if (next.page <= current.page) return current;
  return {
    ...next,
    items: [...new Map([...current.items, ...next.items].map((item) => [item.id, item])).values()],
  };
}
export function crewDate(value: string | null): string {
  if (!value) return "일정 미정";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "일정 미정"
    : new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
}
