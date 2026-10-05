// Phase 3, Part 4: production-scale hardening -- rate limits on
// submit_community_report / create_location_share, and the AI tool
// surface's read/write boundary. Loads the real migrations against
// PGlite, same pattern as the other map-phase*.mjs tests.
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

  const reporter = '00000000-0000-0000-0000-000000000051';
  await db.exec(`insert into auth.users values ('${reporter}','{"name":"Reporter","mobile":"09130000051","user_type":"owner"}');`);

  let passed = 0;
  async function as(uid, fn) {
    await db.exec(`set role ${uid ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub','${uid ?? ''}',false);`);
    try { return await fn(); } finally { await db.exec('reset role'); }
  }
  async function deny(sql) { await assert.rejects(() => db.exec(sql)); passed++; }

  // --- Indexes exist for the columns the new RLS/review queries filter on ---
  const idx = await db.query(`select indexname from pg_indexes where schemaname='public' and indexname in (
    'map_community_reports_reporter_id_idx','map_community_reports_status_idx',
    'map_location_shares_profile_id_idx','map_location_share_grants_grantee_profile_id_idx',
    'map_road_restrictions_feature_id_idx')`);
  assert.equal(idx.rows.length, 5, 'all 5 Part 4 hardening indexes exist'); passed++;

  // --- submit_community_report rate limit: 10 per hour --------------------
  // (Superseded to a fixed-hour window + atomic upsert-increment by the
  // Phase 3 audit corrective patch -- see
  // tests/map-phase3-audit-corrective-db.mjs for the concurrency proof.
  // This still passes under either window scheme since it never crosses
  // an hour boundary.)
  await as(reporter, async () => {
    for (let i = 0; i < 10; i++) {
      const r = await db.query(`select submit_community_report((select id from map_poi_categories where slug='landmark'),35.7,51.4,'r${i}')`);
      assert.ok(Number.isInteger(r.rows[0].submit_community_report)); passed++;
    }
  });
  await as(reporter, async () => {
    await deny("select submit_community_report((select id from map_poi_categories where slug='landmark'),35.7,51.4,'11th report')");
  });

  // --- create_location_share rate limit: 10 per hour (see note above) -----
  // Each call revokes the prior active share in the same context, so this
  // also proves the rate limit counts *creation attempts*, not active rows.
  await as(reporter, async () => {
    for (let i = 0; i < 10; i++) {
      const r = await db.query("select create_location_share(35.7,51.4,'roadside_breakdown',10)");
      assert.ok(Number.isInteger(r.rows[0].create_location_share)); passed++;
    }
  });
  await as(reporter, async () => {
    await deny("select create_location_share(35.7,51.4,'roadside_breakdown',10)");
  });
  // Only the most recent share (the 10th) is still active; the rate limit
  // itself doesn't leave 10 stale rows lying around as "active."
  await as(reporter, async () => {
    const active = await db.query("select count(*)::int as c from map_location_shares where profile_id=auth.uid() and revoked_at is null and expires_at > now()");
    assert.equal(active.rows[0].c, 1); passed++;
  });

  console.log(`${passed} map Phase 3 Part 4 (hardening: indexes + rate limits) assertions passed.`);
  await db.close();
}

run().catch(e => { console.error(e.message); process.exitCode = 1; });
