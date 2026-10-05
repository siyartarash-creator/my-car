// Phase 3 Part 4: provider resilience primitives. Kept small and applied
// only where there is a real external dependency to protect -- the
// Nominatim geocoding call (app/api/map/geocode/route.ts) is the only
// live network call anywhere in the Map domain today; every other
// "provider" is a disabled adapter with no network call to fail. A
// circuit breaker around a function that always resolves instantly adds
// nothing, so this isn't wired into the disabled adapters.
import { CAPABILITY_REGISTRY } from "./capabilities";
import type { MapCapability } from "./capabilities";

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

// Wraps a promise-returning call with a hard deadline. A hung upstream
// call (e.g. Nominatim not responding) must not hang this app's own
// request indefinitely -- that's the failure-isolation property: one
// slow/dead provider never blocks the caller forever.
export async function withTimeout<T>(fn: () => Promise<T>, ms: number, label: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new TimeoutError(label, ms)));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export type CircuitState = "closed" | "open" | "half_open";

export type CircuitBreakerOptions = {
  failureThreshold: number; // consecutive failures before opening
  openDurationMs: number; // how long to stay open before trying again (half_open)
};

// Phase 3 audit fix: this now tracks real runtime state (consecutive
// failures, last success/failure timestamps), not just open/closed --
// see getHealth() below. getProviderHealthSnapshot (further down) was
// renamed to getCapabilityConfigurationSnapshot because it only ever
// reported static config, never this kind of live state; CircuitBreaker
// is where genuine runtime health actually lives, for the one real
// provider (geocoding) that has a breaker wired to it.
export type CircuitBreakerHealth = {
  state: CircuitState;
  consecutiveFailures: number;
  lastSuccessAt: string | null; // ISO timestamp
  lastFailureAt: string | null; // ISO timestamp
};

// Minimal consecutive-failure circuit breaker. Not persisted -- resets on
// process restart, same documented tradeoff as the geocode route's
// in-memory rate limiter (acceptable at this project's single-instance
// $0 scale; a scaled deployment would need shared state).
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private openedAt = 0;
  private lastSuccessAt: number | null = null;
  private lastFailureAt: number | null = null;

  constructor(private readonly options: CircuitBreakerOptions) {}

  getState(): CircuitState {
    if (this.state === "open" && Date.now() - this.openedAt >= this.options.openDurationMs) {
      this.state = "half_open";
    }
    return this.state;
  }

  // Real runtime health, not configuration -- reflects what has actually
  // happened to calls through this breaker, not what capabilities.ts says
  // should be true.
  getHealth(): CircuitBreakerHealth {
    return {
      state: this.getState(),
      consecutiveFailures: this.consecutiveFailures,
      lastSuccessAt: this.lastSuccessAt != null ? new Date(this.lastSuccessAt).toISOString() : null,
      lastFailureAt: this.lastFailureAt != null ? new Date(this.lastFailureAt).toISOString() : null,
    };
  }

  // Throws synchronously (before even attempting the call) when the
  // circuit is open -- this is what "failure isolation" means here: a
  // provider in a bad state stops being called at all for a cooldown
  // window, instead of every caller re-discovering the same timeout.
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.getState();
    if (state === "open") {
      throw new Error("circuit_open");
    }
    try {
      const result = await fn();
      this.consecutiveFailures = 0;
      this.state = "closed";
      this.lastSuccessAt = Date.now();
      return result;
    } catch (err) {
      this.consecutiveFailures++;
      this.lastFailureAt = Date.now();
      if (this.consecutiveFailures >= this.options.failureThreshold) {
        this.state = "open";
        this.openedAt = Date.now();
      }
      throw err;
    }
  }
}

export type CapabilityConfiguration = {
  capability: MapCapability;
  enabled: boolean;
  reason: string;
};

// Phase 3 audit fix: renamed from getProviderHealthSnapshot /
// ProviderHealth, which claimed to be "health" while only ever reporting
// the static CAPABILITY_REGISTRY -- enabled/disabled config never
// changes at runtime based on anything actually happening to a provider.
// This is deliberately just configuration, clearly named as such now.
// For the one provider with real runtime health (geocoding, via its
// CircuitBreaker), see app/api/map/geocode/route.ts's exported
// getGeocodeProviderHealth().
export function getCapabilityConfigurationSnapshot(): CapabilityConfiguration[] {
  return (Object.keys(CAPABILITY_REGISTRY) as MapCapability[]).map((capability) => ({
    capability,
    enabled: CAPABILITY_REGISTRY[capability].enabled,
    reason: CAPABILITY_REGISTRY[capability].reason,
  }));
}
