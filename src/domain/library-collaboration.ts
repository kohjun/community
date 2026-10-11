import { z } from "zod";
export const SUGGESTION_FIELDS = ["title", "summary", "scenario", "rules", "hostGuide"] as const;
export type SuggestionField = (typeof SUGGESTION_FIELDS)[number];
export const suggestionInputSchema = z.strictObject({
  version: z.number().int().positive(),
  field: z.enum(SUGGESTION_FIELDS),
  replacement: z.string().trim().min(2).max(10000),
  reason: z.string().trim().min(10).max(1000),
  consent: z.literal(true),
});
export const suggestionDecisionSchema = z
  .strictObject({
    decision: z.enum(["approve", "reject", "withdraw"]),
    expectedUpdatedAt: z.iso.datetime(),
    expectedLibraryUpdatedAt: z.iso.datetime().optional(),
    note: z.string().trim().min(2).max(1000),
    publicContentConsent: z.literal(true).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision === "approve" && (!v.expectedLibraryUpdatedAt || !v.publicContentConsent))
      ctx.addIssue({ code: "custom", message: "최신 자료와 공개 동의를 확인해주세요." });
  });
export const collaborationQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export const discussionLinkSchema = z.strictObject({
  postId: z.uuid(),
  version: z.number().int().positive(),
});
export interface SuggestionSummary {
  id: string;
  field: SuggestionField;
  baseVersion: number;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  proposer: string;
  isMine: boolean;
  updatedAt: string;
  createdAt: string;
  publishedVersion: number | null;
}
export interface SuggestionDetail extends SuggestionSummary {
  before: string;
  replacement: string;
  reason: string;
  decisionNote: string;
  canApprove: boolean;
  canWithdraw: boolean;
  stale: boolean;
}
export interface DiscussionLink {
  postId: string;
  title: string;
  category: "knowledge" | "lab";
  author: string;
  version: number;
  canRemove: boolean;
}
export interface LibraryCollaborationPage {
  items: SuggestionSummary[];
  total: number;
  page: number;
  pageCount: number;
  discussions: DiscussionLink[];
  canPropose: boolean;
  isOwner: boolean;
}
