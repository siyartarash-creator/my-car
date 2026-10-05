// Phase 3, Part 4: the stable MAP_AI_TOOLS surface (lib/map/ai-tools.ts)
// and the offline cache (lib/map/offline.ts). Loads the actual TypeScript
// sources, same pattern as tests/map-routing.mjs.
import assert from 'node:assert/strict';
import { load } from './helpers/load-typescript.mjs';

let passed = 0;
function ok(cond, label) { assert.ok(cond, label); passed++; }

const types = load('lib/map/types.ts');
const geo = load('lib/map/geo.ts');
const capabilities = load('lib/map/capabilities.ts');
const routingAdapterMod = load('lib/map/adapters/routing-straight-line.ts', { '../geo': geo, '../capabilities': capabilities, '../types': types });
const tilesAdapterMod = load('lib/map/adapters/tiles-demo.ts', { '../capabilities': capabilities, '../types': types });
const disabledPortsMod = load('lib/map/adapters/disabled-ports.ts', { '../types': types });
const aiContracts = load('lib/map/ai-contracts.ts', {
  './geo': geo,
  './adapters/routing-straight-line': routingAdapterMod,
  './adapters/tiles-demo': tilesAdapterMod,
  './adapters/disabled-ports': disabledPortsMod,
  './capabilities': capabilities,
  './types': types,
});
const aiTools = load('lib/map/ai-tools.ts', { './ai-contracts': aiContracts });

// --- MAP_AI_TOOLS surface -------------------------------------------------
const EXPECTED_TOOL_NAMES = [
  'get_route', 'find_nearby_services', 'find_services_along_route', 'find_pois',
  'get_route_weather', 'get_traffic_conditions', 'get_truck_restrictions',
  'find_fuel_stations', 'find_safe_stop', 'report_road_condition',
];
const actualNames = Object.keys(aiTools.MAP_AI_TOOLS).sort();
ok(JSON.stringify(actualNames) === JSON.stringify([...EXPECTED_TOOL_NAMES].sort()),
  `MAP_AI_TOOLS exposes exactly the expected tool names (got: ${actualNames.join(', ')})`);
for (const name of EXPECTED_TOOL_NAMES) {
  ok(typeof aiTools.MAP_AI_TOOLS[name] === 'function', `${name} is callable`);
}

// --- get_route: wraps previewRoute, same honest advisory_estimate -------
const tehran = { lat: 35.6997, lng: 51.338 };
const karaj = { lat: 35.8355, lng: 50.9915 };
function fakeClient(rows) {
  return {
    rpc() { return Promise.resolve({ data: null, error: { code: '42883', message: 'undefined_function (fake client)' } }); },
    from() {
      const builder = {
        select() { return builder; }, eq() { return builder; }, gte() { return builder; }, lte() { return builder; },
        single() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
        then(resolve) { resolve({ data: rows, error: null }); },
      };
      return builder;
    },
  };
}
const routeResult = await aiTools.MAP_AI_TOOLS.get_route(fakeClient([]), { origin: tehran, destination: karaj });
ok(routeResult.status === 'ok' && routeResult.data.routingMode === 'advisory_estimate', 'get_route returns the same honest advisory_estimate RoutePreview');

// --- find_nearby_services: userType filter is applied by the tool wrapper ---
const serviceRows = [
  { id: 1, profile_id: 'a', user_type_snapshot: 'service', name_snapshot: 'Garage', city_snapshot: null, region_snapshot: null, lat: tehran.lat, lng: tehran.lng },
  { id: 2, profile_id: 'b', user_type_snapshot: 'rescuer', name_snapshot: 'Tow', city_snapshot: null, region_snapshot: null, lat: tehran.lat, lng: tehran.lng },
];
const allServices = await aiTools.MAP_AI_TOOLS.find_nearby_services(fakeClient(serviceRows), tehran, 5000);
ok(allServices.status === 'ok' && allServices.data.length === 2, 'find_nearby_services with no filter returns both');
const rescuersOnly = await aiTools.MAP_AI_TOOLS.find_nearby_services(fakeClient(serviceRows), tehran, 5000, 'rescuer');
ok(rescuersOnly.status === 'ok' && rescuersOnly.data.length === 1 && rescuersOnly.data[0].userType === 'rescuer',
  'find_nearby_services(userType="rescuer") filters to rescuers only');

