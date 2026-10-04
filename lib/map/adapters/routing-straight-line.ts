import { haversineMeters } from "../geo";
import { isCapabilityEnabled } from "../capabilities";
import type { CapabilityResult, LatLng } from "../types";
import { disabled } from "../types";
import type { RoutePreview, RoutingPort, RouteRequest, RouteStep } from "../ports";

// $0 prototype RoutingPort: a great-circle estimate, not a real road-aware
// route. Honest about that via isEstimate/routingMode so the UI never
// implies turn-by-turn accuracy. A road-aware provider (e.g. a self-hosted
// OSRM/Valhalla instance) is a second RoutingPort implementation behind the
// same interface -- activating it is a capability-registry + provider-
// selection change, not a rewrite of anything that calls previewRoute().
const ASSUMED_AVERAGE_SPEED_KMH = 45;

export class StraightLineRoutingAdapter implements RoutingPort {
  async previewRoute(request: RouteRequest): Promise<CapabilityResult<RoutePreview>> {
    if (!isCapabilityEnabled("routing_preview")) {
      return disabled("routing_preview", "Routing preview capability is disabled");
    }
    const waypoints = request.waypoints ?? [];
    if (waypoints.length > 0 && !isCapabilityEnabled("multi_stop_routing")) {
      return disabled("multi_stop_routing", "Multi-stop routing capability is disabled");
    }
    const legs: [LatLng, LatLng][] = [];
    const chain = [request.origin, ...waypoints, request.destination];
    for (let i = 0; i < chain.length - 1; i++) legs.push([chain[i], chain[i + 1]]);

    let distanceMeters = 0;
    const coordinates: [number, number][] = [[chain[0].lng, chain[0].lat]];
    const steps: RouteStep[] = [];
    for (const [from, to] of legs) {
      const legDistance = haversineMeters(from, to);
      distanceMeters += legDistance;
      coordinates.push([to.lng, to.lat]);
      steps.push({
        instruction: "Head toward next point (straight-line estimate)",
        distanceMeters: legDistance,
      });
    }
    const durationSeconds = (distanceMeters / 1000 / ASSUMED_AVERAGE_SPEED_KMH) * 3600;

    return {
      status: "ok",
      data: {
        distanceMeters,
        durationSeconds,
        geometry: { type: "LineString", coordinates },
        steps,
        isEstimate: true,
        routingMode: "advisory_estimate",
        // Only one geometric path exists between fixed points at this
        // precision -- a real alternates list needs a road-aware engine.
        alternates: [],
        // No road graph exists here to route around a preference -- always
        // false, never silently ignored.
        preferencesHonored: false,
        // The adapter never queries the DB; ai-contracts.ts composes
        // restriction warnings for vehicle === "truck" on top of this.
        restrictionWarnings: [],
      },
    };
  }
}
