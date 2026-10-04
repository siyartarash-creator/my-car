// Phase 3 independent audit corrective patch: item 1 (truck advisory
// spatial correctness) and item 2 (road-event classification honesty).
// Items 3/6/9 (retention, atomic rate limits, RLS perf) are covered by
// tests/map-phase3-audit-corrective-db.mjs (PGlite, needs real migrations).
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

// ===========================================================================
// Item 1: truck advisory spatial correctness
// ===========================================================================

// --- expandedRouteBoundingBox: never degenerates to zero width/height ----
const horizontalPath = [{ lat: 35.70, lng: 51.40 }, { lat: 35.70, lng: 51.42 }];
const hBox = geo.expandedRouteBoundingBox(horizontalPath, 500);
ok(hBox.maxLat > hBox.minLat, 'horizontal route: padded box has real latitude height, not zero');

const verticalPath = [{ lat: 35.70, lng: 51.40 }, { lat: 35.72, lng: 51.40 }];
const vBox = geo.expandedRouteBoundingBox(verticalPath, 500);
ok(vBox.maxLng > vBox.minLng, 'vertical route: padded box has real longitude width, not zero');

const diagonalPath = [{ lat: 35.70, lng: 51.40 }, { lat: 35.71, lng: 51.41 }];
const dBox = geo.expandedRouteBoundingBox(diagonalPath, 500);
ok(dBox.maxLat > dBox.minLat && dBox.maxLng > dBox.minLng, 'diagonal route: padded box has real extent in both dimensions');

// --- routeProgress.crossTrackMeters: the true distance filter ------------
// Diagonal route: a point at the box's empty corner is far from the
// actual diagonal line, even though it sits inside a naive bounding box.
const diagCorner = { lat: 35.70, lng: 51.41 }; // opposite corner from the diagonal
const diagNear = { lat: 35.705, lng: 51.405 }; // roughly on the line
const diagCrossTrackCorner = geo.routeProgress(diagCorner, diagonalPath).crossTrackMeters;
const diagCrossTrackNear = geo.routeProgress(diagNear, diagonalPath).crossTrackMeters;
ok(diagCrossTrackCorner > 500, `diagonal route: box-corner point is >500m from the actual line (got ${diagCrossTrackCorner.toFixed(0)}m) -- would be a false positive without this filter`);
ok(diagCrossTrackNear < 500, `diagonal route: a point near the line is <500m away (got ${diagCrossTrackNear.toFixed(0)}m)`);

// Horizontal route: a point slightly off to the side (not north/south of
// the two endpoints, so a raw unpadded bbox would have zero height and
// miss it entirely).
const hNear = { lat: 35.7015, lng: 51.41 }; // ~167m north of the line
const hCrossTrack = geo.routeProgress(hNear, horizontalPath).crossTrackMeters;
near(hCrossTrack, 167, 30, 'horizontal route: a point ~167m to the side has matching cross-track distance');
ok(hCrossTrack < 500, 'horizontal route: that point is within the 500m corridor -- a raw zero-height bbox would have falsely excluded it');

// Vertical route: same property, perpendicular axis.
const vNear = { lat: 35.71, lng: 51.4015 }; // ~140m east of the line
const vCrossTrack = geo.routeProgress(vNear, verticalPath).crossTrackMeters;
ok(vCrossTrack < 500, 'vertical route: a point to the side is within the 500m corridor -- a raw zero-width bbox would have falsely excluded it');

// --- Integration: getRestrictionWarnings only keeps true-corridor rows ---
// Fake client simulating an over-inclusive SQL bbox prefilter (returns
// every candidate regardless of exact position) -- proves the JS-side
// crossTrack filter, not the SQL query, is what actually enforces
// correctness here.
function fakeRestrictionClient(rows) {
  return {
    from() {
      const builder = {
        select() { return builder; }, eq() { return builder; },
        gte() { return builder; }, lte() { return builder; },
        then(resolve) { resolve({ data: rows, error: null }); },
      };
      return builder;
    },
  };
}
function restrictionRow(point, note) {
  return { restriction_type: 'height', max_value: 4.0, unit: 'm', note, map_features: { lat: point.lat, lng: point.lng, status: 'verified' } };
}

const diagonalCandidates = [
  restrictionRow(diagNear, 'near-route'),
  restrictionRow(diagCorner, 'box-corner-false-positive'),
  restrictionRow({ lat: 36.5, lng: 52.5 }, 'far-outside-corridor-and-box'),
];
const diagonalResult = await aiContracts.previewRoute(fakeRestrictionClient(diagonalCandidates), {
  origin: diagonalPath[0], destination: diagonalPath[1], vehicle: 'truck', truckProfile: { heightM: 4.5 },
});
const diagonalNotes = diagonalResult.data.restrictionWarnings.map((w) => w.note).sort();
ok(JSON.stringify(diagonalNotes) === JSON.stringify(['near-route']),
  `diagonal route keeps only the near-route restriction, excludes the box-corner and far ones (got: ${diagonalNotes.join(', ')})`);

