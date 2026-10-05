// Phase 3, Part 3: foreground live navigation (lib/map/navigation.ts +
// geo.routeProgress) and the two Part 3 AI contracts that don't need a
// real DB round-trip to prove their contract shape (findServicesAlongRoute
// honest-empty, getMapAds honest-disabled). Loads the actual TypeScript
// sources, same pattern as tests/map-routing.mjs.
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

// --- geo.routeProgress ---------------------------------------------------
const a = { lat: 35.70, lng: 51.40 };
const b = { lat: 35.70, lng: 51.42 }; // ~1.8km east of a at this latitude
const path = [a, b];
const totalLen = geo.haversineMeters(a, b);

const atStart = geo.routeProgress(a, path);
near(atStart.distanceTraveledMeters, 0, 5, 'routeProgress at the start point: ~0 traveled');
near(atStart.crossTrackMeters, 0, 5, 'routeProgress exactly on the path: ~0 cross-track');

const midpoint = { lat: a.lat, lng: (a.lng + b.lng) / 2 };
const atMid = geo.routeProgress(midpoint, path);
near(atMid.distanceTraveledMeters, totalLen / 2, 10, 'routeProgress at the midpoint: ~half traveled');
near(atMid.distanceRemainingMeters, totalLen / 2, 10, 'routeProgress at the midpoint: ~half remaining');
ok(atMid.crossTrackMeters < 5, 'routeProgress on the path: negligible cross-track');

// A point offset north of the midpoint by roughly 150m should show up as
// cross-track distance, not as extra progress along the path.
const offsetMeters = 150;
const latDelta = offsetMeters / 111_320;
const offPath = { lat: midpoint.lat + latDelta, lng: midpoint.lng };
const atOffset = geo.routeProgress(offPath, path);
near(atOffset.crossTrackMeters, offsetMeters, 20, 'routeProgress off to the side: cross-track reflects the offset');
near(atOffset.distanceTraveledMeters, totalLen / 2, 20, 'routeProgress off to the side: along-path progress still ~midpoint');

const beforeStart = { lat: a.lat, lng: a.lng - 0.01 };
const atBefore = geo.routeProgress(beforeStart, path);
near(atBefore.distanceTraveledMeters, 0, 5, 'routeProgress before the segment clamps to the start (t=0), never negative');

// --- lib/map/navigation.ts: a fake browser Geolocation ------------------
// NavigationSession is written against the DOM Geolocation API (watchPosition/
// clearWatch/getCurrentPosition-shaped callbacks) -- stubbing `navigator`
// here proves the state machine itself without a real browser.
let watchCallbacks = null;
let clearedWatchId = null;
// Node 22 ships a read-only built-in `navigator` global (Web-API
// compatibility) -- plain assignment throws "only a getter"; redefining
// the property is required to stub it for this test.
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    geolocation: {
      watchPosition(onSuccess, onError) {
        watchCallbacks = { onSuccess, onError };
        return 42;
      },
      clearWatch(id) { clearedWatchId = id; },
    },
  },
});

const navigation = load('lib/map/navigation.ts', {
  './geo': geo,
  './capabilities': capabilities,
});

function fakePosition(lat, lng, accuracy) {
  return { coords: { latitude: lat, longitude: lng, accuracy } };
}

const route = {
  distanceMeters: totalLen,
  durationSeconds: 100,
  geometry: { type: 'LineString', coordinates: [[a.lng, a.lat], [b.lng, b.lat]] },
  steps: [],
  isEstimate: true,
  routingMode: 'advisory_estimate',
  alternates: [],
  preferencesHonored: false,
  restrictionWarnings: [],
};

let lastState = null;
const session = new navigation.NavigationSession(route, (s) => { lastState = s; });
ok(session.getState().status === 'idle', 'NavigationSession starts idle before start() is called');
ok(session.getState().distanceRemainingMeters === totalLen, 'NavigationSession initial distanceRemaining comes from the RoutePreview, not recomputed');

