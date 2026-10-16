import { z } from "zod";
import { uuidSchema } from "./validation";
export const APPEAL_ACTION_TYPES = ["warn", "suspend", "hide"] as const;
export type AppealActionType = (typeof APPEAL_ACTION_TYPES)[number];
export const APPEAL_ACTION_LABELS: Record<AppealActionType, string> = {
  warn: "경고",
  suspend: "계정 이용 제한",
  hide: "콘텐츠 숨김",
};
export const APPEAL_SCOPE_LABELS: Record<string, string> = {
  post: "게시글",
  comment: "댓글",
  venue: "장소",
  player: "계정",
  crew: "크루",
  record: "행사 기록",
  library: "자료",
};
export const APPEAL_PUBLIC_REASONS: Record<AppealActionType, string> = {
  warn: "커뮤니티 이용 기준과 관련한 경고가 적용되었어요. 내용을 확인하거나 추가 설명을 요청할 수 있어요.",
  suspend:
    "커뮤니티 이용 기준과 관련해 계정 이용이 제한되었어요. 이 화면에서 재검토를 요청할 수 있어요.",
  hide: "커뮤니티 이용 기준과 관련해 본인이 소유한 콘텐츠의 공개가 제한되었어요. 재검토를 요청할 수 있어요.",
};
export const appealQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  actionId: uuidSchema.optional(),
});
export const appealSubmissionSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("open"),
    actionId: uuidSchema,
    body: z.string().trim().min(10).max(3000),
  }),
  z.strictObject({
    mode: z.literal("followup"),
    ticketId: uuidSchema,
    expectedRevision: z.number().int().min(1).max(2147483646),
    body: z.string().trim().min(10).max(3000),
  }),
]);
export interface AppealOriginalAction {
  id: string;
  type: AppealActionType;
  scope: string;
  reason: string;
  createdAt: string;
}
export interface AppealTicket {
  id: string;
  body: string;
  status: "open" | "answered" | "closed";
  revision: number;
  createdAt: string;
  updatedAt: string;
  replies: { id: string; body: string; createdAt: string; role: "member" | "staff" }[];
}
export interface AppealAction extends AppealOriginalAction {
  ticket: AppealTicket | null;
}
export interface AppealPage {
  items: AppealAction[];
  page: number;
  pageCount: number;
  total: number;
}
export interface AppealSubmission {
  action: AppealAction;
  reused: boolean;
}
