// Phase 3, Part 3: roadside Map-side location-handoff contract
// (map_location_shares / map_location_share_grants). Loads the real
// migrations against PGlite, same pattern as the other map-phase*.mjs tests.
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

  const driver = '00000000-0000-0000-0000-000000000041';
  const responder = '00000000-0000-0000-0000-000000000042';
  const stranger = '00000000-0000-0000-0000-000000000043';
  const admin = '00000000-0000-0000-0000-000000000044';
  await db.exec(`insert into auth.users values
    ('${driver}','{"name":"Driver","mobile":"09130000041","user_type":"owner"}'),
    ('${responder}','{"name":"Responder","mobile":"09130000042","user_type":"service"}'),
    ('${stranger}','{"name":"Stranger","mobile":"09130000043","user_type":"owner"}'),
    ('${admin}','{"name":"Admin","mobile":"09130000044","user_type":"owner"}');
  update profiles set is_admin=true where id='${admin}';`);

  let passed = 0;
  async function as(uid, fn) {
    await db.exec(`set role ${uid ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub','${uid ?? ''}',false);`);
    try { return await fn(); } finally { await db.exec('reset role'); }
  }
  async function check(sql, value) { const r = await db.query(sql); assert.deepEqual(Object.values(r.rows[0])[0], value); passed++; }
  async function deny(sql) { await assert.rejects(() => db.exec(sql)); passed++; }

  // --- Default-off: nothing exists until an explicit opt-in call --------
  await check('select count(*)::int from map_location_shares', 0); // confirms no seed/auto-created rows anywhere in the migration set

  // --- Anonymous cannot create a share -----------------------------------
  await as(null, async () => { await deny("select create_location_share(35.7,51.4,'roadside_breakdown',60)"); });

  // --- Owner creates a share; only the owner (and admin) can see it ------
  let shareId;
  await as(driver, async () => {
    const r = await db.query("select create_location_share(35.7,51.4,'roadside_breakdown',60)");
    shareId = r.rows[0].create_location_share; passed++;
  });
  await as(driver, async () => { await check(`select count(*)::int from map_location_shares where id=${shareId}`, 1); });
  await as(stranger, async () => { await check(`select count(*)::int from map_location_shares where id=${shareId}`, 0); });
  await as(admin, async () => { await check(`select count(*)::int from map_location_shares where id=${shareId}`, 1); });
  // Anonymous has no grant on this table at all (not even RLS-filtered
  // access) -- location-share data is never public, unlike
  // map_service_locations' published directory.
  await as(null, async () => { await deny(`select count(*)::int from map_location_shares where id=${shareId}`); });

  // --- Creating a second share in the same context revokes the first -----
  let secondShareId;
  await as(driver, async () => {
    const r = await db.query("select create_location_share(35.71,51.41,'roadside_breakdown',60)");
    secondShareId = r.rows[0].create_location_share; passed++;
    await check(`select revoked_at is not null from map_location_shares where id=${shareId}`, true);
    await check(`select revoked_at is null from map_location_shares where id=${secondShareId}`, true);
  });

  // --- Grant: only the owner can grant, and not to themselves -------------
  await as(responder, async () => { await deny(`select grant_location_share_access(${secondShareId}, '${responder}')`); }); // not the owner
  await as(driver, async () => { await deny(`select grant_location_share_access(${secondShareId}, '${driver}')`); }); // cannot grant to self

  let grantId;
  await as(driver, async () => {
    const r = await db.query(`select grant_location_share_access(${secondShareId}, '${responder}')`);
    grantId = r.rows[0].grant_location_share_access; passed++;
    assert.ok(Number.isInteger(grantId)); passed++;
  });

  // --- Grantee can now see the share; a stranger still cannot ------------
  await as(responder, async () => { await check(`select count(*)::int from map_location_shares where id=${secondShareId}`, 1); });
  await as(stranger, async () => { await check(`select count(*)::int from map_location_shares where id=${secondShareId}`, 0); });

  // --- Revoking the share removes the grantee's access immediately -------
  await as(driver, async () => { await db.exec(`select revoke_location_share(${secondShareId})`); passed++; });
  await as(responder, async () => { await check(`select count(*)::int from map_location_shares where id=${secondShareId}`, 0); });
  // Owner/admin still see it (their own audit trail) even revoked.
  await as(driver, async () => { await check(`select count(*)::int from map_location_shares where id=${secondShareId}`, 1); });

  // --- Revoking an already-revoked (or not-owned) share is rejected, not silently no-op'd ---
  await as(driver, async () => { await deny(`select revoke_location_share(${secondShareId})`); });
  await as(stranger, async () => { await deny(`select revoke_location_share(${secondShareId})`); });

  // --- Expiry removes a grantee's access the same way revocation does ----
  let thirdShareId;
  await as(driver, async () => {
    const r = await db.query("select create_location_share(35.72,51.42,'other',1)"); // 1 minute TTL
    thirdShareId = r.rows[0].create_location_share; passed++;
    await db.query(`select grant_location_share_access(${thirdShareId}, '${responder}')`);
    passed++;
  });
  await as(responder, async () => { await check(`select count(*)::int from map_location_shares where id=${thirdShareId}`, 1); });
  // Simulating "time has passed" at the test-harness level (the default
  // connection, not a role-switched user) -- map_location_shares has no
  // UPDATE grant for authenticated at all, by design (every write goes
  // through the RPCs above), so a real user could never do this directly.
  await db.exec(`update map_location_shares set expires_at = now() - interval '1 minute' where id=${thirdShareId}`); passed++;
  await as(responder, async () => { await check(`select count(*)::int from map_location_shares where id=${thirdShareId}`, 0); });
  await as(driver, async () => { await check(`select count(*)::int from map_location_shares where id=${thirdShareId}`, 1); }); // owner still sees it

  // --- Invalid inputs are rejected server-side, never silently coerced ---
  await as(driver, async () => {
    await deny("select create_location_share(999,51.4,'roadside_breakdown',60)"); // invalid latitude
    await deny("select create_location_share(35.7,51.4,'not_a_real_context',60)"); // invalid context
    await deny("select create_location_share(35.7,51.4,'roadside_breakdown',0)"); // invalid ttl (too small)
    await deny("select create_location_share(35.7,51.4,'roadside_breakdown',10000)"); // invalid ttl (exceeds 12h cap)
  });

  // --- No direct table write bypasses the RPCs ----------------------------
  await as(driver, async () => {
    await deny(`insert into map_location_shares(profile_id, lat, lng, expires_at) values ('${driver}',35.7,51.4,now()+interval '1 hour')`);
  });

  console.log(`${passed} map Phase 3 Part 3 (location-share contract) assertions passed.`);
  await db.close();
}

run().catch(e => { console.error(e.message); process.exitCode = 1; });
