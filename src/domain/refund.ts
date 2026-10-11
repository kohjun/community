import { z } from "zod";
export const REFUND_POLICY_VERSION = "sliper-v1" as const;
export const REFUND_STEPS = [
  { days: "5일 전까지", rate: 100 },
  { days: "4일 전", rate: 80 },
  { days: "3일 전", rate: 60 },
  { days: "2일 전", rate: 40 },
  { days: "1일 전", rate: 20 },
  { days: "당일·이후", rate: 0 },
] as const;
const DAY = 86400000;
function koreanDay(value: Date) {
  const time = value.getTime();
  if (!Number.isFinite(time)) throw new Error("Invalid date");
  return Math.floor((time + 9 * 3600000) / DAY);
}
export function refundQuote(amountKRW: number, startsAt: Date, requestedAt = new Date()) {
  if (!Number.isSafeInteger(amountKRW) || amountKRW < 0 || amountKRW > 10000000)
    throw new Error("Invalid amount");
  const daysBefore = koreanDay(startsAt) - koreanDay(requestedAt);
  const rate = Math.max(0, Math.min(5, daysBefore)) * 20;
  return {
    policyVersion: REFUND_POLICY_VERSION,
    daysBefore,
    rate,
    refundableKRW: Math.floor((amountKRW * rate) / 100),
    retainedKRW: amountKRW - Math.floor((amountKRW * rate) / 100),
  };
}
export function koreanDateTimeInput(value?: string | null) {
  if (!value) return "";
  return new Date(new Date(value).getTime() + 9 * 3600000).toISOString().slice(0, 16);
}
export function koreanDateTimeISO(value: string) {
  return value ? new Date(`${value}:00+09:00`).toISOString() : null;
}
export const refundRequestSchema = z
  .object({ applicationId: z.uuid(), reason: z.string().trim().min(2).max(500) })
  .strict();
export const refundResolutionSchema = z
  .object({
    decision: z.enum(["complete", "reject"]),
    externalRefundChecked: z.boolean(),
    actualRefundKRW: z.number().int().min(0).max(10000000).optional(),
    reason: z.string().trim().max(500).default(""),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.decision === "complete" && (!v.externalRefundChecked || v.actualRefundKRW === undefined))
      ctx.addIssue({ code: "custom", message: "외부 환불 금액과 실제 처리 확인이 필요해요." });
    if (v.decision === "reject" && !v.reason)
      ctx.addIssue({ code: "custom", message: "처리 사유를 적어주세요." });
  });
export interface RefundRequestView {
  id: string;
  applicationId: string;
  attendeeName: string;
  cause?: "participant" | "host_cancel" | "schedule_change";
  amountKRW: number;
  rate: number;
  refundableKRW: number;
  reason: string;
  state: "pending" | "completed" | "rejected";
  actualRefundKRW: number | null;
  decisionNote: string;
  requestedAt: string;
  processedAt: string | null;
}
export interface RefundView {
  cause?: "participant" | "host_cancel" | "schedule_change";
  startsAt: string | null;
  policyVersion: string;
  quote: ReturnType<typeof refundQuote> | null;
  applicationId: string | null;
  canRequest: boolean;
  requests: RefundRequestView[];
  nextCursor: string | null;
}
