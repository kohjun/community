import { z } from "zod";
export const OPERATIONS_KINDS = ["report", "support", "dispute"] as const;
export const OPERATIONS_STAGES = ["pending", "reviewing", "completed"] as const;
export const OPERATIONS_ACTIONS = ["claim", "start_review", "release", "set_due"] as const;
export type OperationsKind = (typeof OPERATIONS_KINDS)[number];
export type OperationsStage = (typeof OPERATIONS_STAGES)[number];
export type OperationsAssignment = "all" | "unassigned" | "mine";
export type OperationsAction = (typeof OPERATIONS_ACTIONS)[number];
export const operationsKindSchema = z.enum(OPERATIONS_KINDS);
export const operationsQuerySchema = z.strictObject({
  kind: z.enum(["all", ...OPERATIONS_KINDS]).default("all"),
  stage: z.enum(["all", ...OPERATIONS_STAGES]).default("pending"),
  assignment: z.enum(["all", "unassigned", "mine"]).default("all"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export type OperationsQuery = z.infer<typeof operationsQuerySchema>;
export const operationsTriageSchema = z
  .strictObject({
    action: z.enum(OPERATIONS_ACTIONS),
    expectedRevision: z.number().int().min(1).max(2147483646),
    dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === "set_due" && v.dueAt === undefined)
      ctx.addIssue({
        code: "custom",
        path: ["dueAt"],
        message: "처리 목표 시각을 입력하거나 해제해주세요.",
      });
    if (v.action !== "set_due" && v.dueAt !== undefined)
      ctx.addIssue({
        code: "custom",
        path: ["dueAt"],
        message: "이 작업에서는 처리 목표 시각을 변경할 수 없어요.",
      });
  });
export interface OperationsItem {
  kind: OperationsKind;
  id: string;
  sourceStatus: string;
  stage: OperationsStage;
  title: string;
  summary: string;
  category: string;
  createdAt: string;
  revision: number;
  assignee: { publicId: string; nickname: string; isMine: boolean; active: boolean } | null;
  reviewStartedAt: string | null;
  dueAt: string | null;
  lastResponse: { body: string; at: string | null } | null;
  href: string;
  allowedActions: OperationsAction[];
  canTriage: boolean;
  reviewRestriction?: string | null;
}
export interface OperationsPage {
  items: OperationsItem[];
  total: number;
  page: number;
  pageCount: number;
  counts: Record<OperationsStage, number>;
  role: "admin" | "moderator";
}
export const OPERATION_KIND_LABELS: Record<OperationsKind, string> = {
  report: "신고",
  support: "문의",
  dispute: "자료 거래 분쟁",
};
export const OPERATION_STAGE_LABELS: Record<OperationsStage, string> = {
  pending: "미처리",
  reviewing: "검토 중",
  completed: "완료",
};
