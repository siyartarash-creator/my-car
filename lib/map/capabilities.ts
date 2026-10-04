// Capability registry: the single place that says which Map capabilities
// are active in the running Phase. Paid providers stay structurally wired
// (the port + adapter exist) but report disabled here, never activated by
// a code change alone -- activation is an explicit, budgeted decision.
export type MapCapability =
  | "tiles"
  | "routing_preview"
  | "geocoding"
  | "traffic"
  | "weather"
  | "truck_routing"
  | "truck_restriction_advisory"
  | "multi_stop_routing"
  | "live_navigation";

export const CAPABILITY_REGISTRY: Record<MapCapability, { enabled: boolean; reason: string }> = {
  tiles: { enabled: true, reason: "$0 MapLibre + OSM-compatible demo tiles" },
  routing_preview: {
    enabled: true,
    reason: "Phase 1 prototype: great-circle distance/duration estimate, not road-aware",
  },
  geocoding: {
    enabled: true,
    reason: "Phase 2: $0 OSM Nominatim via a rate-limited server-side proxy (app/api/map/geocode)",
  },
  traffic: {
    enabled: false,
    reason: "Phase 3 Part 2: TrafficPort/TrafficSnapshot contract and AI tool (get_traffic_conditions) are complete; disabled because no legal, approved $0 live traffic provider has been identified",
  },
  weather: {
    enabled: false,
    reason: "Phase 3 Part 2: WeatherPort/WeatherSnapshot contract and AI tool (get_route_weather) are complete; disabled because no legal, commercially-usable $0 weather provider has been confirmed (Open-Meteo is a candidate but its license terms for commercial use need Owner/legal confirmation before activation)",
  },
  truck_routing: {
    enabled: false,
    reason:
      "Native, restriction-validated truck routing (a road-aware engine that plans around height/weight/width limits) is not implemented -- no routing engine consumes map_road_restrictions yet",
  },
  truck_restriction_advisory: {
    enabled: true,
    reason:
      "Phase 3 Part 1, $0: known verified restrictions (map_road_restrictions, feature status=verified) near the requested origin/destination/waypoints are surfaced as warnings. The route itself is still the straight-line estimate and does NOT route around them -- see RoutePreview.routingMode",
  },
  multi_stop_routing: {
    enabled: true,
    reason: "Phase 3 Part 1, $0: waypoints are chained in request order through the straight-line estimator; no stop-order optimization or real road engine yet",
  },
  live_navigation: { enabled: false, reason: "Turn-by-turn live navigation is out of Phase 3 Part 1 scope" },
};

export function isCapabilityEnabled(capability: MapCapability): boolean {
  return CAPABILITY_REGISTRY[capability]?.enabled ?? false;
}
