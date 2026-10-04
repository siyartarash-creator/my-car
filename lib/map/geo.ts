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

// Flat local projection centered on `point`, in meters. Good enough for
// cross-track/progress math over a single route leg (km scale); not a
// substitute for a geodesic projection over long distances -- same
// honesty bar as haversineMeters above.
function toLocalMeters(point: LatLng, p: LatLng) {
  const y = (p.lat - point.lat) * 111_320;
  const x = (p.lng - point.lng) * 111_320 * (Math.cos((point.lat * Math.PI) / 180) || 1);
  return { x, y };
}

export type RouteProgress = {
  distanceTraveledMeters: number; // along the path, up to the nearest point to `point`
  distanceRemainingMeters: number; // along the path, from the nearest point to the end
  crossTrackMeters: number; // perpendicular distance from `point` to the path (off-route signal)
};

// Projects `point` onto a polyline (e.g. a RoutePreview.geometry path, as
// LatLng -- callers convert from GeoJSON [lng,lat] first) and returns both
// the along-path progress and the perpendicular off-route distance. Used
// by lib/map/navigation.ts for off-route detection and a progress readout;
// never a substitute for a real road-aware engine's own route-matching.
export function routeProgress(point: LatLng, path: LatLng[]): RouteProgress {
  if (path.length < 2) {
    const d = path.length === 1 ? haversineMeters(point, path[0]) : 0;
    return { distanceTraveledMeters: 0, distanceRemainingMeters: 0, crossTrackMeters: d };
  }
  const segmentLengths = path.slice(0, -1).map((p, i) => haversineMeters(p, path[i + 1]));
  const totalLength = segmentLengths.reduce((a, b) => a + b, 0);

  let best = { segmentIndex: 0, t: 0, crossTrackMeters: Infinity, distanceTraveledMeters: 0 };
  let traveledBeforeSegment = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = toLocalMeters(point, path[i]);
    const b = toLocalMeters(point, path[i + 1]);
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (-a.x * abx + -a.y * aby) / lenSq));
    const cx = a.x + t * abx;
    const cy = a.y + t * aby;
    const crossTrackMeters = Math.hypot(cx, cy);
    if (crossTrackMeters < best.crossTrackMeters) {
      best = { segmentIndex: i, t, crossTrackMeters, distanceTraveledMeters: traveledBeforeSegment + t * segmentLengths[i] };
    }
    traveledBeforeSegment += segmentLengths[i];
  }
  return {
    distanceTraveledMeters: best.distanceTraveledMeters,
    distanceRemainingMeters: Math.max(0, totalLength - best.distanceTraveledMeters),
    crossTrackMeters: best.crossTrackMeters,
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
