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
  | "live_navigation_foreground"
  | "live_navigation_background"
  | "services_along_route"
  | "roadside_location_share"
  | "map_advertising"
  | "route_history";

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
  live_navigation_foreground: {
    enabled: true,
    reason:
      "Phase 3 Part 3, $0: foreground-only route progress/off-route/arrival via the browser Geolocation watchPosition API (lib/map/navigation.ts). Requires the tab to stay open and visible -- see live_navigation_background for why that's a separate, disabled capability.",
  },
  live_navigation_background: {
    enabled: false,
    reason:
      "Reliable background/locked-screen navigation needs a native wrapper with a background-location capability (e.g. Capacitor + a background-geolocation plugin, or a native app) -- this repo is a plain Next.js browser app (confirmed: no Capacitor/Cordova config, no service-worker background-sync). A browser tab is suspended/killed in the background on every mobile OS, so this is a platform dependency, not a Map-code gap.",
  },
  services_along_route: {
    enabled: true,
    reason: "Phase 3 Part 3, $0: samples existing nearby_service_locations along a route's origin/waypoints/destination -- reuses Phase 1's service directory, no new data source.",
  },
  roadside_location_share: {
    enabled: true,
    reason: "Phase 3 Part 3, $0: map_location_shares/map_location_share_grants -- opt-in only, owner-created, short TTL, revocable, minimum data (lat/lng/context). Default off: nothing creates a share except an explicit user action.",
  },
  map_advertising: {
    enabled: false,
    reason:
      "CROSS-DOMAIN DEPENDENCY: Map-side contract (AdPort/AdTargeting) is complete, but no registered-business commercial/ad-purchase backend exists yet (would belong to the Store/Services domain) to source real ad inventory from. Disabled rather than serving placeholder/fake ads.",
  },
  route_history: {
    enabled: false,
    reason:
      "Multi-point trip-trail logging is not implemented -- no identified consumer beyond the single-point roadside_location_share (which already covers the Part 3 'location sharing' requirement with its own retention/revocation). Building a persistent trail with no consumer would be an unjustified privacy risk; left disabled rather than built speculatively.",
  },
};

export function isCapabilityEnabled(capability: MapCapability): boolean {
  return CAPABILITY_REGISTRY[capability]?.enabled ?? false;
}
