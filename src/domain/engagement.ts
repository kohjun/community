import { z } from "zod";
import { CATEGORY_SLUGS, type CategorySlug } from "./categories";
export const INBOX_KINDS = [
  "comments",
  "announcements",
  "participation",
  "subscriptions",
  "reminders",
  "credits",
  "records",
] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];
export const inboxQuerySchema = z.strictObject({
  kind: z.enum(["all", ...INBOX_KINDS]).default("all"),
  unreadOnly: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default(false),
  cursor: z.string().min(1).max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const inboxReadSchema = z.strictObject({ id: z.uuid().optional() });
export const categorySubscriptionsSchema = z.strictObject({
  categories: z
    .array(z.enum(CATEGORY_SLUGS))
    .max(12)
    .refine(
      (values) => new Set(values).size === values.length,
      "관심 카테고리는 중복 선택할 수 없어요.",
    ),
});
export const hostSubscriptionSchema = z.strictObject({ subscribed: z.boolean() });
export interface InboxItem {
  id: string;
  kind: InboxKind;
  title: string;
  body: string;
  url: string;
  createdAt: string;
  readAt: string | null;
}
export interface UnifiedInboxPage {
  items: InboxItem[];
  nextCursor: string | null;
  unreadCount: number;
}
export interface SubscriptionSettings {
  categories: CategorySlug[];
  hosts: { publicId: string; nickname: string }[];
}
export interface HostSubscriptionView {
  publicId: string;
  nickname: string;
  subscribed: boolean;
  isMe: boolean;
}
