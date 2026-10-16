import type { AppealOriginalAction } from "./appeals";
import { z } from "zod";
export const POLICY_VERSION = "2026-10-04";
export const REPORT_REASONS = {
  spam: "광고·도배",
  fraud: "사기성 모집",
  harassment: "욕설·괴롭힘",
  privacy: "개인정보 노출",
  unsafe: "위험하거나 부적절한 행사",
  other: "기타",
} as const;
export const SUPPORT_CATEGORIES = {
  account: "계정·이의신청",
  payment: "결제 확인",
  refund: "환불",
  event: "행사·일정",
  report: "신고 처리",
  other: "기타 문의",
} as const;
export const targetSchema = z.strictObject({
  targetType: z.enum(["post", "comment", "venue", "player", "crew", "record", "library"]),
  targetId: z.string().uuid(),
});
export const reportInputSchema = targetSchema.extend({
  reason: z.enum(["spam", "fraud", "harassment", "privacy", "unsafe", "other"]),
  detail: z.string().trim().max(2000).default(""),
});
export const moderationInputSchema = z.strictObject({
  action: z.enum(["hide", "restore", "warn", "suspend", "dismiss", "reinstate"]),
  reason: z.string().trim().min(5).max(1000),
  days: z.number().int().min(1).max(30).default(7),
});
export const supportInputSchema = z.strictObject({
  category: z.enum(["account", "payment", "refund", "event", "report", "other"]),
  subject: z.string().trim().min(3).max(100),
  body: z.string().trim().min(10).max(3000),
});
export function membershipActive(
  row: { status: string; suspendedUntil: Date | null } | undefined,
  now = new Date(),
) {
  return (
    !row ||
    row.status === "active" ||
    (row.status === "suspended" && !!row.suspendedUntil && row.suspendedUntil <= now)
  );
}
export interface ReportView {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  detail: string;
  status: string;
  resolution: string;
  createdAt: string;
  resolvedAt: string | null;
  snapshot?: string;
}
export interface BlockView {
  id: string;
  label: string;
  createdAt: string;
}
export interface SupportView {
  originalAction: AppealOriginalAction | null;
  canReply: boolean;
  revision: number;
  id: string;
  category: string;
  subject: string;
  body: string;
  status: string;
  createdAt: string;
  replies: { id: string; body: string; createdAt: string; role: "member" | "staff" }[];
}
