import { z } from "zod";
import { CATEGORY_SLUGS } from "./categories";
export const savedSearchSchema = z.strictObject({
  name: z.string().trim().min(1).max(50),
  category: z.enum(CATEGORY_SLUGS).nullable().default(null),
  region: z.string().trim().max(60).default(""),
  keyword: z.string().trim().max(60).default(""),
  meetupType: z.enum(["all", "event", "lightning"]).default("all"),
  maxPrice: z.number().int().min(0).max(10000000).nullable().default(null),
  beginnerOnly: z.boolean().default(false),
  soloOnly: z.boolean().default(false),
  frequency: z.enum(["instant", "daily", "off"]).default("daily"),
});
export type SavedSearchInput = z.infer<typeof savedSearchSchema>;
export interface SavedSearchView extends SavedSearchInput {
  id: string;
  createdAt: string;
}
export interface WaitlistView {
  full: boolean;
  state: "waiting" | "offered" | "submitted" | "expired" | "cancelled" | null;
  position: number | null;
  offerUntil: string | null;
  available: boolean;
}
export const ideaSchema = z
  .strictObject({
    title: z.string().trim().min(4).max(120),
    body: z.string().trim().min(10).max(5000),
    category: z.enum(CATEGORY_SLUGS),
    region: z.string().trim().min(1).max(60),
    dateFrom: z.iso.date(),
    dateTo: z.iso.date(),
    sourceEventId: z.uuid().nullable().default(null),
  })
  .refine((v) => v.dateTo >= v.dateFrom, "가능 날짜 범위를 확인해주세요.");
export interface IdeaView {
  id: string;
  title: string;
  region: string;
  category: string;
  dateFrom: string;
  dateTo: string;
  body: string;
  interested: boolean;
  count: number;
  mine: boolean;
  closed: boolean;
  events: { id: string; title: string }[];
}
export const reflectionSchema = z.strictObject({
  photos: z
    .array(z.uuid())
    .max(6)
    .refine((v) => new Set(v).size === v.length)
    .default([]),
  body: z.string().trim().min(1).max(2000),
  nextWish: z.string().trim().max(500).default(""),
  visibility: z.enum(["participants", "members"]),
  version: z.number().int().min(0),
});
export interface ReunionView {
  postId: string;
  title: string;
  canWrite: boolean;
  canReadPrivate: boolean;
  own: {
    body: string;
    nextWish: string;
    visibility: "participants" | "members";
    version: number;
    photos: string[];
  } | null;
  hasMore: boolean;
  recordUrl: string | null;
  notes: {
    id: string;
    body: string;
    nextWish: string;
    visibility: "participants" | "members";
    mine: boolean;
    nickname: string;
    photos: string[];
    version: number;
  }[];
  relatedIdeas: { id: string; title: string }[];
}
