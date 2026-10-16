import { z } from "zod";
import type { CategorySlug } from "./categories";

export const AFTERCARE_PAGE_SIZE = 20;
export const AFTERCARE_MAX_PAGE = 1000;
export const AFTERCARE_SCOPES = ["all", "hosting", "participation", "credits"] as const;
export const AFTERCARE_VIEWS = ["pending", "all"] as const;
export type AftercareScope = (typeof AFTERCARE_SCOPES)[number];
export type AftercareView = (typeof AFTERCARE_VIEWS)[number];
export const aftercareQuerySchema = z.strictObject({
  scope: z.enum(AFTERCARE_SCOPES).default("all"),
  view: z.enum(AFTERCARE_VIEWS).default("pending"),
  page: z.coerce.number().int().min(1).max(AFTERCARE_MAX_PAGE).default(1),
});
export interface AftercareItem {
  id: string;
  postId: string;
  title: string;
  category: CategorySlug;
  endsAt: string | null;
  role: "host" | "manager" | "participant" | "contributor";
  stage: "completion" | "reflection" | "credits" | "review" | "ready";
  label: string;
  description: string;
  actions: { label: string; href: string }[];
  pending: boolean;
}
export interface AftercarePage {
  items: AftercareItem[];
  page: number;
  hasMore: boolean;
  total: number;
  pendingTotal: number;
}
