// Coordinates are always (lat, lng) in this module's function signatures.
// GeoJSON-shaped values (e.g. a route geometry) use GeoJSON's (lng, lat)
// order instead -- that boundary is called out at each crossing point.
export type LatLng = { lat: number; lng: number };

export type MapPoiCategory = {
  id: number;
  slug: string;
  nameFa: string;
  nameEn: string | null;
  icon: string | null;
};

export type MapFeature = {
  id: number;
  categoryId: number;
  nameFa: string;
  nameEn: string | null;
  lat: number;
  lng: number;
  status: "pending" | "verified" | "rejected" | "disputed" | "expired";
  confidence: number | null;
};

// A marker for a MY CAR-registered service/rescuer profile. Sanitized
// snapshot only -- never a raw profiles row (see map_service_locations).
export type MapServiceLocation = {
  id: number;
  profileId: string;
  userType: "service" | "rescuer";
  name: string;
  city: string | null;
  region: string | null;
  lat: number;
  lng: number;
};

// Every optional/future Map capability reports this shape instead of
// silently no-oping or throwing, so the UI and AI tools can render a
// consistent "not available yet" state for anything not activated.
export type CapabilityResult<T> =
  | { status: "ok"; data: T }
  | { status: "capability_disabled"; capability: string; reason: string };

export function disabled<T>(capability: string, reason: string): CapabilityResult<T> {
  return { status: "capability_disabled", capability, reason };
}
