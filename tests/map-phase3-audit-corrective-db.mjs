// Phase 3 independent audit corrective patch: item 3 (precise-location
// retention -- deletion/cleanup are enforceable, not just documented) and
// item 6 (atomic rate limiting -- no count-then-insert race). Loads the
// real migrations against PGlite, same pattern as the other
// map-phase*.mjs tests.
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

  const driver = '00000000-0000-0000-0000-000000000061';
  const responder = '00000000-0000-0000-0000-000000000062';
  const stranger = '00000000-0000-0000-0000-000000000063';
  await db.exec(`insert into auth.users values
    ('${driver}','{"name":"Driver","mobile":"09130000061","user_type":"owner"}'),
    ('${responder}','{"name":"Responder","mobile":"09130000062","user_type":"service"}'),
    ('${stranger}','{"name":"Stranger","mobile":"09130000063","user_type":"owner"}');`);

  let passed = 0;
  async function as(uid, fn) {
    await db.exec(`set role ${uid ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub','${uid ?? ''}',false);`);
    try { return await fn(); } finally { await db.exec('reset role'); }
  }
  async function check(sql, value) { const r = await db.query(sql); assert.deepEqual(Object.values(r.rows[0])[0], value); passed++; }
  async function deny(sql) { await assert.rejects(() => db.exec(sql)); passed++; }

  // =======================================================================
  // Item 3: retention is enforceable -- owner deletion, expiry cleanup,
  // grant cascade.
  // =======================================================================

  // --- Owner can hard-delete their own share; coordinates are gone, not just hidden ---
  let shareId;
  await as(driver, async () => {
    const r = await db.query("select create_location_share(35.7,51.4,'roadside_breakdown',60)");
    shareId = r.rows[0].create_location_share; passed++;
  });
  await as(stranger, async () => { await deny(`select delete_location_share(${shareId})`); }); // not the owner
  await as(driver, async () => {
    await db.exec(`select delete_location_share(${shareId})`); passed++;
  });
  // Query as the table owner (no role switch) to prove the ROW ITSELF is
  // gone, not merely hidden from this session by RLS.
  await check(`select count(*)::int from map_location_shares where id=${shareId}`, 0);
  await as(driver, async () => { await deny(`select delete_location_share(${shareId})`); }); // already gone

  // --- Deleting a share cascades its grants -------------------------------
  let shareId2, grantId2;
  await as(driver, async () => {
    const r = await db.query("select create_location_share(35.7,51.4,'roadside_breakdown',60)");
    shareId2 = r.rows[0].create_location_share; passed++;
    const g = await db.query(`select grant_location_share_access(${shareId2}, '${responder}')`);
    grantId2 = g.rows[0].grant_location_share_access; passed++;
  });
  await check(`select count(*)::int from map_location_share_grants where id=${grantId2}`, 1);
  await as(driver, async () => { await db.exec(`select delete_location_share(${shareId2})`); passed++; });
  await check(`select count(*)::int from map_location_share_grants where share_id=${shareId2}`, 0); // cascaded away

  // --- Expiry cleanup physically deletes expired rows (not just RLS-hidden) ---
  let expiredShareId, activeShareId, oldRevokedShareId;
  await as(driver, async () => {
    const r1 = await db.query("select create_location_share(35.7,51.4,'other',60)");
    expiredShareId = r1.rows[0].create_location_share; passed++;
  });
  await as(driver, async () => {
    const r2 = await db.query("select create_location_share(35.71,51.41,'roadside_breakdown',60)");
    activeShareId = r2.rows[0].create_location_share; passed++;
  });
  // Simulate time passing, at the privileged test-harness level --
  // map_location_shares has no UPDATE grant for authenticated at all.
  await db.exec(`update map_location_shares set expires_at = now() - interval '1 minute' where id=${expiredShareId}`); passed++;
  await db.exec(`update map_location_shares set revoked_at = now() - interval '25 hours' where id=${activeShareId}`);
  oldRevokedShareId = activeShareId;

  // cleanup_expired_location_shares has NO grant to authenticated/anon --
  // only the privileged test connection (standing in for the service
  // role / postgres) can call it.
  await as(driver, async () => { await deny('select cleanup_expired_location_shares()'); });
  const cleanupResult = await db.query('select cleanup_expired_location_shares() as deleted');
  assert.equal(cleanupResult.rows[0].deleted, 2, 'cleanup deletes both the expired share and the long-revoked share'); passed++;
  await check(`select count(*)::int from map_location_shares where id in (${expiredShareId},${oldRevokedShareId})`, 0);

  // --- Deletion/cleanup never silently removes an active share -----------
  let keptShareId;
  await as(driver, async () => {
    const r = await db.query("select create_location_share(35.72,51.42,'other',60)");
    keptShareId = r.rows[0].create_location_share; passed++;
  });
  await db.query('select cleanup_expired_location_shares()');
  await check(`select count(*)::int from map_location_shares where id=${keptShareId}`, 1);

  // =======================================================================
  // Item 6: atomic rate limiting -- no count-then-insert race.
  // =======================================================================

  // --- Still enforces the limit (10/hour) under normal sequential use ----
  await as(responder, async () => {
    for (let i = 0; i < 10; i++) {
      const r = await db.query(`select create_location_share(35.7,51.4,'other',${10 + i})`);
      assert.ok(Number.isInteger(r.rows[0].create_location_share)); passed++;
    }
  });
  await as(responder, async () => { await deny("select create_location_share(35.7,51.4,'other',10)"); });

  // --- Concurrent requests cannot bypass the limit ------------------------
  // Fire 15 concurrent create_location_share calls from a fresh profile
  // (fresh rate-limit window) all at once -- with a raceable
  // count-then-insert, enough of these could interleave their SELECT
  // before any INSERT commits and let more than 10 through. The atomic
  // upsert-increment must still cap it at exactly 10 successes.
  const concurrentUser = '00000000-0000-0000-0000-000000000064';
  await db.exec(`insert into auth.users values ('${concurrentUser}','{"name":"Concurrent","mobile":"09130000064","user_type":"owner"}');`);
  const concurrentResults = await as(concurrentUser, async () => {
    const attempts = Array.from({ length: 15 }, (_, i) =>
      db.query(`select create_location_share(35.7,51.4,'other',${10 + i})`).then(() => 'ok').catch(() => 'denied'));
    return Promise.all(attempts);
  });
  const okCount = concurrentResults.filter((r) => r === 'ok').length;
  const deniedCount = concurrentResults.filter((r) => r === 'denied').length;
  assert.equal(okCount, 10, `exactly 10 of 15 concurrent requests succeed (got ${okCount})`); passed++;
  assert.equal(deniedCount, 5, `the other 5 are denied as rate_limited, not silently dropped (got ${deniedCount})`); passed++;
  await as(concurrentUser, async () => {
    await check("select count(*)::int from map_location_shares where profile_id=auth.uid() and revoked_at is null and expires_at > now()", 1); // only the most recent active share (each create revokes the prior one in this context)
  });

  console.log(`${passed} Phase 3 audit corrective (retention + atomic rate limiting) assertions passed.`);
  await db.close();
}

run().catch(e => { console.error(e.message); process.exitCode = 1; });
