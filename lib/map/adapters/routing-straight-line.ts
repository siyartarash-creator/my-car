import { haversineMeters } from "../geo";
import { isCapabilityEnabled } from "../capabilities";
import type { CapabilityResult, LatLng } from "../types";
import { disabled } from "../types";
import type { RoutePreview, RoutingPort } from "../ports";

// $0 prototype RoutingPort: a great-circle estimate, not a real road-aware
// route. Honest about that via isEstimate so the UI never implies turn-by-
// turn accuracy. A road-aware provider (e.g. a self-hosted OSRM instance)
// is a second RoutingPort implementation behind the same interface --
// activating it is a capability-registry + provider-selection change, not
// a rewrite of anything that calls previewRoute().
const ASSUMED_AVERAGE_SPEED_KMH = 45;

export class StraightLineRoutingAdapter implements RoutingPort {
  async previewRoute(origin: LatLng, destination: LatLng): Promise<CapabilityResult<RoutePreview>> {
    if (!isCapabilityEnabled("routing_preview")) {
      return disabled("routing_preview", "Routing preview capability is disabled");
    }
    const distanceMeters = haversineMeters(origin, destination);
    const durationSeconds = (distanceMeters / 1000 / ASSUMED_AVERAGE_SPEED_KMH) * 3600;
    return {
      status: "ok",
      data: {
        distanceMeters,
        durationSeconds,
        geometry: {
          type: "LineString",
          coordinates: [
            [origin.lng, origin.lat],
            [destination.lng, destination.lat],
          ],
        },
        steps: [
          { instruction: "Head toward destination (straight-line estimate)", distanceMeters },
        ],
        isEstimate: true,
      },
    };
  }
}
