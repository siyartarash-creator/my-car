// AI-facing Map contracts: the only surface Automotive AI (or any other
// caller that isn't the Map UI itself) should use to read or write Map
// data. Each function here is a thin, typed wrapper around either a plain
// RLS-scoped select (read tools) or a security-definer RPC (the one write
// tool) -- never a provider payload, and never a direct canonical write.
// AI may submit a pending community report; it may never create or verify
// canonical map_features rows itself.
import type { SupabaseClient } from "@supabase/supabase-js";
import { boundingBox, expandedRouteBoundingBox, haversineMeters, routeProgress } from "./geo";
import { StraightLineRoutingAdapter } from "./adapters/routing-straight-line";
import { DemoTilesAdapter } from "./adapters/tiles-demo";
import { DisabledAdAdapter, DisabledTrafficAdapter, DisabledWeatherAdapter } from "./adapters/disabled-ports";
import { isCapabilityEnabled } from "./capabilities";
import { disabled } from "./types";
import type { CapabilityResult, LatLng, MapFeature, MapServiceLocation } from "./types";
import type {
  AdCreative,
  AdTargeting,
  GeocodeResult,
  RestrictionWarning,
  RoutePreview,
  RouteRequest,
  TrafficSnapshot,
  TruckProfile,
  VehicleType,
  WeatherSnapshot,
} from "./ports";

const routingPort = new StraightLineRoutingAdapter();
const tilesPort = new DemoTilesAdapter();
const trafficPort = new DisabledTrafficAdapter();
const weatherPort = new DisabledWeatherAdapter();
const adPort = new DisabledAdAdapter();

export function getTileStyle() {
  return tilesPort.getStyle();
}

// get_traffic_conditions (AI-owned Map tool, Phase 3 Part 2): provider-
// independent -- callers never see a provider payload, only this
// CapabilityResult<TrafficSnapshot>. Disabled until a legal, approved $0
// live traffic provider is activated; never fabricates segments.
export async function getTrafficConditions(bbox: [LatLng, LatLng]): Promise<CapabilityResult<TrafficSnapshot>> {
  if (!isCapabilityEnabled("traffic")) return disabled("traffic", "Live traffic is not activated");
  return trafficPort.getSegments(bbox);
}

// get_route_weather (AI-owned Map tool, Phase 3 Part 2): sampled points
// along a route (origin/waypoints/destination, or a caller-chosen sample).
// Disabled until a legal, commercially-usable $0 weather provider is
// activated; never fabricates a snapshot.
export async function getRouteWeather(points: LatLng[]): Promise<CapabilityResult<WeatherSnapshot[]>> {
  if (!isCapabilityEnabled("weather")) return disabled("weather", "Route/destination weather is not activated");
  return weatherPort.getAlongRoute(points);
}

// Normalizes a restriction's free-text unit to the SI unit truckProfile
// uses (meters for height/width/length, kg for weight), so a comparison
// against the caller's profile is only attempted when the unit is one we
// actually recognize -- an unrecognized unit falls back to "unspecified"
// rather than risking a wrong exceeds/doesn't-exceed claim.
function normalizeToSi(restrictionType: RestrictionWarning["restrictionType"], value: number, unit: string | null): number | null {
  const u = (unit ?? "").trim().toLowerCase();
  if (restrictionType === "weight") {
    if (u === "kg") return value;
    if (u === "t" || u === "ton" || u === "tonne" || u === "tonnes") return value * 1000;
    return null;
  }
  if (restrictionType === "height" || restrictionType === "width" || restrictionType === "length") {
    if (u === "m" || u === "meter" || u === "meters" || u === "metre" || u === "metres") return value;
    if (u === "cm") return value / 100;
    return null;
  }
  return null;
}

const PROFILE_FIELD_BY_RESTRICTION: Partial<Record<RestrictionWarning["restrictionType"], keyof TruckProfile>> = {
  height: "heightM",
  width: "widthM",
  length: "lengthM",
  weight: "grossWeightKg",
};

