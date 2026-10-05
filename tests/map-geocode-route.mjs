import assert from "node:assert/strict";
import { load } from "./helpers/load-typescript.mjs";

let searchResult = { status: "ok", data: [{ label: "Tehran", lat: 35.7, lng: 51.4 }] };
let searchError = null;
let searchCalls = 0;

const capabilities = load("lib/map/capabilities.ts");
const resilience = load("lib/map/resilience.ts", { "./capabilities": capabilities });
const geocodingProvider = load("lib/map/geocoding-provider.ts", { "./resilience": resilience });
const { GET } = load("app/api/map/geocode/route.ts", {
  "@/lib/map/adapters/geocoding-nominatim": {
    NominatimGeocodingAdapter: class {
      async search() {
        searchCalls++;
        if (searchError) throw searchError;
        return searchResult;
      }
    },
  },
  "@/lib/map/geocoding-provider": geocodingProvider,
});

function request(query) {
  return GET(new Request(`https://mycar.test/api/map/geocode?q=${encodeURIComponent(query)}`));
}

(async () => {
  let passed = 0;
  const status = async (p, n) => { assert.equal((await p).status, n); passed++; };

  // Too-short queries never reach the adapter (also protects the rate limit).
  await status(request(""), 200);
  const emptyBody = await (await request("")).json();
  assert.deepEqual(emptyBody, { status: "ok", data: [] }); passed++;
  assert.equal(searchCalls, 0); passed++;

  await status(request("a"), 200);
  assert.equal(searchCalls, 0); passed++;

  // A real query reaches the adapter and the result passes through untouched.
  const first = await request("تهران");
  assert.equal(first.status, 200); passed++;
  const firstBody = await first.json();
  assert.deepEqual(firstBody, searchResult); passed++;
  assert.equal(searchCalls, 1); passed++;

  // Immediate second call is throttled (Nominatim policy: ~1 req/sec).
  const second = await request("شیراز");
  assert.equal(second.status, 429); passed++;
  const secondBody = await second.json();
  assert.equal(secondBody.status, "capability_disabled"); passed++;
  assert.equal(searchCalls, 1); passed++; // adapter not called again while throttled

  // An adapter failure (e.g. Nominatim down) degrades to capability_disabled, not a 500.
  searchError = new Error("nominatim_http_503");
  await new Promise((r) => setTimeout(r, 1150)); // clear the throttle window
  const third = await request("اصفهان");
  assert.equal(third.status, 502); passed++;
  const thirdBody = await third.json();
  assert.equal(thirdBody.status, "capability_disabled"); passed++;
  assert.equal(thirdBody.reason.length > 0, true); passed++;

  // Response is never cached (search results shouldn't be stored client-side beyond the session).
  assert.equal(third.headers.get("cache-control"), "no-store"); passed++;

  // --- Phase 3 Part 4: circuit breaker failure isolation -------------------
  // 4 more consecutive failures (5 total, including "third" above) opens
  // the breaker (failureThreshold: 5 in the route). searchCalls so far:
  // 1 success (first) + 1 (third) + 4 (this loop) = 6.
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 1150));
    const r = await request("خطا" + i);
    assert.equal(r.status, 502); passed++;
  }
  assert.equal(searchCalls, 6); passed++;

  // While open, the adapter is never called again -- isolation, not just
  // "still erroring every time."
  await new Promise((r) => setTimeout(r, 1150));
  const openCall = await request("دیگر");
  assert.equal(openCall.status, 502); passed++;
  const openBody = await openCall.json();
  assert.ok(openBody.reason.includes("غیرفعال"), 'circuit-open reason text differs from a generic adapter failure'); passed++;
  assert.equal(searchCalls, 6); passed++; // still 6 -- the breaker short-circuited before calling the adapter

  console.log(`${passed} map geocode route assertions passed.`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
