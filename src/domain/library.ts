import { z } from "zod";
import { eventPlanSchema, type EventPlan } from "./event-plan";
import { venueSchema } from "./discovery";
import { CATEGORY_SLUGS, type CategorySlug } from "./categories";
import { applicationUrlSchema, uuidSchema } from "./validation";
export const LIBRARY_KINDS = ["rulebook", "template"] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];
export const libraryRoundSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  seconds: z.number().int().min(10).max(86400),
});
export const libraryDiscoveryMetadataSchema = z.strictObject({
  preparationDifficulty: z.enum(["easy", "standard", "advanced"]).nullable(),
  environment: z.enum(["indoor", "outdoor", "mixed"]).nullable(),
  requiredStaff: z.number().int().min(0).max(100).nullable(),
});
export type LibraryDiscoveryMetadata = z.infer<typeof libraryDiscoveryMetadataSchema>;

export const libraryInputSchema = z
  .strictObject({
    eventPlan: eventPlanSchema.nullable().optional(),
    discoveryMetadata: libraryDiscoveryMetadataSchema.nullable().optional(),
    kind: z.enum(LIBRARY_KINDS),
    categorySlug: z.enum(CATEGORY_SLUGS),
    title: z.string().trim().min(2).max(120),
    summary: z.string().trim().min(10).max(600),
    scenario: z.string().trim().min(20).max(10000),
    rules: z.string().trim().min(10).max(8000),
    materials: z.array(z.string().trim().min(1).max(120)).max(40),
    hostGuide: z.string().trim().min(10).max(8000),
    minPlayers: z.number().int().min(1).max(5000),
    maxPlayers: z.number().int().min(1).max(5000),
    durationMinutes: z.number().int().min(5).max(1440),
    rounds: z.array(libraryRoundSchema).min(1).max(20),
    tags: z.array(z.string().trim().min(1).max(24)).max(5),
    priceKRW: z.number().int().min(0).max(1000000),
    purchaseUrl: applicationUrlSchema.nullable().default(null),
    usageTerms: z.string().trim().min(1).max(2000).default("작성자의 이용 조건을 확인해주세요."),
    allowDerivatives: z.boolean().default(false),
    allowCommercialUse: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(v)).byteLength > 140000)
      ctx.addIssue({
        code: "custom",
        path: ["eventPlan"],
        message: "자료가 너무 길어요. 본문과 운영 계획을 조금 줄여주세요.",
      });
    if (v.minPlayers > v.maxPlayers)
      ctx.addIssue({
        code: "custom",
        path: ["maxPlayers"],
        message: "최대 인원은 최소 인원 이상이어야 해요.",
      });
    if (v.priceKRW > 0 !== (v.purchaseUrl !== null))
      ctx.addIssue({
        code: "custom",
        path: ["purchaseUrl"],
        message: "유료 자료는 외부 구매 링크가 필요하고 무료 자료는 구매 링크를 사용하지 않아요.",
      });
    if (new Set(v.tags).size !== v.tags.length)
      ctx.addIssue({ code: "custom", path: ["tags"], message: "태그 중복을 제거해주세요." });
  });
export const libraryUpdateSchema = z.strictObject({
  content: libraryInputSchema,
  expectedUpdatedAt: z.iso.datetime(),
});
export type LibraryInput = z.infer<typeof libraryInputSchema>;
export const libraryPublishSchema = z.strictObject({
  expectedUpdatedAt: z.iso.datetime(),
  changeSummary: z.string().trim().min(2).max(1000),
  publicContentConsent: z.literal(true),
});
export const libraryVersionQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export const libraryDeriveSchema = z.strictObject({
  version: z.number().int().min(1).optional(),
});
const queryInteger = (min: number, max: number) =>
  z
    .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
    .pipe(z.number().int().min(min).max(max));
const queryBoolean = z.preprocess(
  (v) => (v === "true" ? true : v === "false" ? false : v),
  z.boolean(),
);
export const libraryListSchema = z.strictObject({
  kind: z.enum(LIBRARY_KINDS).optional(),
  category: z.enum(CATEGORY_SLUGS).optional(),
  search: z.string().trim().max(100).default(""),
  cursor: z.string().max(1024).optional(),
  mine: queryBoolean.default(false),
  players: queryInteger(1, 5000).optional(),
  maxDurationMinutes: queryInteger(5, 1440).optional(),
  price: z.enum(["free", "paid"]).optional(),
  used: queryBoolean.optional(),
  difficulty: z.enum(["easy", "standard", "advanced"]).optional(),
  environment: z.enum(["indoor", "outdoor", "mixed"]).optional(),
  maxStaff: queryInteger(0, 100).optional(),
});
export type LibraryListQuery = z.infer<typeof libraryListSchema>;
export function librarySearchParams(params: URLSearchParams): LibraryListQuery {
  const input: Record<string, string> = Object.create(null);
  for (const [key, value] of params) {
    if (!Object.hasOwn(libraryListSchema.shape, key)) {
      throw new z.ZodError([
        { code: "custom", path: [key], message: "허용되지 않는 검색 조건이에요." },
      ]);
    }
    if (Object.hasOwn(input, key)) {
      throw new z.ZodError([
        { code: "custom", path: [key], message: "중복 검색 조건을 제거해주세요." },
      ]);
    }
    input[key] = value;
  }
  return libraryListSchema.parse(input);
}
export const libraryAccessSchema = z.strictObject({
  externalReference: z.string().trim().min(3).max(160),
  note: z.string().trim().max(500).default(""),
  consent: z.literal(true),
});
export const libraryDecisionSchema = z
  .strictObject({
    userPublicId: uuidSchema,
    decision: z.enum(["approve", "reject", "revoke"]),
    paymentChecked: z.boolean(),
    note: z.string().trim().max(500).default(""),
  })
  .superRefine((v, ctx) => {
    if (v.decision === "approve" && !v.paymentChecked)
      ctx.addIssue({
        code: "custom",
        path: ["paymentChecked"],
        message: "외부 플랫폼에서 구매 내역을 확인해주세요.",
      });
    if (v.decision !== "approve" && !v.note)
      ctx.addIssue({ code: "custom", path: ["note"], message: "처리 사유를 입력해주세요." });
  });