function severityFor(
  restrictionType: RestrictionWarning["restrictionType"],
  maxValue: number | null,
  unit: string | null,
  truckProfile: TruckProfile | undefined,
): RestrictionWarning["severity"] {
  const field = PROFILE_FIELD_BY_RESTRICTION[restrictionType];
  if (!field) return "info"; // vehicle_class / other: no directly comparable dimension
  const profileValue = truckProfile?.[field];
  if (typeof profileValue !== "number" || maxValue == null) return "unspecified";
  const normalizedMax = normalizeToSi(restrictionType, maxValue, unit);
  if (normalizedMax == null) return "unspecified"; // unrecognized unit -- don't guess
  return profileValue > normalizedMax ? "exceeds_profile" : "info";
}

// Advisory corridor half-width: how far off the route's own line a
// restriction can be and still count as "near this route." A fixed $0
// default, not derived from any provider -- see the Phase 3 audit note
// below on why a plain origin/destination bounding box isn't enough.
const RESTRICTION_CORRIDOR_METERS = 500;

// A map_road_restrictions row's embedded map_features(lat,lng,status) --
// PostgREST returns this as a single object for a many-to-one !inner
// join, but defend against an array shape too rather than assume.
function extractFeaturePoint(row: Record<string, unknown>): LatLng | null {
  const raw = row.map_features;
  const feature = Array.isArray(raw) ? raw[0] : raw;
  if (!feature || typeof feature !== "object") return null;
  const lat = (feature as Record<string, unknown>).lat;
  const lng = (feature as Record<string, unknown>).lng;
  return typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;
}

function toRestrictionWarning(row: Record<string, unknown>, truckProfile: TruckProfile | undefined): RestrictionWarning {
  const restrictionType = row.restriction_type as RestrictionWarning["restrictionType"];
  const maxValue = row.max_value as number | null;
  const unit = row.unit as string | null;
  return {
    restrictionType,
    maxValue,
    unit,
    note: row.note as string | null,
    // RLS on map_road_restrictions only returns rows tied to a verified
    // feature to a non-admin caller, so a readable row is always verified.
    verified: true,
    severity: severityFor(restrictionType, maxValue, unit, truckProfile),
  };
}

// Truck restriction warnings are advisory-only (see
// truck_restriction_advisory in lib/map/capabilities.ts): they never change
// the route geometry/duration above, only surface known verified
// restrictions near the requested points for the caller to display.
//
// Phase 3 audit fix: a plain origin/destination/waypoint bounding
// rectangle is wrong two ways -- (1) it's over-inclusive on a diagonal
// route (restrictions sitting in the box's empty corners, nowhere near
// the actual line, would have been included), and (2) it's
// under-inclusive (a false negative) on a route that's exactly
// horizontal or vertical, where the raw box degenerates to zero width/
// height and excludes anything off to the side. The fix is two-part:
// expandedRouteBoundingBox pads the box so it's never zero-width (fixes
// #2), and every candidate row is then checked against the route's real
// geometry via routeProgress(...).crossTrackMeters (fixes #1) -- the
// bounding box is only ever a cheap SQL-side pre-filter now, never the
// final answer.
async function getRestrictionWarnings(
  client: SupabaseClient,
  request: RouteRequest,
): Promise<RestrictionWarning[]> {
  if (!isCapabilityEnabled("truck_restriction_advisory")) return [];
  const path = [request.origin, ...(request.waypoints ?? []), request.destination];
  const box = expandedRouteBoundingBox(path, RESTRICTION_CORRIDOR_METERS);
  const { data, error } = await client
    .from("map_road_restrictions")
    .select("restriction_type, max_value, unit, note, map_features!inner(lat, lng, status)")
    .eq("map_features.status", "verified")
    .gte("map_features.lat", box.minLat)
    .lte("map_features.lat", box.maxLat)
    .gte("map_features.lng", box.minLng)
    .lte("map_features.lng", box.maxLng);
  if (error) throw error;
  return (data ?? [])
    .filter((row: Record<string, unknown>) => {
      const point = extractFeaturePoint(row);
      return point != null && routeProgress(point, path).crossTrackMeters <= RESTRICTION_CORRIDOR_METERS;
    })
    .map((row: Record<string, unknown>) => toRestrictionWarning(row, request.truckProfile));
}

