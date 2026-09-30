// Admin Panel Completion, Checkpoint D: standalone runner for the routine
// seed dataset (tests/fixtures/admin-routine-seed.mjs).
//
// LOCAL/EPHEMERAL ONLY: builds its own in-memory PGlite Postgres instance
// (identical bootstrap to tests/database-security.mjs's own run(false)
// path -- same auth/storage stub schemas, same migration application),
// seeds the routine dataset into it, asserts the live database actually
// matches the totals seedRoutineDataset() itself computed, then exercises
// resetRoutineDataset() and asserts everything it touched is gone. Never
// connects to any real Supabase project -- there is no URL, key, or
// project ref anywhere in this file or the fixture module it imports.
//
// Usage: node tests/seed-routine-dataset.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { seedRoutineDataset, resetRoutineDataset, SEED_IDENTITIES } from "./fixtures/admin-routine-seed.mjs";

const base = fileURLToPath(new URL("../", import.meta.url));

async function main() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security; grant usage on schema storage to anon,authenticated;
grant select,insert,update,delete on storage.objects to anon,authenticated;`);
  for (const f of fs.readdirSync(path.join(base, "supabase/migrations")).sort()) {
    await db.exec(fs.readFileSync(path.join(base, "supabase/migrations", f), "utf8"));
  }

  console.log("Seeding routine Checkpoint D dataset...");
  const t0 = Date.now();
  const { totals, orderIds, offerIds } = await seedRoutineDataset(db);
  console.log(`Seeded in ${Date.now() - t0}ms. Computed totals:`, JSON.stringify(totals, null, 2));

  let passed = 0;
  const check = async (label, sql, expected) => {
    const row = (await db.query(sql)).rows[0];
    const actual = Object.values(row)[0];
    assert.deepEqual(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    passed++;
  };

  // Cross-check the totals seedRoutineDataset() reported against independent
  // live queries -- this is what makes them "known exact expected totals"
  // rather than an untested claim.
  await check("product count", `select count(*)::int from products where slug like '${SEED_IDENTITIES.productSlugPrefix}%'`, totals.productCount);
  await check("offer count", `select count(*)::int from product_sellers where id = any(array[${offerIds.join(",")}])`, totals.offerCount);
  await check(
    "offer active count",
    `select count(*)::int from product_sellers where id = any(array[${offerIds.join(",")}]) and is_active`,
    totals.offerActive,
  );
  await check("order count", `select count(*)::int from orders where id = any(array[${orderIds.join(",")}])`, totals.orderCount);
  await check(
    "order value total",
    `select coalesce(sum(final_price),0)::bigint from orders where id = any(array[${orderIds.join(",")}])`,
    totals.orderValueTotal,
  );
  for (const [status, expected] of Object.entries(totals.orderStatusCounts)) {
    await check(
      `order status '${status}' count`,
      `select count(*)::int from orders where id = any(array[${orderIds.join(",")}]) and status='${status}'`,
      expected,
    );
  }
  await check(
    "discount_requests total",
    `select count(*)::int from discount_requests where offer_id = any(array[${offerIds.join(",")}])`,
    totals.discountRequestTotal,
  );
  for (const [status, expected] of Object.entries(totals.discountRequestStatusCounts)) {
    await check(
      `discount_requests status '${status}' count`,
      `select count(*)::int from discount_requests where offer_id = any(array[${offerIds.join(",")}]) and status='${status}'`,
      expected,
    );
  }
  await check(
    "coupon usage total",
    `select coalesce(sum(used_count),0)::int from coupons where code = any(array['${SEED_IDENTITIES.couponCodes.join("','")}'])`,
    totals.couponUsageTotal,
  );
  await check(
    "operator_permissions grant count",
    `select count(*)::int from operator_permissions where profile_id = any(array['${SEED_IDENTITIES.operators.map((o) => o.id).join("','")}']::uuid[])`,
    SEED_IDENTITIES.operators.reduce((n, o) => n + o.permissions.length, 0),
  );

  console.log(`${passed} deterministic-total cross-checks passed against the live database.`);

  console.log("Resetting dataset...");
  await resetRoutineDataset(db);
  await check("products removed", `select count(*)::int from products where slug like '${SEED_IDENTITIES.productSlugPrefix}%'`, 0);
  await check("orders removed", `select count(*)::int from orders where checkout_key::text like '${SEED_IDENTITIES.orderKeyPrefix}%'`, 0);
  await check("coupons removed", `select count(*)::int from coupons where code = any(array['${SEED_IDENTITIES.couponCodes.join("','")}'])`, 0);
  await check(
    "seed profiles removed",
    `select count(*)::int from profiles where id = any(array['${[
      SEED_IDENTITIES.admin.id,
      ...SEED_IDENTITIES.operators.map((o) => o.id),
      ...SEED_IDENTITIES.sellers.map((s) => s.id),
      ...SEED_IDENTITIES.buyers.map((b) => b.id),
    ].join("','")}']::uuid[])`,
    0,
  );
  console.log(`${passed} total assertions passed (seed + deterministic totals + reset).`);
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
