import assert from "node:assert/strict";
import { load } from "./helpers/load-typescript.mjs";

let searchResult = { status: "ok", data: [{ label: "Tehran", lat: 35.7, lng: 51.4 }] };
let searchError = null;
let searchCalls = 0;

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

  console.log(`${passed} map geocode route assertions passed.`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
