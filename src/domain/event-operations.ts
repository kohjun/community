import { z } from "zod";
export const ticketCodeSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "올바른 QR 입장권을 확인해주세요.");
export const ticketInputSchema = z.strictObject({ applicationId: z.uuid() });
export const scanInputSchema = z.strictObject({ code: ticketCodeSchema });
export const verifiedReviewInputSchema = z.strictObject({
  title: z.string().trim().min(3).max(120),
  bodyMarkdown: z.string().trim().min(20).max(6000),
  rating: z.number().int().min(1).max(5),
});
export function ticketCodeFromScan(value: string, postId: string, origin: string): string {
  const direct = ticketCodeSchema.safeParse(value.trim());
  if (direct.success) return direct.data;
  try {
    const url = new URL(value.trim());
    if (url.origin !== origin || url.pathname !== `/management/events/${postId}/check-in`)
      throw new Error();
    return ticketCodeSchema.parse(new URLSearchParams(url.hash.slice(1)).get("ticket"));
  } catch {
    throw new Error("이 행사에서 발급한 QR 입장권이나 입장 코드를 입력해주세요.");
  }
}
export type TicketView = {
  applicationId: string;
  code: string;
  expiresAt: string;
  attendeeName: string;
  title: string;
};
export type AdmissionCandidate = {
  applicationId: string;
  attendeeName: string;
  nickname: string;
  title: string;
  checkedAt: string | null;
  canAdmit: boolean;
  message: string;
};
export type AdmissionRoster = {
  title: string;
  postId: string;
  startsAt: string | null;
  endsAt: string | null;
  confirmed: number;
  checkedIn: number;
  items: Array<{
    applicationId: string;
    attendeeName: string;
    nickname: string;
    checkedAt: string | null;
  }>;
  page: number;
  hasMore: boolean;
};
export type EventReviewView = {
  postId: string;
  title: string;
  canReview: boolean;
  checkedAt: string | null;
  ownReviewPostId: string | null;
  reviews: Array<{
    reviewPostId: string;
    title: string;
    body: string;
    author: string;
    rating: number;
    createdAt: string;
  }>;
  page: number;
  hasMore: boolean;
};
export const PAYMENT_ISSUE_LABELS = {
  paid_unconfirmed: "결제 확인 · 참가 미확정",
  confirmed_unpaid: "참가 확정 · 결제 미확인",
  refunded_active: "환불 완료 · 참가 상태 확인",
  amount_mismatch: "신청·결제 금액 불일치",
  refund_pending: "환불 요청 처리 대기",
} as const;
export type PaymentIssue = {
  applicationId: string;
  attendeeName: string;
  applicationStatus: string;
  source: string;
  amountKRW: number;
  paymentState: string;
  provider: string | null;
  reference: string | null;
  issues: Array<keyof typeof PAYMENT_ISSUE_LABELS>;
  fingerprint: string;
  pendingRefundKRW: number | null;
  notes: Array<{ note: string; createdAt: string }>;
};
export type PaymentReconciliation = {
  postId: string;
  title: string;
  items: PaymentIssue[];
  page: number;
  hasMore: boolean;
};