session.start();
ok(watchCallbacks !== null, 'start() calls navigator.geolocation.watchPosition');

// On-route update.
watchCallbacks.onSuccess(fakePosition(a.lat, a.lng, 15));
ok(lastState.status === 'active', 'on-route position reports status active');
ok(lastState.permission === 'granted', 'a successful fix reports permission granted');
ok(lastState.degradedGps === false, 'a 15m-accuracy fix is not degraded (threshold is 100m)');

// Degraded GPS.
watchCallbacks.onSuccess(fakePosition(a.lat, a.lng, 250));
ok(lastState.degradedGps === true, 'a 250m-accuracy fix is reported as degraded GPS');

// Off-route: push the position far to the side of the path.
const farOffsetMeters = 500;
const farLatDelta = farOffsetMeters / 111_320;
watchCallbacks.onSuccess(fakePosition(midpoint.lat + farLatDelta, midpoint.lng, 10));
ok(lastState.status === 'off_route', 'a position 500m off the path is reported as off_route');
ok(lastState.needsReroute === true, 'off-route sets needsReroute, as a signal for the caller to request a fresh previewRoute()');

// Arrival.
watchCallbacks.onSuccess(fakePosition(b.lat, b.lng, 10));
ok(lastState.status === 'arrived', 'a position at the destination is reported as arrived');

// Safe-failure contract: permission denied, position unavailable, timeout --
// every one sets status "error" with a distinct message, never throws.
watchCallbacks.onError({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
ok(lastState.status === 'error' && lastState.permission === 'denied', 'PERMISSION_DENIED sets status error and permission denied');
watchCallbacks.onError({ code: 2, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
ok(lastState.status === 'error' && typeof lastState.errorMessage === 'string', 'POSITION_UNAVAILABLE sets status error with a message, never throws');

session.stop();
ok(clearedWatchId === 42, 'stop() calls navigator.geolocation.clearWatch with the exact watch id from start()');

// Disabled capability: start() must set an error state, never silently stay idle.
capabilities.CAPABILITY_REGISTRY.live_navigation_foreground.enabled = false;
let disabledState = null;
const disabledSession = new navigation.NavigationSession(route, (s) => { disabledState = s; });
disabledSession.start();
ok(disabledState.status === 'error', 'start() with live_navigation_foreground disabled reports an error state, not silent idle');
capabilities.CAPABILITY_REGISTRY.live_navigation_foreground.enabled = true; // restore for any later test in this process

// --- findServicesAlongRoute / getMapAds: honest-empty / honest-disabled ---
const routingAdapterMod = load('lib/map/adapters/routing-straight-line.ts', {
  '../geo': geo, '../capabilities': capabilities, '../types': types,
});
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

function fakeClient(rows) {
  return {
    rpc() { return Promise.resolve({ data: null, error: { code: '42883', message: 'undefined_function (fake client)' } }); },
    from() {
      const builder = {
        select() { return builder; }, eq() { return builder; }, gte() { return builder; }, lte() { return builder; },
        then(resolve) { resolve({ data: rows, error: null }); },
      };
      return builder;
    },
  };
}

const alongRoute = await aiContracts.findServicesAlongRoute(fakeClient([]), [a, b], 5_000);
ok(alongRoute.status === 'ok' && alongRoute.data.length === 0, 'findServicesAlongRoute reports an honest empty state, not a fabricated service');

ok(!capabilities.isCapabilityEnabled('map_advertising'), 'map_advertising capability stays disabled');
const ads = await aiContracts.getMapAds({ center: a });
ok(ads.status === 'capability_disabled' && ads.capability === 'map_advertising',
  'getMapAds returns capability_disabled -- Map-side contract exists, no placeholder/fake ad is ever served');

console.log(`${passed} map Phase 3 Part 3 (navigation + service network + ads contract) assertions passed.`);
