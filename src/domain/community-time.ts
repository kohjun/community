export const DAY_MS = 86_400_000;
export function koreanDay(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}
export function koreanDayStart(now: Date): Date {
  return new Date(koreanDay(now) + "T00:00:00+09:00");
}
export type PopularPeriod = "today" | "week" | "all";
export function popularityWindow(period: PopularPeriod, now: Date) {
  if (period === "all") return null;
  const day = koreanDayStart(now);
  const weekday = new Date(day.getTime() + 9 * 3_600_000).getUTCDay();
  return {
    start: new Date(day.getTime() - (period === "week" ? (weekday + 6) % 7 : 0) * DAY_MS),
    end: now,
  };
}