export const templateHostSchema = z
  .strictObject({
    title: z.string().trim().min(2).max(120),
    location: z.string().trim().min(2).max(120),
    venue: venueSchema.nullable().default(null),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    amountKRW: z.number().int().min(0).max(10000000),
    capacity: z.number().int().min(1).max(5000),
    applicationUrl: applicationUrlSchema.nullable().default(null),
    description: z.string().trim().min(10).max(10000),
  })
  .superRefine((v, ctx) => {
    if (new Date(v.endsAt) <= new Date(v.startsAt))
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "종료는 시작보다 늦어야 해요." });
  });
export interface LibrarySummary {
  id: string;
  kind: LibraryKind;
  category: CategorySlug;
  title: string;
  summary: string;
  minPlayers: number;
  maxPlayers: number;
  durationMinutes: number;
  tags: string[];
  priceKRW: number;
  author: string;
  authorPublicId: string | null;
  createdAt: string;
  updatedAt: string;
  isMine: boolean;
  recordedEvents: number;
  recordedPlayers: number;
  /** Published operating cases visible to this member, separate from attendance totals. */
  visibleUseCases?: number;
  discoveryMetadata?: LibraryDiscoveryMetadata | null | undefined;
  status?: "draft" | "published";
  publishedVersion?: number;
}
export interface LibraryPayload {
  eventPlan?: EventPlan | null | undefined;
  scenario: string;
  rules: string;
  materials: string[];
  hostGuide: string;
  rounds: z.infer<typeof libraryRoundSchema>[];
}
export interface LibraryAccess {
  status: "pending" | "approved" | "rejected" | "revoked";
  externalReference: string;
  note: string;
  decisionNote: string;
  amountKRW: number;
}
export interface LibraryDetail extends LibrarySummary {
  purchaseUrl: string | null;
  payload: LibraryPayload | null;
  canHost: boolean;
  myAccess: LibraryAccess | null;
  status: "draft" | "published";
  publishedVersion: number;
  draftContent: LibraryInput | null;
  usageTerms: string;
  allowDerivatives: boolean;
  allowCommercialUse: boolean;
  sourceVersionId: string | null;
  sourceRecordPostId: string | null;
  sourceVersion: { entryId: string; number: number; title: string } | null;
  canDerive: boolean;
}
export interface LibraryPage {
  items: LibrarySummary[];
  nextCursor: string | null;
  canWrite: boolean;
}
export interface LibraryAccessRow extends LibraryAccess {
  userPublicId: string;
  nickname: string;
  createdAt: string;
}
export interface TemplateSnapshot extends LibraryPayload {
  discoveryMetadata?: LibraryDiscoveryMetadata | null | undefined;
  title: string;
  category: CategorySlug;
  summary: string;
  author: string;
  authorPublicId: string | null;
  minPlayers: number;
  maxPlayers: number;
  durationMinutes: number;
  sourceId: string;
  versionId?: string | null;
  versionNumber?: number | null;
  usageTerms?: string;
  allowDerivatives?: boolean;
  allowCommercialUse?: boolean;
}

export interface LibraryAccessPage {
  items: LibraryAccessRow[];
  nextCursor: string | null;
}

export interface LibraryVersionSummary {
  discoveryMetadata?: LibraryDiscoveryMetadata | null | undefined;
  id: string;
  entryId: string;
  number: number;
  title: string;
  summary: string;
  kind: LibraryKind;
  category: CategorySlug;
  priceKRW: number;
  publishedAt: string;
  changeSummary: string;
  legacy: boolean;
  usageTerms: string;
  allowDerivatives: boolean;
  allowCommercialUse: boolean;
  sourceVersionId: string | null;
  sourceRecordPostId: string | null;
  sourceVersion: { entryId: string; number: number; title: string } | null;
}
export interface LibraryVersionDetail extends LibraryVersionSummary {
  content: LibraryInput | null;
  payload: LibraryPayload | null;
  canDerive: boolean;
}
export interface LibraryVersionPage {
  items: LibraryVersionSummary[];
  total: number;
  page: number;
  pageCount: number;
}