// --- get_traffic_conditions / get_route_weather: honest disabled, same as ai-contracts ---
const traffic = await aiTools.MAP_AI_TOOLS.get_traffic_conditions([tehran, karaj]);
ok(traffic.status === 'capability_disabled' && traffic.capability === 'traffic', 'get_traffic_conditions tool reports capability_disabled');
const weather = await aiTools.MAP_AI_TOOLS.get_route_weather([tehran, karaj]);
ok(weather.status === 'capability_disabled' && weather.capability === 'weather', 'get_route_weather tool reports capability_disabled');

// --- get_truck_restrictions: real data, severity computed from truckProfile ---
// Phase 3 audit fix: getTruckRestrictions now filters by true
// haversine distance from center, so the fixture needs real lat/lng.
const restrictionRows = [{ restriction_type: 'height', max_value: 4.0, unit: 'm', note: null, map_features: { lat: tehran.lat, lng: tehran.lng, status: 'verified' } }];
const restrictions = await aiTools.MAP_AI_TOOLS.get_truck_restrictions(fakeClient(restrictionRows), tehran, 5000, { heightM: 4.5 });
ok(restrictions.status === 'ok' && restrictions.data[0].severity === 'exceeds_profile',
  'get_truck_restrictions computes severity from the caller-supplied truckProfile, same logic as previewRoute');

// --- report_road_condition: the one write tool, looks up road_event category, never verifies directly ---
let rpcCalls = [];
const writeClient = {
  rpc(name, args) { rpcCalls.push({ name, args }); return Promise.resolve({ data: 42, error: null }); },
  from(table) {
    const builder = {
      select() { return builder; },
      eq() { return builder; },
      single() {
        if (table === 'map_poi_categories') return Promise.resolve({ data: { id: 9 }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
    };
    return builder;
  },
};
const reportId = await aiTools.MAP_AI_TOOLS.report_road_condition(writeClient, tehran, 'closure', 'high', 'Bridge washed out');
ok(reportId === 42, 'report_road_condition returns the new pending report id');
ok(rpcCalls.length === 1 && rpcCalls[0].name === 'submit_community_report', 'report_road_condition writes through submit_community_report only, never a direct map_features insert');
ok(rpcCalls[0].args.p_category_id === 9 && rpcCalls[0].args.p_event_type === 'closure' && rpcCalls[0].args.p_severity === 'high',
  'report_road_condition resolves the road_event category id and passes through classification');

// --- lib/map/offline.ts: localStorage round-trip, gated by capability ----
const offlineCapabilities = load('lib/map/capabilities.ts');
const offline = load('lib/map/offline.ts', { './capabilities': offlineCapabilities });

// Node has no `window` -- offline.ts must degrade to a no-op, not throw.
ok(offline.getCachedSnapshot('nowhere') === null, 'getCachedSnapshot without a window/localStorage returns null, never throws');
offline.cacheSnapshot('nowhere', { x: 1 }); // must not throw either
ok(true, 'cacheSnapshot without a window/localStorage is a silent no-op');

// Stub a minimal localStorage to prove the actual cache round-trip.
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  },
};
const offlineWithWindow = load('lib/map/offline.ts', { './capabilities': offlineCapabilities });
ok(offlineWithWindow.getCachedSnapshot('area1') === null, 'nothing cached yet for a fresh key');
offlineWithWindow.cacheSnapshot('area1', { services: [], features: [] });
const cached = offlineWithWindow.getCachedSnapshot('area1');
ok(cached !== null && typeof cached.cachedAt === 'string', 'cacheSnapshot/getCachedSnapshot round-trips with a cachedAt timestamp');

offlineCapabilities.CAPABILITY_REGISTRY.offline_cache.enabled = false;
ok(offlineWithWindow.getCachedSnapshot('area1') === null, 'disabling offline_cache capability makes getCachedSnapshot return null even with data present');
offlineCapabilities.CAPABILITY_REGISTRY.offline_cache.enabled = true;

ok(offline.areaCacheKey(35.69972, 51.33801) === offline.areaCacheKey(35.69981, 51.33811),
  'areaCacheKey rounds to 2 decimals so nearby pans hit the same cache entry');

console.log(`${passed} map Phase 3 Part 4 (AI tools + offline cache) assertions passed.`);
