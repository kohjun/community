import { z } from "zod";
import { EVENT_MAP_CATEGORIES } from "./event-map";

// Selection-time place facts only. Contributor and authentication identities are excluded.
export const registeredVenueSnapshotSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().min(5).max(200),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  spaceType: z.enum(["indoor", "outdoor", "mixed"]),
  isFree: z.boolean(),
  feeNote: z.string().trim().max(160),
  capacity: z.number().int().min(1).max(5000).nullable(),
  version: z.number().int().positive(),
  capturedAt: z.iso.datetime({ offset: true }),
  categorySlug: z.enum(EVENT_MAP_CATEGORIES).optional(),
});
export type RegisteredVenueSnapshot = z.infer<typeof registeredVenueSnapshotSchema>;
