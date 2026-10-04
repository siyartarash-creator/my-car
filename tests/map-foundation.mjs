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

  const owner = '00000000-0000-0000-0000-000000000001';
  const service = '00000000-0000-0000-0000-000000000002';
  const rescuer = '00000000-0000-0000-0000-000000000003';
  const admin = '00000000-0000-0000-0000-000000000004';
  await db.exec(`insert into auth.users values
    ('${owner}','{"name":"Owner","mobile":"09100000001","user_type":"owner"}'),
    ('${service}','{"name":"ServiceCo","mobile":"09100000002","user_type":"service"}'),
    ('${rescuer}','{"name":"Rescuer","mobile":"09100000003","user_type":"rescuer"}'),
    ('${admin}','{"name":"Admin","mobile":"09100000004","user_type":"owner"}');
  update profiles set is_admin=true where id='${admin}';`);

  let passed = 0;
  async function as(uid, fn) {
    await db.exec(`set role ${uid ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub','${uid ?? ''}',false);`);
    try { return await fn(); } finally { await db.exec('reset role'); }
  }
  async function deny(sql) { await assert.rejects(() => db.exec(sql)); passed++; }
  async function check(sql, value) { const r = await db.query(sql); assert.deepEqual(Object.values(r.rows[0])[0], value); passed++; }

  // Anonymous and plain-owner visibility: only active categories, no sources.
  await as(null, async () => {
    await check('select count(*)::int from map_poi_categories where is_active', 5);
    await deny('select * from map_sources');
    await deny("select publish_service_location(35.7,51.4)");
  });

  // An 'owner' profile (not service/rescuer) cannot publish a service marker.
  await as(owner, async () => {
    await deny('select publish_service_location(35.7,51.4)');
    await deny("select submit_community_report(null,999,51.4,null)"); // out-of-range lat
  });

  // A registered service publishes its own location; snapshot matches profile.
  await as(service, async () => {
    await db.exec('select publish_service_location(35.7,51.4)'); passed++;
    await check("select name_snapshot from map_service_locations where profile_id='" + service + "'", 'ServiceCo');
  });
  await as(null, async () => {
    await check("select is_published from map_service_locations where profile_id='" + service + "'", true);
  });

  // The rescuer cannot forge another profile's marker row directly.
  await as(rescuer, async () => {
    await deny(`insert into map_service_locations(profile_id,user_type_snapshot,name_snapshot,lat,lng,is_published) values ('${service}','rescuer','Fake',0,0,true)`);
    await db.exec('select publish_service_location(36,52)'); passed++;
    await db.exec('select unpublish_service_location()'); passed++;
    await check("select is_published from map_service_locations where profile_id='" + rescuer + "'", false);
  });
  await as(null, async () => {
    await check("select count(*)::int from map_service_locations where is_published", 1); // only 'service' still published
  });

  // Community report: pending report is invisible to other owners, visible to reporter and admin.
  let reportId;
  await as(owner, async () => {
    const r = await db.query("select submit_community_report(null,35.8,51.5,'Pothole here')");
    reportId = r.rows[0].submit_community_report; passed++;
    await check(`select status from map_community_reports where id=${reportId}`, 'pending');
  });
  await as(rescuer, () => deny(`select status from map_community_reports where id=${reportId} limit 1`).catch(() => {}));
  await as(rescuer, async () => {
    const r = await db.query(`select count(*)::int from map_community_reports where id=${reportId}`);
    assert.equal(r.rows[0].count, 0); passed++; // RLS hides rows it can't see rather than erroring
  });
  await as(owner, () => deny(`select review_community_report(${reportId},'promoted',null)`));

  // Admin promotes the report into a canonical pending feature.
  await as(admin, async () => {
    await db.exec(`select review_community_report(${reportId},'promoted','looks real')`); passed++;
    await check(`select status from map_community_reports where id=${reportId}`, 'promoted');
    const f = await db.query(`select status, confidence, category_id from map_features where submitted_by='${owner}'`);
    assert.equal(f.rows[0].status, 'pending'); passed++;
    assert.equal(Number(f.rows[0].confidence), 0.3); passed++;
  });

  // A pending (unverified) feature stays invisible to the public until an admin verifies it directly.
  let featureId;
  await as(admin, async () => {
    const f = await db.query(`select id from map_features where submitted_by='${owner}'`);
    featureId = f.rows[0].id;
  });
  await as(null, async () => {
    const r = await db.query(`select count(*)::int from map_features where id=${featureId}`);
    assert.equal(r.rows[0].count, 0); passed++;
  });
  await as(admin, async () => {
    await db.exec(`update map_features set status='verified', verified_by='${admin}', verified_at=now() where id=${featureId}`); passed++;
  });
  await as(null, async () => {
    await check(`select status from map_features where id=${featureId}`, 'verified');
  });

  // rls_enabled invariant also covers the new map_ tables (belt-and-suspenders beyond post-deploy-check.sql).
  const unprotected = await db.query("select count(*)::int from pg_tables where schemaname='public' and tablename like 'map_%' and not rowsecurity");
  assert.equal(unprotected.rows[0].count, 0); passed++;

  console.log(`${passed} map foundation (Phase 1, Part 1) assertions passed.`);
  await db.close();
}

run().catch(e => { console.error(e.message); process.exitCode = 1; });
