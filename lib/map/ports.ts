// Provider ports: the only boundary through which Map code may depend on
// an external map/routing/weather provider. UI code and AI contracts call
// these interfaces, never a provider SDK or payload shape directly, so a
// provider can be swapped (Provider A -> Provider B -> self-hosted) without
// touching the canonical schema, the UI, or the AI-facing contracts.
import type { CapabilityResult, LatLng } from "./types";

export type TileStyle = {
  // A MapLibre style URL or inline style object. Kept opaque here so the
  // UI doesn't need to know which provider produced it.
  styleUrl: string;
  attribution: string;
};

export interface TilesPort {
  getStyle(): CapabilityResult<TileStyle>;
}

export type RouteStep = { instruction: string; distanceMeters: number };

export type VehicleType = "car" | "motorcycle" | "truck";

// Structured truck context (MC1 Phase 3 Part 1). Every field is optional --
// a caller may ask for truck-aware warnings with only the fields it knows.
export type TruckProfile = {
  heightM?: number;
  widthM?: number;
  lengthM?: number;
  grossWeightKg?: number;
  axleCount?: number;
  axleLoadKg?: number;
  hazmat?: boolean;
};

export type RoutePreferences = {
  routeType?: "fastest" | "shortest";
  avoidHighways?: boolean;
  avoidTolls?: boolean;
};

export type RouteRequest = {
  origin: LatLng;
  destination: LatLng;
  // Ordered intermediate stops between origin and destination. Multi-stop
  // is additive: a RoutingPort that can't optimize stop order may still
  // chain them in the given order.
  waypoints?: LatLng[];
  vehicle?: VehicleType; // defaults to "car" if omitted
  truckProfile?: TruckProfile;
  preferences?: RoutePreferences;
};

export type RestrictionWarning = {
  restrictionType: "height" | "weight" | "width" | "length" | "vehicle_class" | "other";
  maxValue: number | null;
  unit: string | null;
  note: string | null;
  // true iff the restriction is attached to a verified map_features row --
  // RLS on map_road_restrictions only returns such rows to a non-admin
  // caller, so this is always true for anything a client can actually read.
  verified: boolean;
  // "exceeds_profile": the caller's truckProfile has a matching dimension
  // (height/width/length/grossWeight) that numerically exceeds maxValue --
  // a real comparison against caller-supplied data, not an inference about
  // the road. "unspecified": caller didn't supply that dimension, so no
  // comparison could be made. "info": restriction type has no directly
  // comparable truckProfile field (e.g. vehicle_class, other).
  severity: "exceeds_profile" | "unspecified" | "info";
};

export type RoutePreview = {
  distanceMeters: number;
  durationSeconds: number;
  // GeoJSON order: [lng, lat] -- this is the one place this module uses
  // lng-first, matching the GeoJSON LineString spec.
  geometry: { type: "LineString"; coordinates: [number, number][] };
  steps: RouteStep[];
  isEstimate: boolean; // true until a real road-aware provider is activated
  // "native_validated": a road-aware engine computed and constraint-checked
  // this route for the requested vehicle. "advisory_estimate": distance/
  // duration are a straight-line guess and/or restriction warnings are
  // informational only -- the route does NOT route around them. Every
  // route today is advisory_estimate; no native engine is activated yet.
  routingMode: "native_validated" | "advisory_estimate";
  // Alternate routes, when the active RoutingPort can produce more than
  // one. Always empty with the straight-line adapter (only one path is
  // geometrically possible between two points).
  alternates: RoutePreview[];
  // Whether request.preferences (routeType/avoidHighways/avoidTolls) could
  // actually change this route. False for every RoutingPort that has no
  // road graph to route around anything with -- the straight-line adapter
  // always reports false rather than silently ignoring the request.
  preferencesHonored: boolean;
  // Populated only when vehicle === "truck" and a verified restriction lies
  // near the requested route. Never used to alter the geometry/duration
  // above -- see routingMode.
  restrictionWarnings: RestrictionWarning[];
};

export interface RoutingPort {
  previewRoute(request: RouteRequest): Promise<CapabilityResult<RoutePreview>>;
}

export type GeocodeResult = { label: string; lat: number; lng: number };
export interface GeocodingPort {
  search(query: string): Promise<CapabilityResult<GeocodeResult[]>>;
}

export type TrafficSegment = { lat: number; lng: number; level: "free" | "moderate" | "heavy" };
export interface TrafficPort {
  getSegments(bbox: [LatLng, LatLng]): Promise<CapabilityResult<TrafficSegment[]>>;
}

export type WeatherSnapshot = { tempC: number; condition: string };
export interface WeatherPort {
  getCurrent(point: LatLng): Promise<CapabilityResult<WeatherSnapshot>>;
}

// Read vs. write tools stay separated at the port level too: every port
// above is read-only by construction (no port here ever writes canonical
// data). Community submissions go through the submitCommunityReport
// contract in ai-contracts.ts, which calls a security-definer RPC, never a
// provider port.
