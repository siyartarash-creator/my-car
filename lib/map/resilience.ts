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

// Minimal consecutive-failure circuit breaker. Not persisted -- resets on
// process restart, same documented tradeoff as the geocode route's
// in-memory rate limiter (acceptable at this project's single-instance
// $0 scale; a scaled deployment would need shared state).
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(private readonly options: CircuitBreakerOptions) {}

  getState(): CircuitState {
    if (this.state === "open" && Date.now() - this.openedAt >= this.options.openDurationMs) {
      this.state = "half_open";
    }
    return this.state;
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
      return result;
    } catch (err) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= this.options.failureThreshold) {
        this.state = "open";
        this.openedAt = Date.now();
      }
      throw err;
    }
  }
}

export type ProviderHealth = {
  capability: MapCapability;
  enabled: boolean;
  reason: string;
};

// Observability snapshot: every Map capability's current enabled/disabled
// state and why, in one call -- the quota/budget-observability surface
// Part 4 asks for. There is no usage metering here because there is no
// metered provider yet (every live capability is $0, no quota to track);
// this is the hook a real paid provider's usage/budget numbers would
// attach to without changing this function's shape.
export function getProviderHealthSnapshot(): ProviderHealth[] {
  return (Object.keys(CAPABILITY_REGISTRY) as MapCapability[]).map((capability) => ({
    capability,
    enabled: CAPABILITY_REGISTRY[capability].enabled,
    reason: CAPABILITY_REGISTRY[capability].reason,
  }));
}
