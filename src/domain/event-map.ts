import { z } from "zod";
import { applicationUrlSchema } from "./validation";

export const EVENT_MAP_CATEGORIES = [
  "travel",
  "dating",
  "race",
  "mind-games",
  "survival",
  "music",
  "sports",
  "cooking",
  "party",
] as const;
export type EventMapCategory = (typeof EVENT_MAP_CATEGORIES)[number];
export const EVENT_MAP_PIN_LIMIT = 200;
export const venueInputSchema = z.strictObject({
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().min(5).max(200),
  description: z.string().trim().min(10).max(2000),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  categorySlug: z.enum(EVENT_MAP_CATEGORIES),
  spaceType: z.enum(["indoor", "outdoor", "mixed"]),
  isFree: z.boolean(),
  feeNote: z.string().trim().max(160).default(""),
  capacity: z.number().int().min(1).max(5000).nullable().default(null),
  tags: z
    .array(z.string().trim().min(1).max(24))
    .max(5)
    .refine((values) => new Set(values).size === values.length, "중복 태그를 제거해주세요.")
    .default([]),
  websiteUrl: applicationUrlSchema.nullable().default(null),
});
export const venueUpdateSchema = venueInputSchema.extend({ version: z.number().int().positive() });
export const venueDeleteSchema = z.strictObject({ version: z.number().int().positive() });
export const venueRecommendationSchema = z.strictObject({ liked: z.boolean() });
export type VenueInput = z.infer<typeof venueInputSchema>;
export type CommunityVenue = VenueInput & {
  id: string;
  contributor: { nickname: string; publicId: string; avatar: string } | null;
  isOwner: boolean;
  recommendations: number;
  recommended: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type MapEvent = {
  id: string;
  title: string;
  location: string;
  latitude: number;
  longitude: number;
  categorySlug: EventMapCategory;
  meetupType: "event" | "lightning";
  startsAt: string | null;
  amountKRW: number;
  capacity: number;
  open: boolean;
};
export type EventMapSnapshot = {
  venues: CommunityVenue[];
  events: MapEvent[];
  totalVenues: number;
  totalEvents: number;
  truncated: boolean;
};
const bound = (min: number, max: number) =>
  z
    .preprocess(
      (value) =>
        typeof value === "number" || (typeof value === "string" && value.trim())
          ? value
          : Number.NaN,
      z.coerce.number().finite().min(min).max(max),
    )
    .optional();
export const eventMapQuerySchema = z
  .strictObject({
    south: bound(-90, 90),
    west: bound(-180, 180),
    north: bound(-90, 90),
    east: bound(-180, 180),
    q: z.string().trim().max(100).default(""),
    freeOnly: z.boolean().default(false),
    category: z.enum(["all", ...EVENT_MAP_CATEGORIES]).default("all"),
    mode: z.enum(["all", "place", "event"]).default("all"),
  })
  .superRefine((value, context) => {
    const given = [value.south, value.west, value.north, value.east].filter(
      (v) => v !== undefined,
    ).length;
    if (given !== 0 && given !== 4) {
      context.addIssue({ code: "custom", message: "지도의 범위를 함께 보내주세요." });
    } else if (given === 4 && (value.south! >= value.north! || value.west! >= value.east!)) {
      context.addIssue({ code: "custom", message: "올바른 지도 범위를 지정해주세요." });
    }
  });
export type EventMapQuery = z.infer<typeof eventMapQuerySchema>;
