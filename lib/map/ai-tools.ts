// Phase 3 Part 4: the stable, named Map AI tool surface. Automotive AI
// (or any other LLM/tool-calling caller) must call these names only --
// never a provider SDK, never lib/map/adapters/* directly, never a
// Supabase table outside the read/write boundary these functions already
// enforce. Every tool here is a thin wrapper around lib/map/ai-contracts.ts
// -- this file adds naming stability and a few cross-cutting
// conveniences (userType filtering, provenance echo), not new business
// logic, so the underlying contract functions stay independently testable.
//
// Read/write separation: every tool except report_road_condition is
// read-only. report_road_condition is the one write tool, and it can only
// ever create a 'pending' community report -- it cannot create or verify
// a canonical map_features row (that remains an admin-only decision via
// review_community_report). AI cannot directly create verified canonical
// road data.
//
// Auth context: every tool takes the caller's own SupabaseClient (never a
// service-role client) as its first argument, so RLS applies exactly as
// it would for the calling user -- the AI surface widens nothing.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  previewRoute,
  getNearbyServiceLocations,
  findServicesAlongRoute,
  getNearbyFeatures,
  getRouteWeather,
  getTrafficConditions,
  getTruckRestrictions,
  findFuelStations,
  findSafeStop,
  reportRoadCondition,
} from "./ai-contracts";
import type { LatLng, MapFeature, MapServiceLocation } from "./types";
import type { RouteRequest } from "./ports";
import type { RoadEvent } from "./ai-contracts";

function filterByUserType(results: MapServiceLocation[], userType?: MapServiceLocation["userType"]) {
  return userType ? results.filter((r) => r.userType === userType) : results;
}

export const MAP_AI_TOOLS = {
  // get_route: previewRoute already returns provenance/confidence-shaped
  // data via routingMode (advisory_estimate vs native_validated) and
  // restrictionWarnings[].severity -- see lib/map/ports.ts RoutePreview.
  get_route: (client: SupabaseClient, request: RouteRequest) => previewRoute(client, request),

  find_nearby_services: async (
    client: SupabaseClient,
    center: LatLng,
    radiusMeters: number,
    userType?: MapServiceLocation["userType"],
  ) => {
    const res = await getNearbyServiceLocations(client, center, radiusMeters);
    return res.status === "ok" ? { ...res, data: filterByUserType(res.data, userType) } : res;
  },

  find_services_along_route: (
    client: SupabaseClient,
    routePoints: LatLng[],
    radiusMeters: number,
    userType?: MapServiceLocation["userType"],
  ) => findServicesAlongRoute(client, routePoints, radiusMeters, userType),

  find_pois: (client: SupabaseClient, center: LatLng, radiusMeters: number, categorySlug?: string) =>
    getNearbyFeatures(client, center, radiusMeters, categorySlug),

  // get_route_weather / get_traffic_conditions: both return
  // capability_disabled today (no $0 provider) -- see
  // lib/map/capabilities.ts. A caller gets an honest disabled state, not
  // a hang or a fabricated reading.
  get_route_weather: (points: LatLng[]) => getRouteWeather(points),
  get_traffic_conditions: (bbox: [LatLng, LatLng]) => getTrafficConditions(bbox),

  get_truck_restrictions: (
    client: SupabaseClient,
    center: LatLng,
    radiusMeters: number,
    truckProfile?: Parameters<typeof getTruckRestrictions>[3],
  ) => getTruckRestrictions(client, center, radiusMeters, truckProfile),

  find_fuel_stations: (
    client: SupabaseClient,
    center: LatLng,
    radiusMeters: number,
    fuelTypes?: Parameters<typeof findFuelStations>[3],
  ) => findFuelStations(client, center, radiusMeters, fuelTypes),

  find_safe_stop: (client: SupabaseClient, center: LatLng, radiusMeters: number, vehicle?: Parameters<typeof findSafeStop>[3]) =>
    findSafeStop(client, center, radiusMeters, vehicle),

  // report_road_condition: the one write tool. Always lands as a
  // 'pending' report -- see the module doc comment above.
  report_road_condition: (
    client: SupabaseClient,
    point: LatLng,
    eventType: RoadEvent["eventType"],
    severity: RoadEvent["severity"],
    description?: string | null,
  ) => reportRoadCondition(client, point, eventType, severity, description ?? null),
} as const;

export type MapAiToolName = keyof typeof MAP_AI_TOOLS;

// Re-exported only for callers that need the raw MapFeature/RoadEvent
// shapes without importing ai-contracts.ts directly.
export type { MapFeature, RoadEvent };