export async function previewRoute(
  client: SupabaseClient,
  request: RouteRequest,
): Promise<CapabilityResult<RoutePreview>> {
  const result = await routingPort.previewRoute(request);
  if (result.status !== "ok" || request.vehicle !== "truck") return result;
  const restrictionWarnings = await getRestrictionWarnings(client, request);
  return { ...result, data: { ...result.data, restrictionWarnings } };
}

// get_truck_restrictions (Phase 3 Part 4 AI tool): the same verified-
// restriction data previewRoute composes for a truck route, exposed as
// its own point+radius query -- for a caller that wants restrictions near
// a single location rather than along a full route request.
export async function getTruckRestrictions(
  client: SupabaseClient,
  center: LatLng,
  radiusMeters: number,
  truckProfile?: TruckProfile,
): Promise<CapabilityResult<RestrictionWarning[]>> {
  if (!isCapabilityEnabled("truck_restriction_advisory")) {
    return disabled("truck_restriction_advisory", "Truck restriction advisory is not activated");
  }
  // Same audit fix as getRestrictionWarnings above: the bounding box is a
  // SQL-side pre-filter only -- a candidate in the box's corner can still
  // be farther than radiusMeters from center (a box isn't a circle), so
  // every row is re-checked with a true haversineMeters distance.
  const box = boundingBox(center, radiusMeters);
  const { data, error } = await client
    .from("map_road_restrictions")
    .select("restriction_type, max_value, unit, note, map_features!inner(lat, lng, status)")
    .eq("map_features.status", "verified")
    .gte("map_features.lat", box.minLat)
    .lte("map_features.lat", box.maxLat)
    .gte("map_features.lng", box.minLng)
    .lte("map_features.lng", box.maxLng);
  if (error) throw error;
  const results: RestrictionWarning[] = (data ?? [])
    .filter((row: Record<string, unknown>) => {
      const point = extractFeaturePoint(row);
      return point != null && haversineMeters(center, point) <= radiusMeters;
    })
    .map((row: Record<string, unknown>) => toRestrictionWarning(row, truckProfile));
  return { status: "ok", data: results };
}

// Postgres "undefined_function" -- raised when the DB-native proximity
// RPCs from supabase/staging/202610040001_map_proximity_rpcs.sql aren't
// present yet (PostGIS not activated on this environment). Falling back
// keeps this contract working everywhere Phase 1 already worked; it is not
// how a real data error looks (those come back as other codes/messages).
const UNDEFINED_FUNCTION = "42883";

