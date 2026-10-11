import type { Metadata } from "next";
import { EventMapCommunity } from "@/components/event-map-community";
import { getDatabase } from "@/db/client";
import { eventMapService } from "@/server/event-map-service";
import { currentActor } from "@/server/identity";
import { venueSchema } from "@/domain/discovery";
import { uuidSchema } from "@/domain/validation";
import "../event-map.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "함께 만드는 이벤트 맵 | Sliper",
  description: "유저가 추천하는 모임 장소와 모집 중인 이벤트를 지도에서 만나보세요.",
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor();
  const query = await searchParams;
  const point =
    typeof query.lat === "string" &&
    query.lat.trim() &&
    typeof query.lng === "string" &&
    query.lng.trim()
      ? venueSchema.safeParse({ latitude: Number(query.lat), longitude: Number(query.lng) })
      : null;
  const selectedEvent = uuidSchema.safeParse(query.event);
  const selectedPlace = uuidSchema.safeParse(query.place);
  const initial = await eventMapService(getDatabase()).list(actor, {});
  return (
    <EventMapCommunity
      initial={initial}
      initialFocus={point?.success ? point.data : null}
      initialSelection={
        selectedEvent.success
          ? `event:${selectedEvent.data}`
          : selectedPlace.success
            ? `place:${selectedPlace.data}`
            : null
      }
      canWrite={!!actor}
      clientId={process.env.NEXT_PUBLIC_NAVER_MAP_KEY_ID?.trim() || null}
    />
  );
}
