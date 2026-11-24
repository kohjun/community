import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMinutes,
  kstDate,
  koreanClock,
  roundedStart,
  scheduleText,
  upcomingDays,
  weekdayOf,
} from "../src/domain/recruit-schedule";

// 2026-11-24 02:52 in Korea is 2026-11-23 17:52 UTC.
const now = Date.parse("2026-11-23T17:52:00Z");

test("dates and weekdays follow Korean time, not the viewer's time zone", () => {
  assert.equal(kstDate(now), "2026-11-24");
  assert.equal(weekdayOf("2026-11-24"), "화");
  const days = upcomingDays(now, 7);
  assert.deepEqual(
    days.map((d) => d.label),
    ["오늘", "내일", "11.26", "11.27", "11.28", "11.29", "11.30"],
  );
  assert.deepEqual(
    days.filter((d) => d.weekend).map((d) => d.weekday),
    ["토", "일"],
  );
});

test("times read naturally and wrap past midnight", () => {
  assert.equal(koreanClock("19:00"), "오후 7:00");
  assert.equal(koreanClock("00:30"), "오전 12:30");
  assert.equal(koreanClock("12:05"), "오후 12:05");
  assert.deepEqual(addMinutes("22:30", 120), { time: "00:30", nextDay: true });
  assert.deepEqual(addMinutes("14:00", 90), { time: "15:30", nextDay: false });
});

test("schedule text and default start time", () => {
  assert.equal(scheduleText("2026-10-10", "14:00", "17:00"), "10월 10일 (토) 14:00~17:00");
  assert.equal(scheduleText("2026-10-10", "14:00"), "10월 10일 (토) 14:00");
  assert.equal(scheduleText("2026-10-10", ""), "10월 10일 (토)");
  // 02:52 + 1 hour → rounded up to the next half hour.
  assert.equal(roundedStart(now), "2026-11-24T04:00");
});
