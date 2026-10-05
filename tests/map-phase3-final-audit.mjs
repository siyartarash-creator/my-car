// Phase 3 final audit corrective patch (2 remaining blockers):
// 1. Automatic precise-location cleanup scheduling (static content check
//    on the STAGING-only pg_cron file -- live scheduling itself can't run
//    under local PGlite, same reason PostGIS-dependent SQL lives in
//    supabase/staging/ instead of supabase/migrations/; see that file's
//    own header, and this session's STAGING verification in the final
//    audit checkpoint for the live cron.job / cron.job_run_details proof).
// 2. Delete-failure UI honesty in MapView.tsx's handleStopRoadsideShare --
//    a regression guard against the exact bug pattern (clearing local
//    state in a `finally` regardless of success/failure) reappearing,
//    since this handler lives inside a React component closure and isn't
//    independently importable for a behavioral unit test without adding
//    a DOM-testing dependency this patch doesn't introduce.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const base = fileURLToPath(new URL('../', import.meta.url));

let passed = 0;
function ok(cond, label) { assert.ok(cond, label); passed++; }

// --- Item 1: cleanup scheduling, static content -------------------------
const scheduleSql = fs.readFileSync(path.join(base, 'supabase/staging/202610100000_map_cleanup_schedule.sql'), 'utf8');
ok(scheduleSql.includes("create extension if not exists pg_cron"), 'schedules file enables pg_cron ($0, Supabase-bundled)');
ok(scheduleSql.includes("cron.schedule(") && scheduleSql.includes("map_cleanup_expired_location_shares"),
  'schedules a job named map_cleanup_expired_location_shares');
ok(scheduleSql.includes("select public.cleanup_expired_location_shares();"),
  'the scheduled command calls the exact committed cleanup function, not a redefinition of its logic');
ok(scheduleSql.includes("cron.unschedule"), 'the file unschedules any prior job with the same name first -- idempotent on re-apply');
ok(!/do \$\$\s*begin\s*perform cron\.schedule/.test(scheduleSql.replace(/\s+/g, ' ')),
  'the schedule call is a plain top-level statement, not silently swallowed inside an exception-handled block (only the unschedule pre-step is)');

// --- Item 2: delete-failure UI honesty, static regression guard ---------
const mapViewSrc = fs.readFileSync(path.join(base, 'components/Map/MapView.tsx'), 'utf8');
const handlerMatch = mapViewSrc.match(/const handleStopRoadsideShare = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[roadsideShareId\]\);/);
ok(handlerMatch != null, 'handleStopRoadsideShare is found in MapView.tsx (sanity check the regex below targets the right function)');
const handlerBody = handlerMatch[0];

// The exact bug: clearing state unconditionally in `finally`.
ok(!/finally\s*\{[\s\S]*setRoadsideShareId\(null\)/.test(handlerBody),
  'handleStopRoadsideShare never clears roadsideShareId inside a finally block (the Part 3 bug) -- must only clear on confirmed success');

// The fix: success path clears state, inside the try, after the await.
const tryMatch = handlerBody.match(/try\s*\{([\s\S]*?)\}\s*catch/);
ok(tryMatch != null, 'handleStopRoadsideShare has a try/catch (not try/finally)');
const tryBody = tryMatch[1];
ok(/await deleteLocationShare\(supabase, roadsideShareId\)/.test(tryBody), 'the try block awaits deleteLocationShare before touching any state');
ok(/setRoadsideShareId\(null\)/.test(tryBody) && /setRoadsideStatus\("idle"\)/.test(tryBody),
  'on success (inside try, after the await), local state is cleared to idle');
const tryAwaitIndex = tryBody.indexOf('await deleteLocationShare');
const trySetIdIndex = tryBody.indexOf('setRoadsideShareId(null)');
ok(tryAwaitIndex >= 0 && trySetIdIndex > tryAwaitIndex, 'the state-clearing calls come AFTER the await, not before it (so a thrown rejection skips them)');

// The fix: failure path keeps the share id, sets a distinct error status.
const catchMatch = handlerBody.match(/catch\s*\{([\s\S]*?)\}\s*\}, \[roadsideShareId\]\);/);
ok(catchMatch != null, 'handleStopRoadsideShare has a catch block');
const catchBody = catchMatch[1];
ok(!/setRoadsideShareId\(null\)/.test(catchBody), 'the catch block never clears roadsideShareId -- a failed delete keeps the active share state');
ok(/setRoadsideStatus\("delete_error"\)/.test(catchBody), 'the catch block sets a distinct "delete_error" status, not "idle" (never implies sharing stopped)');

// Retry remains possible: the button's enabled condition must not disable
// on "delete_error", and must still route to handleStopRoadsideShare
// (via roadsideShareId, not roadsideStatus === "shared") while in that state.
const stopCallIndex = mapViewSrc.indexOf('handleStopRoadsideShare();');
const buttonRegion = mapViewSrc.slice(Math.max(0, stopCallIndex - 200), stopCallIndex + 1200);
ok(/disabled=\{roadsideStatus === "sharing" \|\| roadsideStatus === "deleting"\}/.test(buttonRegion),
  'the roadside button is not disabled while in "delete_error" -- retry is clickable');
ok(/if \(roadsideShareId != null\) handleStopRoadsideShare\(\);/.test(buttonRegion),
  'clicking the button while delete_error (share id still set) calls handleStopRoadsideShare again, not handleStartRoadsideShare');

// A dedicated failure banner exists, distinct from the normal "shared" banner.
ok(/roadsideStatus === "delete_error" &&/.test(mapViewSrc), 'a distinct delete_error banner exists in the UI');
ok(mapViewSrc.includes('توقف اشتراک‌گذاری ناموفق بود'), 'the failure banner text is present and honest about what failed');

console.log(`${passed} Phase 3 final audit (cleanup schedule + delete-failure honesty) assertions passed.`);
