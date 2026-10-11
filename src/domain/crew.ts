import { z } from "zod";
import { categorySlugSchema, uuidSchema } from "./validation";
import { CREW_TOPICS } from "./boards";
import type { CategorySlug } from "./categories";
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (value) => !/[\u0000\uD800-\uDFFF]/u.test(value),
      "사용할 수 없는 문자가 포함되어 있어요.",
    );
export const crewInputSchema = z.strictObject({
  name: text(40).min(2, "크루 이름은 2자 이상 입력해주세요."),
  description: text(2000).min(10, "크루 소개를 10자 이상 적어주세요."),
  category: categorySlugSchema,
  region: text(80).default(""),
  capacity: z.number().int().min(2).max(100).default(20),
  recruiting: z.boolean().default(true),
});
export const crewUpdateSchema = crewInputSchema.extend({
  expectedUpdatedAt: z.iso.datetime({ precision: 6 }),
});
export const crewJoinSchema = z.strictObject({
  message: text(500).min(2),
  publicNameConsent: z.literal(true),
});
export const crewDecisionSchema = z.strictObject({ requestId: uuidSchema, approve: z.boolean() });
export const crewRoleSchema = z.strictObject({
  memberPublicId: uuidSchema,
  role: z.enum(["manager", "member"]),
});
export const crewTargetSchema = z.strictObject({ memberPublicId: uuidSchema });
export const crewAnnouncementSchema = z.strictObject({ body: text(2000).min(1) });
export const crewEventSchema = z.strictObject({ postId: uuidSchema });
export const crewContributionSchema = z.strictObject({
  postId: uuidSchema,
  memberPublicId: uuidSchema,
  role: z.enum(CREW_TOPICS),
  note: text(500).default(""),
});
export const crewListSchema = z.strictObject({
  q: text(100).default(""),
  category: categorySlugSchema.optional(),
  mine: z.enum(["0", "1"]).default("0"),
  page: z.coerce.number().int().min(1).max(50).default(1),
});
export const crewPageSchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(50).default(1),
});
export type CrewInput = z.infer<typeof crewInputSchema>;
export type CrewRole = "owner" | "manager" | "member";
export interface CrewSummary {
  id: string;
  name: string;
  description: string;
  category: CategorySlug;
  region: string;
  capacity: number;
  recruiting: boolean;
  archived: boolean;
  memberCount: number;
  eventCount: number;
  contributionCount: number;
  myRole: CrewRole | null;
  createdAt: string;
  updatedAt: string;
}
export interface CrewMember {
  publicId: string;
  nickname: string;
  avatar: string;
  role: CrewRole;
  joinedAt: string;
}
export interface CrewJoinRequest {
  id: string;
  publicId: string;
  nickname: string;
  avatar: string;
  message: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  createdAt: string;
}
export interface CrewActivity {
  id: string;
  kind: string;
  message: string;
  nickname: string;
  createdAt: string;
}
export interface CrewEvent {
  postId: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  href: string;
  canVerify: boolean;
}
export interface CrewContribution {
  id: string;
  postId: string;
  eventTitle: string;
  nickname: string;
  role: string;
  note: string;
  createdAt: string;
}
export interface CrewPage<T> {
  items: T[];
  total: number;
  page: number;
  nextPage: number | null;
}
export interface CrewDetail extends CrewSummary {
  members: CrewMember[];
  myRequest: CrewJoinRequest | null;
  requests: CrewPage<CrewJoinRequest> | null;
  activity: CrewPage<CrewActivity>;
  events: CrewEvent[];
  contributions: CrewPage<CrewContribution>;
}