export async function getNearbyServiceLocations(
  client: SupabaseClient,
  center: LatLng,
  radiusMeters: number,
): Promise<CapabilityResult<MapServiceLocation[]>> {
  const rpc = await client.rpc("nearby_service_locations", {
    p_lat: center.lat,
    p_lng: center.lng,
    p_radius_m: Math.round(radiusMeters),
  });
  if (!rpc.error) {
    const results: MapServiceLocation[] = (rpc.data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id,
      profileId: row.profile_id,
      userType: row.user_type_snapshot,
      name: row.name_snapshot,
      city: row.city_snapshot,
      region: row.region_snapshot,
      lat: row.lat,
      lng: row.lng,
    })) as MapServiceLocation[];
    return { status: "ok", data: results };
  }
  if (rpc.error.code !== UNDEFINED_FUNCTION) throw rpc.error;

  const box = boundingBox(center, radiusMeters);
  const { data, error } = await client
    .from("map_service_locations")
    .select("id, profile_id, user_type_snapshot, name_snapshot, city_snapshot, region_snapshot, lat, lng")
    .eq("is_published", true)
    .gte("lat", box.minLat)
    .lte("lat", box.maxLat)
    .gte("lng", box.minLng)
    .lte("lng", box.maxLng);
  if (error) throw error;
  const results: MapServiceLocation[] = (data ?? [])
    .map((row) => ({
      id: row.id,
      profileId: row.profile_id,
      userType: row.user_type_snapshot,
      name: row.name_snapshot,
      city: row.city_snapshot,
      region: row.region_snapshot,
      lat: row.lat,
      lng: row.lng,
    }))
    .filter((loc) => haversineMeters(center, loc) <= radiusMeters);
  return { status: "ok", data: results };
}

export async function getNearbyFeatures(
  client: SupabaseClient,
  center: LatLng,
  radiusMeters: number,
  categorySlug?: string,
): Promise<CapabilityResult<MapFeature[]>> {
  const rpc = await client.rpc("nearby_features", {
    p_lat: center.lat,
    p_lng: center.lng,
    p_radius_m: Math.round(radiusMeters),
    p_category_slug: categorySlug ?? null,
  });
  if (!rpc.error) {
    const results: MapFeature[] = (rpc.data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id,
      categoryId: row.category_id,
      nameFa: row.name_fa,
      nameEn: row.name_en,
      lat: row.lat,
      lng: row.lng,
      status: row.status,
      confidence: row.confidence,
    })) as MapFeature[];
    return { status: "ok", data: results };
  }
  if (rpc.error.code !== UNDEFINED_FUNCTION) throw rpc.error;

  const box = boundingBox(center, radiusMeters);
  let query = client
    .from("map_features")
    .select("id, category_id, name_fa, name_en, lat, lng, status, confidence, map_poi_categories!inner(slug)")
    .eq("status", "verified")
    .gte("lat", box.minLat)
    .lte("lat", box.maxLat)
    .gte("lng", box.minLng)
    .lte("lng", box.maxLng);
  if (categorySlug) query = query.eq("map_poi_categories.slug", categorySlug);
  const { data, error } = await query;
  if (error) throw error;
  const results: MapFeature[] = (data ?? [])
    .map((row) => ({
      id: row.id,
      categoryId: row.category_id,
      nameFa: row.name_fa,
      nameEn: row.name_en,
      lat: row.lat,
      lng: row.lng,
      status: row.status,
      confidence: row.confidence,
    }))
    .filter((f) => haversineMeters(center, f) <= radiusMeters);
  return { status: "ok", data: results };
}

const FUEL_CATEGORY_SLUGS = ["petrol", "diesel", "cng", "ev_charging", "fuel_station"] as const;
export type FuelType = (typeof FUEL_CATEGORY_SLUGS)[number];

// find_fuel_stations (AI-owned Map tool, Phase 3 Part 2). Real data only --
// returns whatever map_features currently holds for these categories
// (honestly empty until a real import/community pipeline populates them;
// see map_phase3_part2_infrastructure.sql for the category rows
// themselves). Queries per-category through the existing
// getNearbyFeatures/nearby_features path rather than a new RPC, since that
// RPC takes one category_slug and a second ambiguous overload is exactly
// the bug class this codebase has already hit once (see
// review_community_report's migration history).
export async function findFuelStations(
  client: SupabaseClient,
  center: LatLng,
  radiusMeters: number,
  fuelTypes?: FuelType[],
): Promise<CapabilityResult<MapFeature[]>> {
  const slugs = fuelTypes && fuelTypes.length > 0 ? fuelTypes : FUEL_CATEGORY_SLUGS;
  const results = await Promise.all(slugs.map((slug) => getNearbyFeatures(client, center, radiusMeters, slug)));
  const merged: MapFeature[] = [];
  for (const r of results) if (r.status === "ok") merged.push(...r.data);
  merged.sort((a, b) => haversineMeters(center, a) - haversineMeters(center, b));
  return { status: "ok", data: merged };
}

