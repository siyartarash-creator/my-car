import { disabled } from "../types";
import type { GeocodingPort, TrafficPort, WeatherPort } from "../ports";

// Structural placeholders for ports with no $0 provider activated yet.
// They exist so capability_disabled is a real, typed response instead of
// a missing feature -- the UI and AI contracts can rely on every port
// always resolving, never throwing "not implemented".
export class DisabledGeocodingAdapter implements GeocodingPort {
  async search() {
    return disabled<never[]>("geocoding", "No $0 geocoding provider activated in Phase 1");
  }
}

export class DisabledTrafficAdapter implements TrafficPort {
  async getSegments() {
    return disabled<never[]>("traffic", "Live traffic is out of Phase 1 scope");
  }
}

export class DisabledWeatherAdapter implements WeatherPort {
  async getCurrent() {
    return disabled<never>("weather", "Route/destination weather is out of Phase 1 scope");
  }
}
