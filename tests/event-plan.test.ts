import assert from "node:assert/strict";
import { test } from "node:test";
import {
  budgetShare,
  budgetTotal,
  emptyEventPlan,
  eventPlanMarkdown,
  eventPlanSchema,
} from "../src/domain/event-plan";
import { COEX_PLAYBOOK_EXAMPLE } from "../src/domain/event-plan-example";
import { libraryInputSchema } from "../src/domain/library";

test("COEX example separates reference attendance, admission fee, material price and operating budget", () => {
  const content = libraryInputSchema.parse(COEX_PLAYBOOK_EXAMPLE);
  const plan = content.eventPlan!;
  assert.equal(plan.reference.participants, 23);
  assert.equal(content.minPlayers, 20);
  assert.equal(content.maxPlayers, 20);
  assert.equal(plan.reference.participantFeeKRW, 3000);
  assert.equal(content.priceKRW, 0);
  assert.equal(plan.missions.length, 13);
  assert.equal(plan.timeline.length, 9);
  assert.equal(budgetTotal(plan.budget), 9000);
  assert.equal(budgetShare(4000, 9000), "44.44%");
  assert.equal(budgetShare(5000, 9000), "55.56%");
  assert.equal(budgetShare(0, 0), "—");
});

test("legacy materials remain valid without a structured event plan", () => {
  const { eventPlan: ignored, ...legacy } = COEX_PLAYBOOK_EXAMPLE;
  void ignored;
  assert.equal(libraryInputSchema.safeParse(legacy).success, true);
  assert.equal(libraryInputSchema.safeParse({ ...legacy, eventPlan: null }).success, true);
  assert.deepEqual(eventPlanSchema.parse(emptyEventPlan()), emptyEventPlan());
});

test("structured plans reject invalid dates, prices, unknown fields and excessive rows", () => {
  const plan = COEX_PLAYBOOK_EXAMPLE.eventPlan!;
  for (const reference of [
    { ...plan.reference, date: "2026-02-30" },
    { ...plan.reference, startTime: "25:00" },
    { ...plan.reference, participants: 0 },
    { ...plan.reference, participantFeeKRW: -1 },
  ])
    assert.equal(eventPlanSchema.safeParse({ ...plan, reference }).success, false);
  for (const amountKRW of [-1, 1.5, 100000001])
    assert.equal(
      eventPlanSchema.safeParse({ ...plan, budget: [{ category: "소품", amountKRW }] }).success,
      false,
    );
  assert.equal(eventPlanSchema.safeParse({ ...plan, verifiedAttendance: 23 }).success, false);
  assert.equal(
    eventPlanSchema.safeParse({ ...plan, missions: Array(41).fill(plan.missions[0]) }).success,
    false,
  );
  assert.equal(
    eventPlanSchema.safeParse({ ...plan, timeline: Array(61).fill(plan.timeline[0]) }).success,
    false,
  );
  assert.equal(
    eventPlanSchema.safeParse({ ...plan, missions: [{ ...plan.missions[0], rules: " " }] }).success,
    false,
  );
});

test("Korean multi-byte content has a combined size limit below the HTTP body limit", () => {
  const plan = COEX_PLAYBOOK_EXAMPLE.eventPlan!;
  const eventPlan = {
    ...plan,
    missions: Array.from({ length: 40 }, () => ({
      ...plan.missions[0]!,
      rules: "가".repeat(3000),
    })),
  };
  assert.equal(eventPlanSchema.safeParse(eventPlan).success, true);
  const parsed = libraryInputSchema.safeParse({ ...COEX_PLAYBOOK_EXAMPLE, eventPlan });
  assert.equal(parsed.success, false);
  if (!parsed.success)
    assert.ok(parsed.error.issues.some((issue) => issue.message.includes("자료가 너무 길어요")));
});

test("download preserves mission rules, simultaneous cues and budget shares", () => {
  const plan = COEX_PLAYBOOK_EXAMPLE.eventPlan!;
  const markdown = eventPlanMarkdown(plan);
  for (const mission of plan.missions) {
    assert.ok(markdown.includes(mission.name));
    assert.ok(markdown.includes(mission.rules));
    assert.ok(markdown.includes(mission.scoring));
  }
  for (const cue of plan.timeline) assert.ok(markdown.includes(cue.program));
  assert.equal(plan.timeline.filter((cue) => cue.time === "14:30").length, 2);
  assert.ok(markdown.includes("3,000원"));
  assert.ok(markdown.includes("9,000원"));
  assert.ok(markdown.includes("44.44%"));
  assert.doesNotMatch(eventPlanMarkdown(emptyEventPlan()), /NaN|Infinity/);
});
