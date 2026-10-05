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

  const admin = '00000000-0000-0000-0000-000000000010';
  const owner = '00000000-0000-0000-0000-000000000011';
  await db.exec(`insert into auth.users values
    ('${admin}','{"name":"Admin","mobile":"09120000010","user_type":"owner"}'),
    ('${owner}','{"name":"Owner","mobile":"09120000011","user_type":"owner"}');
  update profiles set is_admin=true where id='${admin}';`);

  let passed = 0;
  async function as(uid, fn) {
    await db.exec(`set role ${uid ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub','${uid ?? ''}',false);`);
    try { return await fn(); } finally { await db.exec('reset role'); }
  }
  async function deny(sql) { await assert.rejects(() => db.exec(sql)); passed++; }
  async function check(sql, value) { const r = await db.query(sql); assert.deepEqual(Object.values(r.rows[0])[0], value); passed++; }
  const raw = (row) => `'${JSON.stringify(row).replace(/'/g, "''")}'::jsonb`;

  // Non-admin cannot touch any ingestion RPC.
  await as(owner, async () => {
    await deny("select create_import_batch('synthetic_fixture','csv',null)");
  });

  let batchId;
  await as(admin, async () => {
    const r = await db.query("select create_import_batch('synthetic_fixture','csv','fixture.csv') as id");
    batchId = r.rows[0].id; passed++;
  });

  const validRow = { name_fa: '[نمونه] تعمیرگاه آزادی', lat: 35.6997, lng: 51.338, category_slug: 'repair_shop', external_ref: 'SYNTH-001' };
  const invalidRow = { name_fa: '', lat: 35.7, lng: 51.4, category_slug: 'repair_shop', external_ref: 'SYNTH-005-invalid' };
  const unknownCategoryRow = { name_fa: 'Bad Category', lat: 10, lng: 10, category_slug: 'does_not_exist', external_ref: 'SYNTH-006' };

  let stagingValid, stagingValidDup, stagingInvalid, stagingUnknownCat;
  await as(admin, async () => {
    stagingValid = (await db.query(`select stage_import_row(${batchId}, ${raw(validRow)}) as id`)).rows[0].id;
    stagingValidDup = (await db.query(`select stage_import_row(${batchId}, ${raw(validRow)}) as id`)).rows[0].id;
    stagingInvalid = (await db.query(`select stage_import_row(${batchId}, ${raw(invalidRow)}) as id`)).rows[0].id;
    stagingUnknownCat = (await db.query(`select stage_import_row(${batchId}, ${raw(unknownCategoryRow)}) as id`)).rows[0].id;
    passed += 4;
    await check(`select status from map_import_batches where id=${batchId}`, 'validating');
  });

  await as(admin, async () => {
    await db.exec(`select validate_and_normalize_staging(${stagingInvalid})`); passed++;
    await check(`select status from map_staging_features where id=${stagingInvalid}`, 'rejected');
    const errs = (await db.query(`select validation_errors from map_staging_features where id=${stagingInvalid}`)).rows[0].validation_errors;
    assert.ok(errs.includes('invalid_name_fa')); passed++;

    await db.exec(`select validate_and_normalize_staging(${stagingUnknownCat})`); passed++;
    await check(`select status from map_staging_features where id=${stagingUnknownCat}`, 'rejected');

    await db.exec(`select validate_and_normalize_staging(${stagingValid})`); passed++;
    await check(`select status from map_staging_features where id=${stagingValid}`, 'normalized');
  });

  // Promote the first valid row -> canonical verified feature.
  let featureId;
  await as(owner, () => deny(`select promote_staging_feature(${stagingValid})`));
  await as(admin, async () => {
    featureId = (await db.query(`select promote_staging_feature(${stagingValid}) as id`)).rows[0].id; passed++;
    await check(`select status from map_features where id=${featureId}`, 'verified');
    await check(`select status from map_staging_features where id=${stagingValid}`, 'promoted');
  });
  await as(null, async () => {
    await check(`select count(*)::int from map_features where id=${featureId}`, 1); // verified, publicly visible
  });

  // The duplicate submission of the identical row is detected once normalized.
  await as(admin, async () => {
    await db.exec(`select validate_and_normalize_staging(${stagingValidDup})`); passed++;
    await check(`select status from map_staging_features where id=${stagingValidDup}`, 'duplicate');
    await check(`select promoted_feature_id from map_staging_features where id=${stagingValidDup}`, featureId);
    await deny(`select promote_staging_feature(${stagingValidDup})`); // only 'normalized' rows may be promoted
  });

  // Rollback soft-reverts the promoted feature without deleting it.
  await as(admin, async () => {
    const n = (await db.query(`select rollback_import_batch(${batchId}) as n`)).rows[0].n;
    assert.equal(n, 1); passed++;
    await check(`select status from map_features where id=${featureId}`, 'rejected');
    await check(`select status from map_import_batches where id=${batchId}`, 'rolled_back');
  });
  await as(null, async () => {
    await check(`select count(*)::int from map_features where id=${featureId}`, 0); // no longer publicly visible
  });

  console.log(`${passed} map ingestion (Phase 1, Part 2) assertions passed.`);
  await db.close();
}

run().catch(e => { console.error(e.message); process.exitCode = 1; });
