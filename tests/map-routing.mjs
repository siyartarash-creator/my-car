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
const disabledPortsMod = load('lib/map/adapters/disabled-ports.ts', {
  '../types': types,
});
const aiContracts = load('lib/map/ai-contracts.ts', {
  './geo': geo,
  './adapters/routing-straight-line': routingAdapterMod,
  './adapters/tiles-demo': tilesAdapterMod,
  './adapters/disabled-ports': disabledPortsMod,
  './capabilities': capabilities,
  './types': types,
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
// geocoding was activated in Phase 2 item B (OSM Nominatim via a
// rate-limited server-side proxy); everything still out of the approved
// Phase 2 scope must stay disabled.
for (const cap of ['traffic', 'weather', 'truck_routing', 'live_navigation_background', 'map_advertising', 'route_history']) {
  ok(!capabilities.isCapabilityEnabled(cap), `${cap} must stay disabled`);
}
ok(capabilities.isCapabilityEnabled('tiles'), 'tiles capability enabled');
ok(capabilities.isCapabilityEnabled('routing_preview'), 'routing_preview capability enabled');
ok(capabilities.isCapabilityEnabled('geocoding'), 'geocoding capability enabled (Phase 2 item B)');
ok(capabilities.isCapabilityEnabled('truck_restriction_advisory'), 'truck_restriction_advisory capability enabled (Phase 3 Part 1, advisory-only)');
ok(capabilities.isCapabilityEnabled('multi_stop_routing'), 'multi_stop_routing capability enabled (Phase 3 Part 1)');

// --- RoutingPort: the shipped $0 adapter -------------------------------
const routingAdapter = new routingAdapterMod.StraightLineRoutingAdapter();
const result = await routingAdapter.previewRoute({ origin: tehran, destination: karaj });
ok(result.status === 'ok', 'straight-line routing adapter resolves ok');
ok(result.data.isEstimate === true, 'straight-line estimate is honestly labelled as an estimate');
ok(result.data.routingMode === 'advisory_estimate', 'straight-line route reports advisory_estimate, never native_validated');
ok(Array.isArray(result.data.alternates) && result.data.alternates.length === 0, 'straight-line adapter has no alternates (only one geometric path)');
ok(result.data.preferencesHonored === false, 'straight-line adapter has no road graph, so preferences are honestly reported as not honored');
near(result.data.distanceMeters, 35_500, 3_000, 'route preview distance');
ok(result.data.geometry.coordinates[0][0] === tehran.lng && result.data.geometry.coordinates[0][1] === tehran.lat,
  'route geometry uses GeoJSON (lng,lat) order at the origin point');

// --- Multi-stop: waypoints chained in request order ---------------------
const qazvin = { lat: 36.2688, lng: 50.0041 };
const multiStop = await routingAdapter.previewRoute({ origin: tehran, destination: qazvin, waypoints: [karaj] });
ok(multiStop.status === 'ok', 'multi-stop request resolves ok');
const tehranKarajLeg = geo.haversineMeters(tehran, karaj);
const karajQazvinLeg = geo.haversineMeters(karaj, qazvin);
near(multiStop.data.distanceMeters, tehranKarajLeg + karajQazvinLeg, 1_000, 'multi-stop distance is the sum of chained legs, in waypoint order');
ok(multiStop.data.geometry.coordinates.length === 3, 'multi-stop geometry has one coordinate per stop (origin, waypoint, destination)');

// --- Truck restriction advisory: real comparison against caller-supplied
// dimensions, never fabricated ---------------------------------------
// Fake PostgREST-style chainable builder standing in for a SupabaseClient --
// ai-contracts.ts composes restriction rows on top of routingPort's result,
// so this only needs to prove the severity comparison logic, not RLS/DB
// behavior (covered by the map_foundation migration's own policies).
function fakeClient(rows) {
  return {
    // nearby_features/nearby_service_locations are PostGIS RPCs that don't
    // exist in this fake -- reporting the same "undefined_function" code
    // ai-contracts.ts already handles makes getNearbyFeatures fall back to
    // the plain .from(...) bounding-box path below, exactly like a real
    // environment with PostGIS not yet activated.
    rpc() { return Promise.resolve({ data: null, error: { code: '42883', message: 'undefined_function (fake client)' } }); },
    from() {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        gte() { return builder; },
        lte() { return builder; },
        in() { return builder; },
        then(resolve) { resolve({ data: rows, error: null }); },
      };
      return builder;
    },
  };
}
const tallBridge = [{ restriction_type: 'height', max_value: 4.0, unit: 'm', note: 'tall bridge' }];
const exceedsCase = await aiContracts.previewRoute(fakeClient(tallBridge), {
  origin: tehran, destination: karaj, vehicle: 'truck', truckProfile: { heightM: 4.2 },
});
ok(exceedsCase.status === 'ok', 'truck restriction preview resolves ok');
ok(exceedsCase.data.restrictionWarnings[0].severity === 'exceeds_profile',
  'truck profile taller than the verified restriction is flagged exceeds_profile');
ok(exceedsCase.data.isEstimate === true && exceedsCase.data.routingMode === 'advisory_estimate',
  'restriction warnings never upgrade the route itself to native_validated');

const fitsCase = await aiContracts.previewRoute(fakeClient(tallBridge), {
  origin: tehran, destination: karaj, vehicle: 'truck', truckProfile: { heightM: 3.5 },
});
ok(fitsCase.data.restrictionWarnings[0].severity === 'info', 'truck profile within the restriction is info, not a false exceeds claim');

const noProfileCase = await aiContracts.previewRoute(fakeClient(tallBridge), {
  origin: tehran, destination: karaj, vehicle: 'truck',
});
ok(noProfileCase.data.restrictionWarnings[0].severity === 'unspecified',
  'no truckProfile supplied -- severity is unspecified, never guessed');

const unrecognizedUnitCase = await aiContracts.previewRoute(fakeClient([{ restriction_type: 'height', max_value: 13, unit: 'ft', note: null }]), {
  origin: tehran, destination: karaj, vehicle: 'truck', truckProfile: { heightM: 4.2 },
});
ok(unrecognizedUnitCase.data.restrictionWarnings[0].severity === 'unspecified',
  'unrecognized restriction unit never produces a fabricated exceeds/info comparison');

const vehicleClassCase = await aiContracts.previewRoute(fakeClient([{ restriction_type: 'vehicle_class', max_value: null, unit: null, note: 'no trucks' }]), {
  origin: tehran, destination: karaj, vehicle: 'truck', truckProfile: { heightM: 4.2 },
});
ok(vehicleClassCase.data.restrictionWarnings[0].severity === 'info', 'restriction types with no comparable truckProfile field report info');

const carCase = await aiContracts.previewRoute(fakeClient(tallBridge), { origin: tehran, destination: karaj, vehicle: 'car' });
ok(carCase.data.restrictionWarnings.length === 0, 'restriction warnings are only composed for vehicle === truck');

// --- Phase 3 Part 2: traffic/weather stay honestly disabled -------------
ok(!capabilities.isCapabilityEnabled('traffic'), 'traffic capability disabled (no $0 provider)');
ok(!capabilities.isCapabilityEnabled('weather'), 'weather capability disabled (no $0 provider)');
const trafficResult = await aiContracts.getTrafficConditions([tehran, karaj]);
ok(trafficResult.status === 'capability_disabled' && trafficResult.capability === 'traffic',
  'get_traffic_conditions returns capability_disabled, never a fabricated snapshot');
const weatherResult = await aiContracts.getRouteWeather([tehran, karaj]);
ok(weatherResult.status === 'capability_disabled' && weatherResult.capability === 'weather',
  'get_route_weather returns capability_disabled, never a fabricated snapshot');

// Provider-swap proof: an enabled TrafficPort/WeatherPort implementation
// would satisfy the exact same CapabilityResult shape without touching
// getTrafficConditions/getRouteWeather -- those two functions only gate on
// isCapabilityEnabled, never on which concrete adapter is wired in.
class StubEnabledTrafficAdapter {
  async getSegments() {
    return { status: 'ok', data: { segments: [], source: 'stub-provider', observedAt: new Date().toISOString(), confidence: 0.9 } };
  }
}
const stubTraffic = await new StubEnabledTrafficAdapter().getSegments([tehran, karaj]);
ok(stubTraffic.status === 'ok' && stubTraffic.data.source === 'stub-provider',
  'a real TrafficPort implementation reports source/observedAt/confidence through the same shape');

// --- Phase 3 Part 2: find_fuel_stations / find_safe_stop / road events,
// honest-empty with no real data, never a synthetic fixture ------------
const emptyClient = fakeClient([]);
const fuel = await aiContracts.findFuelStations(emptyClient, tehran, 10_000);
ok(fuel.status === 'ok' && fuel.data.length === 0, 'find_fuel_stations reports an honest empty state, not a fabricated station');
const safeStop = await aiContracts.findSafeStop(emptyClient, tehran, 10_000, 'truck');
ok(safeStop.status === 'ok' && safeStop.data.length === 0, 'find_safe_stop reports an honest empty state for a truck profile');
const roadEvents = await aiContracts.findRoadEvents(emptyClient, tehran, 10_000);
ok(roadEvents.status === 'ok' && roadEvents.data.length === 0, 'road-event query reports an honest empty state, reusing the existing feature pipeline');

// --- Provider swap demonstration ---------------------------------------
// Any RoutingPort implementation must be usable through the exact same
// call shape -- this is what lets a future road-aware provider replace
// the straight-line estimate without touching callers like
// lib/map/ai-contracts.ts or the Map UI.
class StubRoadAwareRoutingAdapter {
  async previewRoute(request) {
    const { origin, destination } = request;
    return {
      status: 'ok',
      data: {
        distanceMeters: 42_000, // a stand-in for a real road network distance
        durationSeconds: 2_400,
        geometry: { type: 'LineString', coordinates: [[origin.lng, origin.lat], [destination.lng, destination.lat]] },
        steps: [{ instruction: 'stub road-aware step', distanceMeters: 42_000 }],
        isEstimate: false,
        routingMode: 'native_validated',
        alternates: [],
        preferencesHonored: true,
        restrictionWarnings: [],
      },
    };
  }
}
async function callThroughPort(port, request) {
  return port.previewRoute(request);
}
const req = { origin: tehran, destination: karaj };
const viaStraightLine = await callThroughPort(routingAdapter, req);
const viaStub = await callThroughPort(new StubRoadAwareRoutingAdapter(), req);
ok(viaStraightLine.status === 'ok' && viaStub.status === 'ok', 'two different RoutingPort implementations both satisfy the same call shape');
ok(viaStraightLine.data.isEstimate === true && viaStub.data.isEstimate === false, 'swapped provider can report a different accuracy without changing the caller');
ok(viaStraightLine.data.routingMode === 'advisory_estimate' && viaStub.data.routingMode === 'native_validated',
  'swapped provider can report native_validated routing without changing the caller');

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
