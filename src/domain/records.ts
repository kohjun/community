import { z } from "zod";
import { CATEGORY_SLUGS, type CategorySlug } from "./categories";
import { postDocumentSchema, type PostDocument } from "./post-document";
import type { PublicImage, PublicVideo } from "./contracts";
import type { RegisteredVenueSnapshot } from "./place-snapshot";
export const CREDIT_ROLES = [
  "기획자",
  "MC",
  "진행 스태프",
  "촬영·편집",
  "디자인",
  "공간·장비",
] as const;
export type CreditRole = (typeof CREDIT_ROLES)[number];
export type CreditStatus =
  "pending" | "accepted" | "rejected" | "withdrawn" | "correction_requested";
export type RecordStatus = "draft" | "published" | "withdrawn";
export interface EventRecordSnapshot {
  title: string;
  category: CategorySlug;
  location: string;
  startsAt: string | null;
  endsAt: string | null;
  hostPublicId: string | null;
  hostNickname: string;
  venue?: RegisteredVenueSnapshot | null;
  template: {
    id: string | null;
    title: string;
    versionId?: string | null;
    versionNumber?: number | null;
  } | null;
}
export interface RecordSummary {
  postId: string;
  title: string;
  category: CategorySlug;
  location: string;
  startsAt: string | null;
  endsAt: string | null;
  completedAt: string;
  status: RecordStatus;
  hostPublicId: string | null;
  hostNickname: string;
  attended: number;
  qrAttended: number;
  managerAttended: number;
  reviewCount: number;
  averageRating: number | null;
  updatedAt: string;
  canEdit: boolean;
}
export interface RecordLink {
  id: string;
  title: string;
  href: string;
  kind: "post" | "rulebook" | "template" | "crew";
}
export interface CreditView {
  id: string;
  postId: string;
  eventTitle: string;
  publicId: string;
  nickname: string;
  role: CreditRole;
  note: string;
  status: CreditStatus;
  confirmedByName: string | null;
  acceptedAt: string | null;
  updatedAt: string;
  canDecide: boolean;
  canManage: boolean;
  correctionNote: string;
}
export interface RecordDetail extends RecordSummary {
  snapshot: EventRecordSnapshot;
  purpose: string;
  execution: string;
  highlights: string;
  improvements: string;
  venueTips: string;
  canEditVenueTips: boolean;
  bodyDocument: PostDocument | null;
  bodyMarkdown: string;
  images: PublicImage[];
  videos: PublicVideo[];
  links: RecordLink[];
  reviews: Array<{ postId: string; title: string; rating: number; author: string; href: string }>;
  credits: CreditView[];
  canManage: boolean;
  relatedPostIds: string[];
  libraryIds: string[];
}
export interface RecordPage {
  items: RecordSummary[];
  page: number;
  hasMore: boolean;
}
export const recordQuerySchema = z.strictObject({
  q: z.string().trim().max(100).default(""),
  libraryId: z.uuid().optional(),
  category: z.enum(CATEGORY_SLUGS).optional(),
  mine: z.enum(["0", "1"]).default("0"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export const recordSaveSchema = z.strictObject({
  expectedUpdatedAt: z.iso.datetime(),
  purpose: z.string().trim().max(2000),
  execution: z.string().trim().max(2000),
  highlights: z.string().trim().max(2000),
  improvements: z.string().trim().max(2000),
  venueTips: z.string().trim().max(2000).optional(),
  bodyDocument: postDocumentSchema.nullable(),
  relatedPostIds: z.array(z.uuid()).max(10),
  libraryIds: z.array(z.uuid()).max(10),
});
export const recordPublishSchema = z.strictObject({
  expectedUpdatedAt: z.iso.datetime(),
  published: z.boolean(),
});
export const recordTemplateDraftSchema = z.strictObject({
  expectedUpdatedAt: z.iso.datetime(),
});
export const creditCreateSchema = z.strictObject({
  memberPublicId: z.uuid(),
  role: z.enum(CREDIT_ROLES),
  note: z.string().trim().max(500).default(""),
});
export const creditDecisionSchema = z.strictObject({
  expectedUpdatedAt: z.iso.datetime(),
  decision: z.enum(["accept", "reject", "withdraw", "correction"]),
  note: z.string().trim().max(500).default(""),
});
export const creditUpdateSchema = z.strictObject({
  expectedUpdatedAt: z.iso.datetime(),
  role: z.enum(CREDIT_ROLES),
  note: z.string().trim().max(500),
  revoked: z.boolean().default(false),
});
export interface CreditPage {
  items: CreditView[];
}
