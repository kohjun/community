import { z } from "zod";
export const EXPERIENCE_LABELS = {
  unspecified: "아직 안내되지 않았어요",
  beginner: "처음이어도 참여 가능",
  experienced: "경험이 있는 분께 추천",
} as const;
export const COMPANY_LABELS = {
  unspecified: "아직 안내되지 않았어요",
  solo: "혼자 참여 가능",
  both: "혼자 또는 지인과 함께",
  group: "지인과 함께 참여",
} as const;
export const ATMOSPHERE_LABELS = {
  unspecified: "아직 안내되지 않았어요",
  relaxed: "편안한 교류",
  immersive: "게임 몰입",
  competitive: "경쟁 중심",
} as const;
export const INTENSITY_LABELS = {
  unspecified: "아직 안내되지 않았어요",
  seated: "주로 앉아서",
  light: "가벼운 이동",
  active: "활동량 많음",
} as const;
export const participantGuideSchema = z
  .strictObject({
    version: z.literal(1),
    experience: z.enum(["unspecified", "beginner", "experienced"]),
    company: z.enum(["unspecified", "solo", "both", "group"]),
    atmosphere: z.enum(["unspecified", "relaxed", "immersive", "competitive"]),
    intensity: z.enum(["unspecified", "seated", "light", "active"]),
    onsiteMinKRW: z.number().int().min(0).max(10000000).nullable(),
    onsiteMaxKRW: z.number().int().min(0).max(10000000).nullable(),
    costNote: z.string().trim().max(300),
    arrival: z.string().trim().max(600),
    preparations: z.string().trim().max(600),
  })
  .superRefine((v, ctx) => {
    if ((v.onsiteMinKRW === null) !== (v.onsiteMaxKRW === null))
      ctx.addIssue({
        code: "custom",
        path: ["onsiteMaxKRW"],
        message: "예상 현장 비용의 최소·최대 금액을 함께 입력해주세요.",
      });
    if (v.onsiteMinKRW !== null && v.onsiteMaxKRW !== null && v.onsiteMinKRW > v.onsiteMaxKRW)
      ctx.addIssue({
        code: "custom",
        path: ["onsiteMaxKRW"],
        message: "최대 비용은 최소 비용 이상이어야 해요.",
      });
  });
export type ParticipantGuide = z.infer<typeof participantGuideSchema>;
export function emptyParticipantGuide(): ParticipantGuide {
  return {
    version: 1,
    experience: "unspecified",
    company: "unspecified",
    atmosphere: "unspecified",
    intensity: "unspecified",
    onsiteMinKRW: null,
    onsiteMaxKRW: null,
    costNote: "",
    arrival: "",
    preparations: "",
  };
}
export function onsiteCostLabel(guide: ParticipantGuide | null | undefined): string {
  if (!guide || guide.onsiteMinKRW === null || guide.onsiteMaxKRW === null)
    return "예상 금액 미안내";
  if (guide.onsiteMaxKRW === 0) return "예상 현장 비용 없음";
  const money = (v: number) => v.toLocaleString("ko-KR") + "원";
  return guide.onsiteMinKRW === guide.onsiteMaxKRW
    ? "예상 1인 " + money(guide.onsiteMinKRW)
    : "예상 1인 " + money(guide.onsiteMinKRW) + " ~ " + money(guide.onsiteMaxKRW);
}
