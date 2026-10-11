import { z } from "zod";

const note = (max: number) => z.string().trim().max(max).default("");
const optionalTime = z
  .union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)])
  .default("");
export const MISSION_KINDS = {
  mission: "일반 미션",
  duel: "팀 대결",
  special: "특별 미션",
} as const;
export const CUE_PHASES = { preparation: "준비", main: "본행사", wrapup: "마무리" } as const;
export const eventMissionSchema = z.strictObject({
  name: z.string().trim().min(1, "미션 이름을 입력해주세요.").max(80),
  zone: note(60),
  kind: z.enum(["mission", "duel", "special"]).default("mission"),
  summary: note(400),
  rules: z.string().trim().min(1, "미션 규칙을 입력해주세요.").max(3000),
  facilitatorNotes: note(1500),
  scoring: note(600),
  durationMinutes: z.number().int().min(1).max(1440).nullable().default(null),
});
export const eventCueSchema = z.strictObject({
  time: z.string().trim().min(1, "진행 시점을 입력해주세요.").max(40),
  phase: z.enum(["preparation", "main", "wrapup"]).default("main"),
  program: z.string().trim().min(1, "프로그램 이름을 입력해주세요.").max(100),
  details: note(1200),
  notes: note(600),
});
export const eventBudgetSchema = z.strictObject({
  category: z.string().trim().min(1, "예산 항목을 입력해주세요.").max(60),
  description: note(200),
  amountKRW: z.number().int().min(0).max(100000000),
});
export const eventPlanSchema = z.strictObject({
  reference: z.strictObject({
    organizer: note(80),
    date: z.union([z.literal(""), z.iso.date()]).default(""),
    startTime: optionalTime,
    endTime: optionalTime,
    location: note(160),
    participants: z.number().int().min(1).max(5000).nullable().default(null),
    participantFeeKRW: z.number().int().min(0).max(10000000).nullable().default(null),
  }),
  planningIntent: note(4000),
  concept: note(200),
  worldbuilding: note(3000),
  format: note(500),
  teamSize: z.number().int().min(1).max(5000).nullable().default(null),
  victoryCondition: note(1200),
  movementRules: note(2000),
  missions: z.array(eventMissionSchema).max(40),
  timeline: z.array(eventCueSchema).max(60),
  budget: z.array(eventBudgetSchema).max(60),
  budgetNotes: note(1200),
});
export type EventPlan = z.infer<typeof eventPlanSchema>;
export type EventMission = z.infer<typeof eventMissionSchema>;
export function emptyEventPlan(): EventPlan {
  return eventPlanSchema.parse({ reference: {}, missions: [], timeline: [], budget: [] });
}
export function budgetTotal(rows: EventPlan["budget"]): number {
  return rows.reduce((total, row) => total + row.amountKRW, 0);
}
export function budgetShare(amount: number, total: number): string {
  return total > 0 ? `${((amount / total) * 100).toFixed(2)}%` : "—";
}
export function eventPlanMarkdown(plan: EventPlan): string {
  const r = plan.reference;
  const ref = [
    r.organizer && `기획/진행: ${r.organizer}`,
    r.date && `기준 날짜: ${r.date}`,
    (r.startTime || r.endTime) &&
      `진행 시간: ${r.startTime || "미입력"} ~ ${r.endTime || "미입력"}`,
    r.location && `장소: ${r.location}`,
    r.participants !== null && `작성자 입력 참가 인원: ${r.participants}명`,
    r.participantFeeKRW !== null && `행사 참가비: ${r.participantFeeKRW.toLocaleString("ko-KR")}원`,
  ].filter(Boolean);
  return [
    "## 이벤트 개요",
    "작성자가 입력한 운영 예시이며 Sliper 출석 확인 기록과 별도입니다.",
    ...ref.map((v) => `- ${v}`),
    "## 기획 의도와 배경",
    plan.planningIntent || "미입력",
    "## 컨셉과 세계관",
    plan.concept,
    plan.worldbuilding,
    "## 콘텐츠 구조",
    plan.format,
    plan.teamSize ? `팀당 ${plan.teamSize}명` : "",
    plan.victoryCondition,
    plan.movementRules,
    "## 게임 상세 설명",
    ...plan.missions.map((m, i) =>
      [
        `### ${i + 1}. ${m.name}${m.zone ? ` (${m.zone})` : ""}`,
        MISSION_KINDS[m.kind],
        m.summary,
        m.durationMinutes ? `제한 시간: ${m.durationMinutes}분` : "",
        `규칙\n${m.rules}`,
        `진행 포인트\n${m.facilitatorNotes}`,
        `점수·성공 조건\n${m.scoring}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    ),
    "## 타임라인과 큐시트",
    ...plan.timeline.map(
      (c) => `### ${c.time} · ${c.program}\n${CUE_PHASES[c.phase]}\n\n${c.details}\n\n${c.notes}`,
    ),
    "## 운영 예산",
    ...plan.budget.map(
      (b) =>
        `- ${b.category} · ${b.description}: ${b.amountKRW.toLocaleString("ko-KR")}원 (${budgetShare(b.amountKRW, budgetTotal(plan.budget))})`,
    ),
    `총 예산: ${budgetTotal(plan.budget).toLocaleString("ko-KR")}원`,
    plan.budgetNotes,
  ]
    .filter(Boolean)
    .join("\n\n");
}
