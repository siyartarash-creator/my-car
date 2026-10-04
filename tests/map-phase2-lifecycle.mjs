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

  const owner = '00000000-0000-0000-0000-000000000021';
  const admin = '00000000-0000-0000-0000-000000000022';
  await db.exec(`insert into auth.users values
    ('${owner}','{"name":"Owner","mobile":"09130000021","user_type":"owner"}'),
    ('${admin}','{"name":"Admin","mobile":"09130000022","user_type":"owner"}');
  update profiles set is_admin=true where id='${admin}';`);

  let passed = 0;
  async function as(uid, fn) {
    await db.exec(`set role ${uid ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub','${uid ?? ''}',false);`);
    try { return await fn(); } finally { await db.exec('reset role'); }
  }
  async function check(sql, value) { const r = await db.query(sql); assert.deepEqual(Object.values(r.rows[0])[0], value); passed++; }

  await check("select is_active from map_poi_categories where slug='road_event'", true);

  // road_event promotion gets a default 12h expiry when none is given.
  let roadEventReport, roadEventFeature;
  await as(owner, async () => {
    const r = await db.query(
      "select submit_community_report((select id from map_poi_categories where slug='road_event'),35.75,51.42,'Pothole')",
    );
    roadEventReport = r.rows[0].submit_community_report; passed++;
  });
  await as(admin, async () => {
    await db.exec(`select review_community_report(${roadEventReport},'promoted',null)`); passed++;
    const f = await db.query(
      `select id, expires_at > now() + interval '11 hours' and expires_at < now() + interval '13 hours' as near_12h
       from map_features where submitted_by='${owner}' order by id desc limit 1`,
    );
    roadEventFeature = f.rows[0].id;
    assert.equal(f.rows[0].near_12h, true); passed++;
  });

  // A non-road_event report with no explicit expiry stays permanent (null).
  let plainReport;
  await as(owner, async () => {
    const r = await db.query("select submit_community_report((select id from map_poi_categories where slug='landmark'),35.6,51.3,'Statue')");
    plainReport = r.rows[0].submit_community_report; passed++;
  });
  await as(admin, async () => {
    await db.exec(`select review_community_report(${plainReport},'promoted',null)`); passed++;
    await check(`select expires_at is null from map_features where submitted_by='${owner}' and id<>${roadEventFeature}`, true);
  });

  // Regression guard: review_community_report must stay a single
  // unambiguous (bigint,text,text) signature. An earlier draft added a
  // 4th optional parameter as a second overload, which made this exact
  // kind of 3-argument call ambiguous ("function ... is not unique") for
  // every caller, including PostgREST -- caught during STAGING
  // verification, not by this suite, which is why this guard exists now.
  let explicitReport, explicitFeature;
  await as(owner, async () => {
    const r = await db.query("select submit_community_report((select id from map_poi_categories where slug='landmark'),35.6,51.3,'Short-lived')");
    explicitReport = r.rows[0].submit_community_report; passed++;
  });
  await as(admin, async () => {
    await db.exec(`select review_community_report(${explicitReport},'promoted',null)`); passed++;
    const f1 = await db.query(`select promoted_feature_id from map_community_reports where id=${explicitReport}`);
    explicitFeature = f1.rows[0].promoted_feature_id; passed++;
    await db.exec(`update map_features set expires_at = now() + interval '1 hour' where id=${explicitFeature}`); passed++;
  });

  // Verify all three, then confirm expiry enforcement: an expired verified
  // feature disappears from public view but an admin still sees it.
  await as(admin, async () => {
    await db.exec(`update map_features set status='verified', verified_by='${admin}', verified_at=now()
      where id in (${roadEventFeature},${explicitFeature})`); passed++;
    await db.exec(`update map_features set expires_at = now() - interval '1 minute' where id=${explicitFeature}`); passed++;
  });
  await as(null, async () => {
    await check(`select count(*)::int from map_features where id=${roadEventFeature}`, 1); // not yet expired
    await check(`select count(*)::int from map_features where id=${explicitFeature}`, 0); // expired -> hidden
  });
  await as(admin, async () => {
    await check(`select count(*)::int from map_features where id=${explicitFeature}`, 1); // admin still sees it
  });

  console.log(`${passed} map Phase 2 lifecycle (road events + expiry) assertions passed.`);
  await db.close();
}

run().catch(e => { console.error(e.message); process.exitCode = 1; });
