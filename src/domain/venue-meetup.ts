import { venueSchema } from "./discovery";
import type { CommunityVenue } from "./event-map";
import { CATEGORIES } from "./categories";

export type MeetupVenuePreset = Pick<
  CommunityVenue,
  "id" | "name" | "address" | "latitude" | "longitude" | "categorySlug" | "version"
>;

/** A published shared place becomes a draft snapshot; the host still chooses a schedule. */
export function meetupVenuePreset(venue: CommunityVenue): MeetupVenuePreset | null {
  if (
    !venueSchema.safeParse({ latitude: venue.latitude, longitude: venue.longitude }).success ||
    !CATEGORIES.some((category) => category.sortOrder < 9 && category.slug === venue.categorySlug)
  )
    return null;
  const { id, name, address, latitude, longitude, categorySlug, version } = venue;
  return { id, name, address, latitude, longitude, categorySlug, version };
}
export function meetupVenueLabel(venue: MeetupVenuePreset): string {
  return [venue.name.trim(), venue.address.trim()].filter(Boolean).join(" · ").slice(0, 120);
}
