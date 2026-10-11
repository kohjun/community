import { z } from "zod";
import { uuidSchema } from "./validation";
export const PURCHASE_STATUSES = ["pending", "paid", "rejected", "revoked", "refunded"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];
export const purchaseRequestSchema = z.strictObject({
  version: z.number().int().positive(),
  externalReference: z.string().trim().min(3).max(160),
  note: z.string().trim().max(500).default(""),
  consent: z.literal(true),
});
export const purchaseQuerySchema = z.strictObject({
  scope: z.enum(["buying", "selling", "disputes"]).default("buying"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export const purchaseDecisionSchema = z
  .strictObject({
    action: z.enum(["approve", "reject", "revoke", "refund"]),
    expectedUpdatedAt: z.iso.datetime(),
    note: z.string().trim().min(2).max(500),
    paymentChecked: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if ((v.action === "approve" || v.action === "refund") && !v.paymentChecked)
      ctx.addIssue({
        code: "custom",
        path: ["paymentChecked"],
        message: "외부 플랫폼의 결제 또는 전액 환불 완료를 확인해주세요.",
      });
  });
export const disputeInputSchema = z.strictObject({
  kind: z.enum(["delivery", "terms", "payment", "other"]),
  body: z.string().trim().min(10).max(3000),
});
export const disputeResponseSchema = z.strictObject({
  expectedUpdatedAt: z.iso.datetime(),
  body: z.string().trim().min(5).max(3000),
});
export const disputeResolutionSchema = z
  .strictObject({
    expectedUpdatedAt: z.iso.datetime(),
    outcome: z.enum(["no_action", "revoke", "refund_confirmed"]),
    note: z.string().trim().min(5).max(500),
    paymentChecked: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.outcome === "refund_confirmed" && !v.paymentChecked)
      ctx.addIssue({
        code: "custom",
        path: ["paymentChecked"],
        message: "외부 플랫폼의 전액 환불 완료를 확인해주세요.",
      });
  });
export const disputeWithdrawSchema = z.strictObject({ expectedUpdatedAt: z.iso.datetime() });
export const purchaseWebhookSchema = z.strictObject({
  eventId: z.string().trim().min(1).max(160),
  purchaseId: uuidSchema,
  paymentId: z.string().trim().min(1).max(160),
  type: z.enum(["paid", "refunded"]),
  amountKRW: z.number().int().min(1).max(1000000),
  currency: z.literal("KRW"),
});
export interface PurchaseSnapshot {
  title: string;
  versionNumber: number;
  priceKRW: number;
  usageTerms: string;
  allowDerivatives: boolean;
  allowCommercialUse: boolean;
  purchaseUrl: string;
}
export interface PurchaseSummary {
  id: string;
  entryId: string;
  snapshot: PurchaseSnapshot;
  externalReference: string;
  note: string;
  amountKRW: number;
  status: PurchaseStatus;
  buyer: string;
  seller: string;
  isBuyer: boolean;
  isSeller: boolean;
  createdAt: string;
  updatedAt: string;
  openDisputes: number;
}
export interface PurchaseAudit {
  id: string;
  action: string;
  note: string;
  actor: string;
  createdAt: string;
}
export interface PurchaseDispute {
  id: string;
  kind: "delivery" | "terms" | "payment" | "other";
  body: string;
  sellerResponse: string;
  status: "open" | "resolved" | "withdrawn";
  outcome: "no_action" | "revoke" | "refund_confirmed" | null;
  resolutionNote: string;
  createdAt: string;
  updatedAt: string;
  canRespond: boolean;
  canResolve: boolean;
  canWithdraw: boolean;
}
export interface PurchaseDetail extends PurchaseSummary {
  provider: string | null;
  paymentId: string | null;
  audit: PurchaseAudit[];
  disputes: PurchaseDispute[];
  canDecide: boolean;
  canOpenDispute: boolean;
  canReviewDisputes: boolean;
}
export interface PurchasePage {
  items: PurchaseSummary[];
  total: number;
  page: number;
  pageCount: number;
  canReviewDisputes: boolean;
}
