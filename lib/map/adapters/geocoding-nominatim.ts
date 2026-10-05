import "server-only";
import { isCapabilityEnabled } from "../capabilities";
import { disabled } from "../types";
import type { CapabilityResult } from "../types";
import type { GeocodeResult, GeocodingPort } from "../ports";

// Failure isolation: a hung or dead Nominatim must not hang this app's
// own request indefinitely. AbortSignal.timeout() both races the fetch
// AND actually aborts the underlying connection on expiry (unlike racing
// a bare timer promise, which would leave the fetch running in the
// background) -- see lib/map/resilience.ts for the non-fetch equivalent
// (withTimeout) used where there's no AbortSignal-aware call to pass it to.
const NOMINATIM_TIMEOUT_MS = 5_000;

// $0 provider: OSM Nominatim's public search API. This adapter is
// server-only -- Nominatim's usage policy requires a descriptive
// User-Agent identifying the application, and browsers refuse to let JS
// override that header (it's on the Fetch spec's forbidden-header list),
// so this can only run from app/api/map/geocode/route.ts, never imported
// into the Map UI directly. That route also owns the policy's "max ~1
// request/sec" throttling -- this adapter itself makes exactly one request
// per call and leaves rate limiting to its caller.
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
// Concrete, identifying server-side User-Agent per Nominatim's usage
// policy (https://operations.osmfoundation.org/policies/nominatim/):
// application name/version + a URL that identifies the operator/project.
const USER_AGENT = "MyCarMap/1.0 (+https://github.com/siyartarash-creator/my-car)";

type NominatimRow = { display_name: string; lat: string; lon: string };

export class NominatimGeocodingAdapter implements GeocodingPort {
  async search(query: string): Promise<CapabilityResult<GeocodeResult[]>> {
    if (!isCapabilityEnabled("geocoding")) return disabled("geocoding", "Geocoding capability is disabled");
    const trimmed = query.trim();
    if (trimmed.length < 2 || trimmed.length > 200) return { status: "ok", data: [] };

    const url = new URL(NOMINATIM_SEARCH_URL);
    url.searchParams.set("q", trimmed);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "5");
    url.searchParams.set("accept-language", "fa");
    // Biases results toward Iran (Phase 1's Iran-focused experience) without
    // hard-excluding other countries -- Nominatim's countrycodes filter
    // only restricts when the query itself doesn't strongly imply elsewhere.
    url.searchParams.set("countrycodes", "ir");

    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(NOMINATIM_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`nominatim_http_${res.status}`);
    const rows = (await res.json()) as NominatimRow[];
    return {
      status: "ok",
      data: rows.map((row) => ({ label: row.display_name, lat: Number(row.lat), lng: Number(row.lon) })),
    };
  }
}
