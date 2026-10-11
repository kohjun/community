import { z } from "zod";
import { CATEGORY_SLUGS } from "./categories";
import type { CommunityVenue } from "./event-map";
import type { RecordSummary } from "./records";
import type { RegisteredVenueSnapshot } from "./place-snapshot";
export const placeHistoryQuerySchema = z.strictObject({
  q: z.string().trim().max(100).default(""),
  category: z.enum(CATEGORY_SLUGS).optional(),
  tab: z.enum(["records", "tips"]).default("records"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type PlaceHistoryQuery = z.infer<typeof placeHistoryQuerySchema>;
export interface PlaceHistoryPage {
  venue: CommunityVenue;
  stats: {
    completedEvents: number;
    attended: number;
    qrAttended: number;
    managerAttended: number;
    tips: number;
  };
  items: Array<{ record: RecordSummary; venue: RegisteredVenueSnapshot; venueTips: string }>;
  total: number;
  page: number;
  pageCount: number;
  hasMore: boolean;
}
