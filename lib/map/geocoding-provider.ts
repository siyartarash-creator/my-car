// The shared CircuitBreaker instance for the one real external call in
// the Map domain (Nominatim geocoding). Lives in its own module, not
// inside app/api/map/geocode/route.ts, so its real runtime health
// (CircuitBreakerHealth) can be imported and read from server code other
// than that one route -- a route.ts file's exports are constrained to
// HTTP method handlers by the Next.js App Router, so a second export
// there for health reporting would be the wrong place for it.
import { CircuitBreaker } from "./resilience";
import type { CircuitBreakerHealth } from "./resilience";

// Failure isolation: after 5 consecutive Nominatim failures (including
// the adapter's own AbortSignal timeout), stop calling it for 30s rather
// than letting every search request re-discover the same timeout one at
// a time. In-memory, single-instance only -- same documented tradeoff as
// the geocode route's rate-limit throttle.
export const geocodeBreaker = new CircuitBreaker({ failureThreshold: 5, openDurationMs: 30_000 });

export function getGeocodeProviderHealth(): CircuitBreakerHealth {
  return geocodeBreaker.getHealth();
}
