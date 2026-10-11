import { z } from "zod";
import { venueSchema, type VenuePoint } from "./discovery";
import {
  applicationQuestionsSchema,
  submittedAnswersSchema,
  type ApplicationQuestion,
  type ApplicationAnswerSnapshot,
} from "./application-questions";
export const eventConfigSchema = z
  .object({
    amountKRW: z.number().int().min(0).max(10000000),
    capacity: z.number().int().min(1).max(5000),
    open: z.boolean(),
    approvalMode: z.enum(["manual", "automatic"]).default("manual"),
    startsAt: z.iso.datetime({ offset: true }).nullable().optional(),
    endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
    venue: venueSchema.nullable().optional(),
    questions: applicationQuestionsSchema.optional(),
  })
  .strict();
export const applicationSchema = z
  .object({
    answers: submittedAnswersSchema.default([]),
    questionnaireVersion: z.string().min(1).max(80).optional(),
    note: z.string().trim().max(500).default(""),
    consent: z.literal(true),
    refundConsent: z.boolean().default(false),
  })
  .strict();
export const paymentEventSchema = z
  .object({
    eventId: z.string().min(1).max(160),
    orderId: z.uuid(),
    paymentId: z.string().min(1).max(160),
    amountKRW: z.number().int().positive().max(10000000),
    currency: z.literal("KRW"),
    status: z.enum(["paid", "refunded"]),
    refundAmountKRW: z.number().int().min(0).max(10000000).optional(),
  })
  .strict();
export type PaymentEvent = z.infer<typeof paymentEventSchema>;
export type ApplicationStatus =
  | "pending_payment"
  | "pending_approval"
  | "confirmed"
  | "cancelled"
  | "expired"
  | "refunded"
  | "review"
  | "rejected";
export interface ApplicationView {
  id: string;
  postId: string;
  title: string;
  status: ApplicationStatus;
  amountKRW: number;
  createdAt: string;
  expiresAt: string | null;
  source: "site" | "external";
  externalReference: string | null;
  decisionNote: string;
  externalPaymentVerified: boolean;
  eventStartsAt: string | null;
  refundPolicy: string;
  attendeeName: string;
  contact: string;
  note: string;
  answers: ApplicationAnswerSnapshot[];
  questionnaireCompleted: boolean;
  orderId: string | null;
}
export interface EventOverview {
  postId: string;
  title: string;
  location: string | null;
  eventDate: string | null;
  externalUrl: string | null;
  isOwner: boolean;
  canManage: boolean;
  publicProfileId: string | null;
  canApply: boolean;
  applicantProfile: { nickname: string; phoneNumber: string | null; ready: boolean } | null;
  config: {
    amountKRW: number;
    capacity: number;
    open: boolean;
    occupied: number;
    approvalMode: "manual" | "automatic";
    startsAt: string | null;
    endsAt: string | null;
    refundPolicy: string;
    completedAt?: string | null;
    cancelledAt?: string | null;
    lifecycleRevision?: number;
    questions: ApplicationQuestion[];
    questionnaireVersion: string;
    meetupType?: "event" | "lightning";
    venue?: VenuePoint | null;
  } | null;
  application: ApplicationView | null;
}
export interface RoomMember {
  publicId: string;
  nickname: string;
  avatar: string;
  photoSrc: string | null;
  role: "owner" | "manager" | "participant";
  isMe: boolean;
}
export interface RoomMemberPage {
  members: RoomMember[];
  nextCursor: string | null;
  memberCount: number;
  memberRevision: string;
}
export interface RoomView {
  memberCount: number;
  memberPreview: RoomMember[];
  memberRevision: string;
  postId: string;
  title: string;
  canWrite: boolean;
  isOwner: boolean;
  messages: { id: string; body: string; author: string; createdAt: string }[];
  nextCursor: string | null;
}
export interface ParticipationHome {
  applications: ApplicationView[];
  nextCursor: string | null;
  rooms: { postId: string; title: string; role: "manager" | "participant" }[];
}
export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  pending_payment: "결제 대기",
  pending_approval: "담당자 승인 대기",
  rejected: "확인 요청 반려",
  confirmed: "참가 확정",
  cancelled: "신청 취소",
  expired: "결제 기한 만료",
  refunded: "취소·환불 처리 완료",
  review: "결제 확인 · 담당자 확인 필요",
};

export const externalClaimSchema = applicationSchema
  .extend({ externalReference: z.string().trim().min(3).max(160) })
  .strict();
export const externalDecisionSchema = z
  .object({
    decision: z.enum(["approve", "reject", "refund"]),
    paymentChecked: z.boolean(),
    reason: z.string().trim().max(500).default(""),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.decision !== "reject" && !value.paymentChecked)
      ctx.addIssue({
        code: "custom",
        path: ["paymentChecked"],
        message: "외부 결제·환불 내역 확인이 필요해요.",
      });
    if (value.decision === "reject" && !value.reason)
      ctx.addIssue({ code: "custom", path: ["reason"], message: "반려 사유를 입력해주세요." });
  });
export const externalPaymentEventSchema = z
  .object({
    eventId: z.string().min(1).max(160),
    postId: z.uuid(),
    publicProfileId: z.uuid(),
    externalReference: z.string().trim().min(3).max(160),
    attendeeName: z.string().trim().min(1).max(60),
    contact: z.string().trim().min(3).max(100),
    amountKRW: z.number().int().min(0).max(10000000),
    currency: z.literal("KRW"),
    status: z.enum(["paid", "refunded"]),
    refundAmountKRW: z.number().int().min(0).max(10000000).optional(),
  })
  .strict();
export const managementQuerySchema = z.object({
  status: z
    .enum([
      "all",
      "pending_approval",
      "pending_payment",
      "confirmed",
      "review",
      "refunded",
      "cancelled",
      "expired",
      "rejected",
    ])
    .default("all"),
  search: z.string().trim().max(100).default(""),
  cursor: z.string().max(1024).optional(),
});
export interface ManagedEvent {
  postId: string;
  title: string;
  external: boolean;
  configured: boolean;
  completedAt?: string | null;
  endsAt?: string | null;
  recordStatus?: "draft" | "published" | "withdrawn" | null;
  capacity: number | null;
  open: boolean;
  confirmed: number;
  pendingApproval: number;
  pendingPayment: number;
  review: number;
  refunded: number;
}
export interface EventDashboard {
  event: EventOverview;
  stats: {
    total: number;
    confirmed: number;
    pendingApproval: number;
    pendingPayment: number;
    review: number;
    refunded: number;
    cancelled: number;
    rejected: number;
  };
  attendees: ApplicationView[];
  nextCursor: string | null;
}
