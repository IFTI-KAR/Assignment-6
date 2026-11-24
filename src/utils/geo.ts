const EARTH_RADIUS_KM = 6371;
/** Straight-line distance is multiplied by this to approximate real road distance. */
export const ROAD_FACTOR = 1.3;
/** Average urban ambulance speed used for ETA estimates. */
export const AVG_SPEED_KMH = 35;

export type Coordinates = { lat: number; lng: number };

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Haversine great-circle distance in kilometres. */
export const haversineKm = (a: Coordinates, b: Coordinates): number => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
};

/** Estimated road distance (km), rounded to 2 decimals. */
export const roadDistanceKm = (a: Coordinates, b: Coordinates) =>
  Math.round(haversineKm(a, b) * ROAD_FACTOR * 100) / 100;

/** ETA in whole minutes (minimum 1). */
export const etaMinutes = (distanceKm: number) =>
  Math.max(1, Math.round((distanceKm / AVG_SPEED_KMH) * 60));
