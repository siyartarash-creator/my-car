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
  traffic: { enabled: false, reason: "Live traffic is out of Phase 1 scope" },
  weather: { enabled: false, reason: "Route/destination weather is out of Phase 1 scope" },
  truck_routing: { enabled: false, reason: "Truck/road restriction evaluation is out of Phase 1 scope" },
  live_navigation: { enabled: false, reason: "Turn-by-turn live navigation is out of Phase 1 scope" },
};

export function isCapabilityEnabled(capability: MapCapability): boolean {
  return CAPABILITY_REGISTRY[capability]?.enabled ?? false;
}
