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
import type { CapabilityResult, LatLng, MapFeature, MapServiceLocation } from "./types";

const routingPort = new StraightLineRoutingAdapter();
const tilesPort = new DemoTilesAdapter();

export function getTileStyle() {
  return tilesPort.getStyle();
}

export async function previewRoute(origin: LatLng, destination: LatLng) {
  return routingPort.previewRoute(origin, destination);
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
