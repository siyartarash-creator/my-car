import { disabled } from "../types";
import type { LatLng } from "../types";
import type { AdPort, AdTargeting, GeocodingPort, TrafficPort, WeatherPort } from "../ports";

// Structural placeholders for ports with no $0 provider activated yet.
// They exist so capability_disabled is a real, typed response instead of
// a missing feature -- the UI and AI contracts can rely on every port
// always resolving, never throwing "not implemented". Parameters are
// declared (even though unused) so each class's own method signature
// stays structurally identical to its Port interface -- callers typed as
// the concrete class, not the interface, would otherwise see the narrower
// zero-arg signature TypeScript infers from an empty parameter list.
export class DisabledGeocodingAdapter implements GeocodingPort {
  async search(_query: string) {
    return disabled<never[]>("geocoding", "No $0 geocoding provider activated in Phase 1");
  }
}

export class DisabledTrafficAdapter implements TrafficPort {
  async getSegments(_bbox: [LatLng, LatLng]) {
    return disabled<never>("traffic", "No legal, approved $0 live traffic provider is activated");
  }
}

export class DisabledWeatherAdapter implements WeatherPort {
  async getCurrent(_point: LatLng) {
    return disabled<never>("weather", "No legal, commercially-usable $0 weather provider is activated yet");
  }
  async getAlongRoute(_points: LatLng[]) {
    return disabled<never>("weather", "No legal, commercially-usable $0 weather provider is activated yet");
  }
}

export class DisabledAdAdapter implements AdPort {
  async getAdsForTargeting(_targeting: AdTargeting) {
    return disabled<never>("map_advertising", "No registered-business commercial/ad-purchase backend exists yet (Store/Services domain dependency)");
  }
}
