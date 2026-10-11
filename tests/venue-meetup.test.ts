import assert from "node:assert/strict";
import test from "node:test";
import { meetupVenueLabel, meetupVenuePreset } from "../src/domain/venue-meetup";
import type { CommunityVenue } from "../src/domain/event-map";
const place = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "우리들의 모임 공간",
  address: "서울시 성동구 테스트길 10",
  latitude: 37.5445,
  longitude: 127.0448,
  categorySlug: "party",
  version: 1,
  contributor: {
    nickname: "공간추천자",
    publicId: "10000000-0000-4000-8000-000000000002",
    avatar: "spark",
  },
  recommendations: 10,
  description: "누구나 공유하는 추천장소",
  isOwner: true,
} as CommunityVenue;
test("opening a meetup copies only public place fields and cannot turn a contributor into the host", () => {
  const preset = meetupVenuePreset(place);
  assert.deepEqual(preset, {
    id: place.id,
    name: place.name,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    categorySlug: place.categorySlug,
    version: place.version,
  });
  assert.equal("contributor" in preset!, false);
  assert.equal("isOwner" in preset!, false);
  assert.equal(meetupVenueLabel(preset!), place.name + " · " + place.address);
});
test("long venue addresses stay within the meetup's location limit and invalid coordinates are rejected", () => {
  const preset = meetupVenuePreset({
    ...place,
    name: "긴 공간명".repeat(12),
    address: "서울특별시 성동구 주소 ".repeat(15),
  });
  assert.equal(meetupVenueLabel(preset!).length, 120);
  assert.equal(meetupVenuePreset({ ...place, latitude: 91 }), null);
  assert.equal(meetupVenuePreset({ ...place, longitude: Number.NaN }), null);
  assert.equal(
    meetupVenuePreset({ ...place, categorySlug: "lab" as CommunityVenue["categorySlug"] }),
    null,
  );
});
