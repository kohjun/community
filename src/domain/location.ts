// Venue coordinates are public event information. A visitor's coordinates are never stored.
export const EARTH_RADIUS_KM = 6371.0088;
export function kilometersBetween(
  latitude: number,
  longitude: number,
  venueLatitude: number,
  venueLongitude: number,
) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const a =
    Math.sin(radians(venueLatitude - latitude) / 2) ** 2 +
    Math.cos(radians(latitude)) *
      Math.cos(radians(venueLatitude)) *
      Math.sin(radians(venueLongitude - longitude) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}
