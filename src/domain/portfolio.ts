import { z } from "zod";
import { CATEGORY_SLUGS, type CategorySlug } from "./categories";
import { CREDIT_ROLES, type CreditRole } from "./records";
import type { PlayerRole } from "./player";
export const PORTFOLIO_TABS = ["participation", "creation", "library"] as const;
export type PortfolioTab = (typeof PORTFOLIO_TABS)[number];
export const portfolioQuerySchema = z.strictObject({
  tab: z.enum(PORTFOLIO_TABS).default("creation"),
  category: z.enum(CATEGORY_SLUGS).optional(),
  role: z.enum(["주최자", ...CREDIT_ROLES]).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export const portfolioPreferenceSchema = z.strictObject({
  visible: z.boolean(),
  featuredEventIds: z
    .array(z.uuid())
    .max(3)
    .refine((ids) => new Set(ids).size === ids.length, "대표 행사는 중복 선택할 수 없어요."),
});
export interface PortfolioEvent {
  kind: "event";
  postId: string;
  title: string;
  category: CategorySlug;
  location: string;
  endsAt: string;
  recordPublished: boolean;
  href: string;
  roles: Array<CreditRole | "주최자">;
  participation: {
    evidence: "qr" | "manager";
    outcome: "participated" | "won";
    observedRole: PlayerRole | null;
  } | null;
}
export interface PortfolioLibrary {
  kind: "rulebook" | "template";
  id: string;
  title: string;
  category: CategorySlug;
  summary: string;
  priceKRW: number;
  createdAt: string;
  href: string;
}
export interface PortfolioSummary {
  participated: number;
  qrAttended: number;
  managerAttended: number;
  wins: number;
  hosted: number;
  contributed: number;
  createdRulebooks: number;
  createdTemplates: number;
  hostAttendeeCount: number;
  hostQrAttendeeCount: number;
  hostManagerAttendeeCount: number;
  hostReviewCount: number;
  hostAverageRating: number | null;
}
export interface PortfolioView {
  publicId: string;
  nickname: string;
  bio: string;
  region: string;
  avatar: string;
  isMe: boolean;
  visible: boolean;
  historyVisible: boolean;
  featuredEventIds: string[];
  featured: PortfolioEvent[];
  summary: PortfolioSummary;
  query: z.infer<typeof portfolioQuerySchema>;
  items: Array<PortfolioEvent | PortfolioLibrary>;
  page: number;
  hasMore: boolean;
}