const SAFE_STOP_CATEGORY_SLUGS_BY_VEHICLE: Record<VehicleType, string[]> = {
  car: ["parking"],
  motorcycle: ["parking"],
  truck: ["truck_stop", "weigh_station", "parking"],
};

// find_safe_stop (AI-owned Map tool, Phase 3 Part 2): nearby places to
// stop, scoped by vehicle -- a truck additionally sees truck_stop/
// weigh_station categories. This is "what's nearby," not a route-corridor
// search; corridor sampling needs real route geometry from a road-aware
// RoutingPort, which is not activated (see lib/map/capabilities.ts).
export async function findSafeStop(
  client: SupabaseClient,
  center: LatLng,
  radiusMeters: number,
  vehicle: VehicleType = "car",
): Promise<CapabilityResult<MapFeature[]>> {
  const slugs = SAFE_STOP_CATEGORY_SLUGS_BY_VEHICLE[vehicle];
  const results = await Promise.all(slugs.map((slug) => getNearbyFeatures(client, center, radiusMeters, slug)));
  const merged: MapFeature[] = [];
  for (const r of results) if (r.status === "ok") merged.push(...r.data);
  merged.sort((a, b) => haversineMeters(center, a) - haversineMeters(center, b));
  return { status: "ok", data: merged };
}

export type RoadEvent = MapFeature & {
  // Phase 3 audit fix: null means exactly what it says -- no
  // map_road_event_details row exists for this feature (e.g. a report
  // promoted before classification was required, or imported via some
  // other path). Previously this silently defaulted to "other"/"low",
  // which fabricated a classification nobody ever gave it. A caller
  // (UI or AI) must treat null as "unclassified," never as a real
  // low-severity "other" event.
  eventType: "closure" | "accident" | "roadworks" | "hazard" | "other" | null;
  severity: "low" | "medium" | "high" | "critical" | null;
};

// Write-path classification is never null -- a caller submitting a
// report must supply a concrete type/severity (or omit classification
// entirely, via submitCommunityReport's optional roadEvent param). Only
// the read path (RoadEvent above) can be null, for a feature nobody ever
// classified.
export type RoadEventType = Exclude<RoadEvent["eventType"], null>;
export type RoadEventSeverity = Exclude<RoadEvent["severity"], null>;

// Road-event queries (AI-owned Map tool, Phase 3 Part 2): reuses the
// existing moderated map_features/road_event pipeline -- never a parallel
// system. Enriches each verified road_event feature with its
// map_road_event_details row (RLS-gated the same as the feature itself).
export async function findRoadEvents(
  client: SupabaseClient,
  center: LatLng,
  radiusMeters: number,
): Promise<CapabilityResult<RoadEvent[]>> {
  const nearby = await getNearbyFeatures(client, center, radiusMeters, "road_event");
  if (nearby.status !== "ok" || nearby.data.length === 0) return nearby as CapabilityResult<RoadEvent[]>;
  const ids = nearby.data.map((f) => f.id);
  const { data, error } = await client.from("map_road_event_details").select("feature_id, event_type, severity").in("feature_id", ids);
  if (error) throw error;
  const detailByFeatureId = new Map((data ?? []).map((row: Record<string, unknown>) => [row.feature_id as number, row]));
  const events: RoadEvent[] = nearby.data.map((f) => {
    const detail = detailByFeatureId.get(f.id) as Record<string, unknown> | undefined;
    return {
      ...f,
      eventType: (detail?.event_type as RoadEvent["eventType"]) ?? null,
      severity: (detail?.severity as RoadEvent["severity"]) ?? null,
    };
  });
  return { status: "ok", data: events };
}

