import type { LatLng } from "./types";

const EARTH_RADIUS_M = 6_371_000;

// Great-circle distance in meters. Good enough for "nearby" filtering and
// the Phase 1 routing estimate; not a substitute for real road distance.
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Cheap SQL-side pre-filter: a lat/lng bounding box around a center point.
// Callers must still apply haversineMeters precisely in JS afterward, since
// a box is not a circle -- this only narrows the row set before that.
export function boundingBox(center: LatLng, radiusMeters: number) {
  const latDelta = radiusMeters / 111_320; // meters per degree latitude, ~constant
  const lngDelta = radiusMeters / (111_320 * Math.cos((center.lat * Math.PI) / 180) || 1);
  return {
    minLat: Math.max(-90, center.lat - latDelta),
    maxLat: Math.min(90, center.lat + latDelta),
    minLng: Math.max(-180, center.lng - lngDelta),
    maxLng: Math.min(180, center.lng + lngDelta),
  };
}

export function isValidLatLng(p: Partial<LatLng>): p is LatLng {
  return (
    typeof p.lat === "number" &&
    typeof p.lng === "number" &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}
