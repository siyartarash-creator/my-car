// Phase 1, Part 4 hardening: spatial regression + a real provider-swap
// demonstration. Loads the actual lib/map TypeScript sources (not a
// reimplementation) via tests/helpers/load-typescript.mjs, the same
// pattern tests/write-boundary.mjs uses for route handlers.
import assert from 'node:assert/strict';
import { load } from './helpers/load-typescript.mjs';

let passed = 0;
function ok(cond, label) { assert.ok(cond, label); passed++; }
function near(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} not within ${tolerance} of ${expected}`);
  passed++;
}

const types = load('lib/map/types.ts');
const geo = load('lib/map/geo.ts');
const capabilities = load('lib/map/capabilities.ts');
const routingAdapterMod = load('lib/map/adapters/routing-straight-line.ts', {
  '../geo': geo,
  '../capabilities': capabilities,
  '../types': types,
});
const tilesAdapterMod = load('lib/map/adapters/tiles-demo.ts', {
  '../capabilities': capabilities,
  '../types': types,
});

// --- Spatial regression -----------------------------------------------
const tehran = { lat: 35.6997, lng: 51.338 };
const karaj = { lat: 35.8355, lng: 50.9915 };
near(geo.haversineMeters(tehran, tehran), 0, 1, 'distance to self');
near(geo.haversineMeters(tehran, karaj), 35_500, 3_000, 'Tehran-Karaj great-circle distance');
ok(geo.isValidLatLng({ lat: 35, lng: 51 }), 'valid coordinate accepted');
ok(!geo.isValidLatLng({ lat: 999, lng: 51 }), 'out-of-range latitude rejected');

const box = geo.boundingBox(tehran, 10_000);
ok(box.minLat < tehran.lat && tehran.lat < box.maxLat, 'bounding box contains its own center (lat)');
ok(box.minLng < tehran.lng && tehran.lng < box.maxLng, 'bounding box contains its own center (lng)');

// --- Capability registry regression: nothing out-of-scope silently enabled ---
for (const cap of ['geocoding', 'traffic', 'weather', 'truck_routing', 'live_navigation']) {
  ok(!capabilities.isCapabilityEnabled(cap), `${cap} must stay disabled in Phase 1`);
}
ok(capabilities.isCapabilityEnabled('tiles'), 'tiles capability enabled');
ok(capabilities.isCapabilityEnabled('routing_preview'), 'routing_preview capability enabled');

// --- RoutingPort: the shipped $0 adapter -------------------------------
const routingAdapter = new routingAdapterMod.StraightLineRoutingAdapter();
const result = await routingAdapter.previewRoute(tehran, karaj);
ok(result.status === 'ok', 'straight-line routing adapter resolves ok');
ok(result.data.isEstimate === true, 'straight-line estimate is honestly labelled as an estimate');
near(result.data.distanceMeters, 35_500, 3_000, 'route preview distance');
ok(result.data.geometry.coordinates[0][0] === tehran.lng && result.data.geometry.coordinates[0][1] === tehran.lat,
  'route geometry uses GeoJSON (lng,lat) order at the origin point');

// --- Provider swap demonstration ---------------------------------------
// Any RoutingPort implementation must be usable through the exact same
// call shape -- this is what lets a future road-aware provider replace
// the straight-line estimate without touching callers like
// lib/map/ai-contracts.ts or the Map UI.
class StubRoadAwareRoutingAdapter {
  async previewRoute(origin, destination) {
    return {
      status: 'ok',
      data: {
        distanceMeters: 42_000, // a stand-in for a real road network distance
        durationSeconds: 2_400,
        geometry: { type: 'LineString', coordinates: [[origin.lng, origin.lat], [destination.lng, destination.lat]] },
        steps: [{ instruction: 'stub road-aware step', distanceMeters: 42_000 }],
        isEstimate: false,
      },
    };
  }
}
async function callThroughPort(port, origin, destination) {
  return port.previewRoute(origin, destination);
}
const viaStraightLine = await callThroughPort(routingAdapter, tehran, karaj);
const viaStub = await callThroughPort(new StubRoadAwareRoutingAdapter(), tehran, karaj);
ok(viaStraightLine.status === 'ok' && viaStub.status === 'ok', 'two different RoutingPort implementations both satisfy the same call shape');
ok(viaStraightLine.data.isEstimate === true && viaStub.data.isEstimate === false, 'swapped provider can report a different accuracy without changing the caller');

// --- TilesPort: same swap guarantee -------------------------------------
const tilesAdapter = new tilesAdapterMod.DemoTilesAdapter();
const style = tilesAdapter.getStyle();
ok(style.status === 'ok' && typeof style.data.styleUrl === 'string', 'tiles adapter returns a style URL, not a provider payload');
class StubAlternateTilesAdapter {
  getStyle() { return { status: 'ok', data: { styleUrl: 'https://example.invalid/style.json', attribution: 'Stub' } }; }
}
const altStyle = new StubAlternateTilesAdapter().getStyle();
ok(altStyle.status === 'ok' && altStyle.data.styleUrl !== style.data.styleUrl, 'a second TilesPort implementation is swappable through the same interface');

console.log(`${passed} map routing/provider-swap (Phase 1, Part 4) assertions passed.`);
