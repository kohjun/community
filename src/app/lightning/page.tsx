import { LightningCommunity } from "@/components/lightning-community";
import { getDatabase } from "@/db/client";
import { communityService } from "@/server/community-service";
import { eventMapService } from "@/server/event-map-service";
import { AppError } from "@/server/errors";
import { currentActor } from "@/server/identity";
import { meetupVenuePreset, type MeetupVenuePreset } from "@/domain/venue-meetup";
import { uuidSchema } from "@/domain/validation";
import { lightningCategorySchema } from "@/domain/lightning-categories";
import "../lightning.css";
import "../lightning-categories.css";

export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor();
  const query = await searchParams;
  const parsedCategory = lightningCategorySchema.safeParse(query.activityCategory);
  const initialCategory = parsedCategory.success ? parsedCategory.data : "";
  const initialTag =
    typeof query.tag === "string" && query.tag.trim().length <= 24 ? query.tag.trim() : "";
  const initialSearch =
    typeof query.search === "string" && query.search.trim().length <= 100
      ? query.search.trim()
      : "";
  const initial = await communityService(getDatabase()).feed(actor, {
    eventOnly: true,
    meetupType: "lightning",
    ...(initialCategory ? { activityCategory: initialCategory } : {}),
    ...(initialTag ? { tag: initialTag } : {}),
    ...(initialSearch ? { search: initialSearch } : {}),
  });
  let initialVenue: MeetupVenuePreset | null = null;
  let venueUnavailable = false;
  if (query.venue !== undefined) {
    const parsedId = uuidSchema.safeParse(query.venue);
    const id = parsedId.success ? parsedId.data : null;
    if (!id) venueUnavailable = true;
    else {
      try {
        initialVenue = meetupVenuePreset(await eventMapService(getDatabase()).detail(actor, id));
        venueUnavailable = initialVenue === null;
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== "NOT_FOUND") throw error;
        venueUnavailable = true;
      }
    }
  }
  return (
    <LightningCommunity
      key={`${initialVenue?.id ?? (venueUnavailable ? "unavailable-venue" : "no-venue")}:${initialCategory}:${initialTag}:${initialSearch}`}
      initial={initial}
      canWrite={!!actor}
      initialVenue={initialVenue}
      initialOpen={!!actor && !!initialVenue && query.open === "1"}
      venueUnavailable={venueUnavailable}
      initialCategory={initialCategory}
      initialTag={initialTag}
      initialSearch={initialSearch}
    />
  );
}
