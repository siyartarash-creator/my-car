// AI-facing Map contracts: the only surface Automotive AI (or any other
// caller that isn't the Map UI itself) should use to read or write Map
// data. Each function here is a thin, typed wrapper around either a plain
// RLS-scoped select (read tools) or a security-definer RPC (the one write
// tool) -- never a provider payload, and never a direct canonical write.
// AI may submit a pending community report; it may never create or verify
// canonical map_features rows itself.
import type { SupabaseClient } from "@supabase/supabase-js";
import { boundingBox, haversineMeters } from "./geo";
import { StraightLineRoutingAdapter } from "./adapters/routing-straight-line";
import { DemoTilesAdapter } from "./adapters/tiles-demo";
import { isCapabilityEnabled } from "./capabilities";
import type { CapabilityResult, LatLng, MapFeature, MapServiceLocation } from "./types";
import type { GeocodeResult, RestrictionWarning, RoutePreview, RouteRequest, TruckProfile } from "./ports";

const routingPort = new StraightLineRoutingAdapter();
const tilesPort = new DemoTilesAdapter();

export function getTileStyle() {
  return tilesPort.getStyle();
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

// Truck restriction warnings are advisory-only (see
// truck_restriction_advisory in lib/map/capabilities.ts): they never change
// the route geometry/duration above, only surface known verified
// restrictions near the requested points for the caller to display.
async function getRestrictionWarnings(
  client: SupabaseClient,
  request: RouteRequest,
): Promise<RestrictionWarning[]> {
  if (!isCapabilityEnabled("truck_restriction_advisory")) return [];
  const points = [request.origin, ...(request.waypoints ?? []), request.destination];
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const { data, error } = await client
    .from("map_road_restrictions")
    .select("restriction_type, max_value, unit, note, map_features!inner(lat, lng, status)")
    .eq("map_features.status", "verified")
    .gte("map_features.lat", minLat)
    .lte("map_features.lat", maxLat)
    .gte("map_features.lng", minLng)
    .lte("map_features.lng", maxLng);
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => {
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
      severity: severityFor(restrictionType, maxValue, unit, request.truckProfile),
    };
  });
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
): Promise<number> {
  const { data, error } = await client.rpc("submit_community_report", {
    p_category_id: categoryId,
    p_lat: point.lat,
    p_lng: point.lng,
    p_description: description,
  });
  if (error) throw error;
  return data as number;
}