// Calls this app's own /api/map/geocode proxy, never Nominatim directly --
// the browser can't set the User-Agent header Nominatim's usage policy
// requires, and routing every caller (Map UI, AI tools) through one
// server-side endpoint keeps the provider-specific payload (and its rate
// limit) in one place, per the provider-isolation rule in lib/map/ports.ts.
export async function searchPlaces(query: string): Promise<CapabilityResult<GeocodeResult[]>> {
  const res = await fetch(`/api/map/geocode?q=${encodeURIComponent(query)}`, { headers: { Accept: "application/json" } });
  return (await res.json()) as CapabilityResult<GeocodeResult[]>;
}

// The one write tool: submits a pending report. Never writes map_features
// directly -- promotion is an explicit admin decision (see
// review_community_report in 202610030000_map_foundation.sql).
export async function submitCommunityReport(
  client: SupabaseClient,
  point: LatLng,
  description: string | null,
  categoryId: number | null,
  // Only meaningful for a road_event category report; submit_community_report
  // validates both server-side (invalid_event_type/invalid_severity) rather
  // than trusting this client-side typing alone.
  roadEvent?: { eventType: RoadEventType; severity: RoadEventSeverity },
): Promise<number> {
  const { data, error } = await client.rpc("submit_community_report", {
    p_category_id: categoryId,
    p_lat: point.lat,
    p_lng: point.lng,
    p_description: description,
    p_event_type: roadEvent?.eventType ?? null,
    p_severity: roadEvent?.severity ?? null,
  });
  if (error) throw error;
  return data as number;
}

// report_road_condition (Phase 3 Part 4 AI tool): a thin, road_event-
// specific wrapper over submitCommunityReport -- looks up the road_event
// category id so a caller (AI or UI) never needs to know it. Same write
// boundary as submitCommunityReport: lands as a 'pending' report, never a
// verified canonical map_features row. AI cannot directly create verified
// canonical road data -- only an admin's review_community_report can.
export async function reportRoadCondition(
  client: SupabaseClient,
  point: LatLng,
  eventType: RoadEventType,
  severity: RoadEventSeverity,
  description: string | null = null,
): Promise<number> {
  const { data: category, error: categoryError } = await client
    .from("map_poi_categories")
    .select("id")
    .eq("slug", "road_event")
    .single();
  if (categoryError) throw categoryError;
  return submitCommunityReport(client, point, description, category.id as number, { eventType, severity });
}

// --- Phase 3 Part 3: MY CAR service network --------------------------

// find_services_along_route (AI-owned Map tool): samples the route's
// origin/waypoints/destination (not every coordinate -- this is "which
// registered services are near this route," not a dense corridor scan)
// and merges getNearbyServiceLocations results, deduped by id. Only
// registered MY CAR service/rescuer profiles ever appear here -- this
// reuses map_service_locations/nearby_service_locations exactly as-is,
// never pulls in an arbitrary external business.
export async function findServicesAlongRoute(
  client: SupabaseClient,
  routePoints: LatLng[],
  radiusMeters: number,
  userType?: MapServiceLocation["userType"],
): Promise<CapabilityResult<MapServiceLocation[]>> {
  if (!isCapabilityEnabled("services_along_route")) {
    return disabled("services_along_route", "Services-along-route is not activated");
  }
  const results = await Promise.all(routePoints.map((p) => getNearbyServiceLocations(client, p, radiusMeters)));
  const byId = new Map<number, MapServiceLocation>();
  for (const r of results) {
    if (r.status !== "ok") continue;
    for (const loc of r.data) {
      if (userType && loc.userType !== userType) continue;
      if (!byId.has(loc.id)) byId.set(loc.id, loc);
    }
  }
  const merged = [...byId.values()];
  merged.sort((a, b) => haversineMeters(routePoints[0], a) - haversineMeters(routePoints[0], b));
  return { status: "ok", data: merged };
}

