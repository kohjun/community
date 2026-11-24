/** Date helpers for the 모집 forms. Everything is Korean time (UTC+9, no DST). */
const KST = 9 * 3600000;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** "YYYY-MM-DD" in Korean time. */
export function kstDate(ms: number) {
  return new Date(ms + KST).toISOString().slice(0, 10);
}

/** Weekday of a calendar date ("2026-11-24" → "화"); independent of the viewer's time zone. */
export function weekdayOf(date: string) {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
}

export type DayOption = { date: string; label: string; weekday: string; weekend: boolean };

/** Today and the following days, labelled the way people say them (오늘, 내일, 11.26). */
export function upcomingDays(now: number, count = 7): DayOption[] {
  return Array.from({ length: count }, (_, i) => {
    const date = kstDate(now + i * 86400000);
    const weekday = weekdayOf(date);
    const [, month, day] = date.split("-").map(Number);
    return {
      date,
      label: i === 0 ? "오늘" : i === 1 ? "내일" : `${month}.${day}`,
      weekday,
      weekend: weekday === "토" || weekday === "일",
    };
  });
}

/** "19:00" → "오후 7:00", "00:30" → "오전 12:30". */
export function koreanClock(time: string) {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const half = hours < 12 ? "오전" : "오후";
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return `${half} ${hour}:${String(minutes).padStart(2, "0")}`;
}

/** "22:30" + 120 → { time: "00:30", nextDay: true }. */
export function addMinutes(time: string, minutes: number) {
  const [hours = 0, mins = 0] = time.split(":").map(Number);
  const total = hours * 60 + mins + minutes;
  const wrapped = ((total % 1440) + 1440) % 1440;
  return {
    time: `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`,
    nextDay: total >= 1440,
  };
}

/** "2026-11-24", "19:00", "21:00" → "11월 24일 (화) 19:00~21:00". */
export function scheduleText(date: string, start: string, end = "") {
  const [, month, day] = date.split("-").map(Number);
  const base = `${month}월 ${day}일 (${weekdayOf(date)})`;
  if (!start) return base;
  return `${base} ${start}${end ? `~${end}` : ""}`;
}

/**
 * A sensible first start time: at least `leadMinutes` from now, rounded up to the next
 * `stepMinutes`, as the "YYYY-MM-DDTHH:mm" Korean-time value the forms submit.
 */
export function roundedStart(now: number, leadMinutes = 60, stepMinutes = 30) {
  const step = stepMinutes * 60000;
  const at = Math.ceil((now + leadMinutes * 60000) / step) * step;
  return new Date(at + KST).toISOString().slice(0, 16);
}