const horizontalCandidates = [restrictionRow(hNear, 'near-route-horizontal'), restrictionRow({ lat: 35.9, lng: 51.4 }, 'far')];
const horizontalResult = await aiContracts.previewRoute(fakeRestrictionClient(horizontalCandidates), {
  origin: horizontalPath[0], destination: horizontalPath[1], vehicle: 'truck', truckProfile: { heightM: 4.5 },
});
ok(horizontalResult.data.restrictionWarnings.length === 1 && horizontalResult.data.restrictionWarnings[0].note === 'near-route-horizontal',
  'horizontal route: the off-to-the-side-but-near restriction is included, the far one excluded');

const verticalCandidates = [restrictionRow(vNear, 'near-route-vertical'), restrictionRow({ lat: 35.71, lng: 51.6 }, 'far')];
const verticalResult = await aiContracts.previewRoute(fakeRestrictionClient(verticalCandidates), {
  origin: verticalPath[0], destination: verticalPath[1], vehicle: 'truck', truckProfile: { heightM: 4.5 },
});
ok(verticalResult.data.restrictionWarnings.length === 1 && verticalResult.data.restrictionWarnings[0].note === 'near-route-vertical',
  'vertical route: the off-to-the-side-but-near restriction is included, the far one excluded');

// getTruckRestrictions (point+radius, not route-based) also got the same
// class of fix: a bbox corner beyond the real radius is now excluded.
const center = { lat: 35.70, lng: 51.40 };
const radiusMeters = 500;
const cornerBeyondRadius = { lat: 35.704, lng: 51.404 }; // bbox corner, haversine distance ~574m > 500m radius
const insideRadius = { lat: 35.7002, lng: 51.4002 }; // well within 500m
const truckRestrictionCandidates = [restrictionRow(insideRadius, 'inside-radius'), restrictionRow(cornerBeyondRadius, 'bbox-corner-beyond-radius')];
const truckRestrictionResult = await aiContracts.getTruckRestrictions(fakeRestrictionClient(truckRestrictionCandidates), center, radiusMeters, { heightM: 4.5 });
ok(truckRestrictionResult.status === 'ok' && truckRestrictionResult.data.length === 1 && truckRestrictionResult.data[0].note === 'inside-radius',
  'getTruckRestrictions excludes a bbox-corner candidate that is actually beyond the requested radius');

// Truck routing stays advisory-only throughout -- none of this fix
// upgrades routingMode.
ok(diagonalResult.data.routingMode === 'advisory_estimate', 'corridor filtering never upgrades the route to native_validated');

// ===========================================================================
// Item 2: road-event classification honesty
// ===========================================================================
function fakeRoadEventClient(featureRows, detailRows) {
  return {
    rpc() { return Promise.resolve({ data: null, error: { code: '42883', message: 'undefined_function (fake client)' } }); },
    from(table) {
      const rows = table === 'map_road_event_details' ? detailRows : featureRows;
      const builder = {
        select() { return builder; }, eq() { return builder; },
        gte() { return builder; }, lte() { return builder; }, in() { return builder; },
        then(resolve) { resolve({ data: rows, error: null }); },
      };
      return builder;
    },
  };
}
const featureRows = [
  { id: 1, category_id: 9, name_fa: 'classified', name_en: null, lat: 35.7, lng: 51.4, status: 'verified', confidence: 0.5, map_poi_categories: { slug: 'road_event' } },
  { id: 2, category_id: 9, name_fa: 'unclassified', name_en: null, lat: 35.7, lng: 51.4, status: 'verified', confidence: 0.5, map_poi_categories: { slug: 'road_event' } },
];
const detailRows = [{ feature_id: 1, event_type: 'closure', severity: 'high' }]; // feature 2 has NO detail row
const roadEventsResult = await aiContracts.findRoadEvents(fakeRoadEventClient(featureRows, detailRows), { lat: 35.7, lng: 51.4 }, 50_000);
ok(roadEventsResult.status === 'ok', 'findRoadEvents resolves ok');
const classified = roadEventsResult.data.find((e) => e.id === 1);
const unclassified = roadEventsResult.data.find((e) => e.id === 2);
ok(classified.eventType === 'closure' && classified.severity === 'high', 'a feature with a real detail row reports its real classification');
ok(unclassified.eventType === null && unclassified.severity === null,
  'a feature with NO detail row reports eventType/severity as null -- never fabricated as "other"/"low"');

console.log(`${passed} Phase 3 audit corrective (truck corridor + road-event honesty) assertions passed.`);