// --- Phase 3 Part 3: roadside Map-side location handoff ----------------
// This is the Map-owned primitive only -- a stranded driver's opt-in,
// revocable, short-TTL location share. It is NOT a dispatch/matching
// system: deciding who gets matched to a breakdown report is a separate
// domain's business logic (see the CROSS-DOMAIN DEPENDENCY note in
// supabase/migrations/202610060000_map_phase3_part3_location_share.sql).

export type LocationShareContext = "roadside_breakdown" | "other";

// create_location_share: default OFF -- nothing calls this except an
// explicit user action (see the "درخواست کمک" button in MapView.tsx).
export async function createLocationShare(
  client: SupabaseClient,
  point: LatLng,
  context: LocationShareContext = "roadside_breakdown",
  ttlMinutes = 120,
): Promise<number> {
  const { data, error } = await client.rpc("create_location_share", {
    p_lat: point.lat,
    p_lng: point.lng,
    p_context: context,
    p_ttl_minutes: ttlMinutes,
  });
  if (error) throw error;
  return data as number;
}

export async function revokeLocationShare(client: SupabaseClient, shareId: number): Promise<void> {
  const { error } = await client.rpc("revoke_location_share", { p_share_id: shareId });
  if (error) throw error;
}

// delete_location_share (Phase 3 audit fix, item 3): hard-deletes the
// share row, not just marks it revoked -- revoking alone (above) only
// ever controlled read access via RLS, it never removed the coordinates
// from the table. This is the actual deletion path.
export async function deleteLocationShare(client: SupabaseClient, shareId: number): Promise<void> {
  const { error } = await client.rpc("delete_location_share", { p_share_id: shareId });
  if (error) throw error;
}

// grant_location_share_access: the owner hands a specific other profile
// (e.g. a responder they've been connected with) read access to an
// active share. This is the Map-side half of "temporary location
// handoff" -- a future responder-matching feature would call this once
// it decides who the owner is handing off to; Map itself never decides
// that match.
export async function grantLocationShareAccess(client: SupabaseClient, shareId: number, granteeProfileId: string): Promise<number> {
  const { data, error } = await client.rpc("grant_location_share_access", {
    p_share_id: shareId,
    p_grantee_profile_id: granteeProfileId,
  });
  if (error) throw error;
  return data as number;
}

export type LocationShare = {
  id: number;
  context: LocationShareContext;
  lat: number;
  lng: number;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

// My own active shares. Phase 3 audit fix: this now explicitly filters
// profile_id = the caller's own id, not just RLS alone -- RLS's
// map_location_share_read policy also lets a caller see an active share
// they've been GRANTED access to (someone else's), so relying on RLS
// alone here would have let a grantee's row leak into "what have I
// shared" and hydrate revoke/delete controls for a share they don't own.
export async function getMyActiveLocationShares(client: SupabaseClient): Promise<LocationShare[]> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return [];
  const { data, error } = await client
    .from("map_location_shares")
    .select("id, context, lat, lng, created_at, expires_at, revoked_at")
    .eq("profile_id", user.id)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    context: row.context,
    lat: row.lat,
    lng: row.lng,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }));
}

// --- Phase 3 Part 3: advertising (Map-side architecture only) ----------
// get_map_ads (AI-owned Map tool): CROSS-DOMAIN DEPENDENCY -- see AdPort
// in lib/map/ports.ts and map_advertising in capabilities.ts. Disabled
// until a registered-business ad backend exists; never serves a
// placeholder/fake ad.
export async function getMapAds(targeting: AdTargeting): Promise<CapabilityResult<AdCreative[]>> {
  if (!isCapabilityEnabled("map_advertising")) return disabled("map_advertising", "Map advertising is not activated");
  return adPort.getAdsForTargeting(targeting);
}
