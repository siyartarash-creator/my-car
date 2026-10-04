// Phase 3, Part 2: road-event classification (event_type/severity) and
// infrastructure POI categories. Loads the real migrations against PGlite,
// same pattern as tests/map-phase2-lifecycle.mjs.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const base = fileURLToPath(new URL('../', import.meta.url));

async function run() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
  create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
  create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
  alter table storage.objects enable row level security; grant usage on schema storage to anon,authenticated;
  grant select,insert,update,delete on storage.objects to anon,authenticated;`);
  for (const f of fs.readdirSync(path.join(base, 'supabase/migrations')).sort()) {
    await db.exec(fs.readFileSync(path.join(base, 'supabase/migrations', f), 'utf8'));
  }

  const owner = '00000000-0000-0000-0000-000000000031';
  const admin = '00000000-0000-0000-0000-000000000032';
  await db.exec(`insert into auth.users values
    ('${owner}','{"name":"Owner","mobile":"09130000031","user_type":"owner"}'),
    ('${admin}','{"name":"Admin","mobile":"09130000032","user_type":"owner"}');
  update profiles set is_admin=true where id='${admin}';`);

  let passed = 0;
  async function as(uid, fn) {
    await db.exec(`set role ${uid ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub','${uid ?? ''}',false);`);
    try { return await fn(); } finally { await db.exec('reset role'); }
  }
  async function check(sql, value) { const r = await db.query(sql); assert.deepEqual(Object.values(r.rows[0])[0], value); passed++; }
  async function deny(sql) { await assert.rejects(() => db.exec(sql)); passed++; }

  // --- Infrastructure categories are real, active, provenance-visible ---
  for (const slug of ['petrol', 'diesel', 'cng', 'ev_charging', 'parking', 'truck_stop', 'weigh_station', 'terminal', 'road_infrastructure']) {
    await check(`select is_active from map_poi_categories where slug='${slug}'`, true);
  }
  // fuel_station/ev_charging/truck_stop were Phase 1 placeholders (seeded
  // inactive, no real data source yet) -- confirming they were reactivated
  // in place, not duplicated under a second slug.
  await check("select count(*)::int from map_poi_categories where slug in ('fuel_station','ev_charging','truck_stop')", 3);

  // --- Road-event classification travels submission -> promotion --------
  let closureReport, closureFeature;
  await as(owner, async () => {
    const r = await db.query(
      "select submit_community_report((select id from map_poi_categories where slug='road_event'),35.75,51.42,'Bridge out',p_event_type=>'closure',p_severity=>'high')",
    );
    closureReport = r.rows[0].submit_community_report; passed++;
  });
  await as(admin, async () => {
    await db.exec(`select review_community_report(${closureReport},'promoted',null)`); passed++;
    const f = await db.query(`select promoted_feature_id from map_community_reports where id=${closureReport}`);
    closureFeature = f.rows[0].promoted_feature_id; passed++;
    const d = await db.query(`select event_type, severity from map_road_event_details where feature_id=${closureFeature}`);
    assert.equal(d.rows[0].event_type, 'closure'); passed++;
    assert.equal(d.rows[0].severity, 'high'); passed++;
  });

  // --- No classification given -> honest defaults, never guessed ---------
  let plainReport, plainFeature;
  await as(owner, async () => {
    const r = await db.query(
      "select submit_community_report((select id from map_poi_categories where slug='road_event'),35.76,51.43,'Something on the road')",
    );
    plainReport = r.rows[0].submit_community_report; passed++;
  });
  await as(admin, async () => {
    await db.exec(`select review_community_report(${plainReport},'promoted',null)`); passed++;
    const f = await db.query(`select promoted_feature_id from map_community_reports where id=${plainReport}`);
    plainFeature = f.rows[0].promoted_feature_id; passed++;
    const d = await db.query(`select event_type, severity from map_road_event_details where feature_id=${plainFeature}`);
    assert.equal(d.rows[0].event_type, 'other'); passed++;
    assert.equal(d.rows[0].severity, 'low'); passed++;
  });

  // --- Invalid classification is rejected, not silently coerced ----------
  await as(owner, async () => {
    await deny(
      "select submit_community_report((select id from map_poi_categories where slug='road_event'),35.7,51.4,'x',p_event_type=>'not_a_real_type')",
    );
    await deny(
      "select submit_community_report((select id from map_poi_categories where slug='road_event'),35.7,51.4,'x',p_severity=>'catastrophic')",
    );
  });

  // --- map_road_event_details visibility mirrors the feature's own visibility ---
  await as(admin, async () => {
    await db.exec(`update map_features set status='verified', verified_by='${admin}', verified_at=now() where id=${closureFeature}`); passed++;
  });
  await as(null, async () => {
    await check(`select count(*)::int from map_road_event_details where feature_id=${closureFeature}`, 1); // verified -> public
    await check(`select count(*)::int from map_road_event_details where feature_id=${plainFeature}`, 0); // still pending -> hidden from anon
  });
  await as(admin, async () => {
    await check(`select count(*)::int from map_road_event_details where feature_id=${plainFeature}`, 1); // admin still sees it
  });

  // --- Regression guard: submit_community_report stays a single
  // unambiguous overload after widening -- the exact bug class the Phase 2
  // review_community_report fix (202610040001) was written to prevent.
  await as(owner, async () => {
    const r = await db.query("select submit_community_report((select id from map_poi_categories where slug='landmark'),35.6,51.3,'Statue')");
    assert.ok(Number.isInteger(r.rows[0].submit_community_report), 'old 4-positional-arg call shape still resolves to exactly one function');
    passed++;
  });

  console.log(`${passed} map Phase 3 Part 2 (road-event classification + infrastructure) assertions passed.`);
  await db.close();
}

run().catch(e => { console.error(e.message); process.exitCode = 1; });
