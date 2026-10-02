// DB-level tests for the automotive schema: ownership boundary,
// provenance integrity (published requires human review), and RLS read
// scoping. Loads the full canonical migration sequence (automotive
// foundation included) directly against an in-memory PGlite instance.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const base = fileURLToPath(new URL("../../", import.meta.url));
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

const owner = "a0000000-0000-0000-0000-000000000001";
const other = "a0000000-0000-0000-0000-000000000002";
const admin = "a0000000-0000-0000-0000-000000000003";
await db.exec(`insert into auth.users values
  ('${owner}','{"name":"Owner","mobile":"09100000011","user_type":"owner"}'),
  ('${other}','{"name":"Other","mobile":"09100000012","user_type":"owner"}'),
  ('${admin}','{"name":"Admin","mobile":"09100000013","user_type":"owner"}');
update profiles set is_admin=true where id='${admin}';`);

let passed = 0;
async function as(uid, fn) {
  await db.exec(`set role ${uid ? "authenticated" : "anon"}; select set_config('request.jwt.claim.sub','${uid ?? ""}',false);`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
async function deny(sql) {
  await assert.rejects(() => db.exec(sql));
  passed++;
}
async function check(sql, value, label) {
  const r = await db.query(sql);
  assert.deepEqual(Object.values(r.rows[0])[0], value, label);
  passed++;
}

// --- ownership boundary: vehicles -----------------------------------------
await as(owner, () => db.exec(`insert into vehicles(profile_id,make,model,year) values ('${owner}','Toyota','Corolla',2018)`));
await as(owner, async () => {
  await deny(`insert into vehicles(profile_id,make,model,year) values ('${other}','Honda','Civic',2020)`); // can't own on another's behalf
  await check("select count(*)::int from vehicles", 1, "owner sees only their own vehicle");
});
await as(other, () => check("select count(*)::int from vehicles", 0, "other owner sees no vehicles"));
await as(admin, () => check("select count(*)::int from vehicles", 1, "admin can read all vehicles"));

// --- knowledge provenance: published requires human review ---------------
await as(admin, async () => {
  await db.exec(`insert into automotive_knowledge_sources(source_type,name,authored_by) values ('ai_inferred','Model X','${admin}')`);
  const srcId = (await db.query(`select id from automotive_knowledge_sources where name='Model X'`)).rows[0].id;
  await deny(
    `insert into automotive_knowledge_entries(source_id,system,symptom,possible_cause,confidence,risk_level,review_status)
     values (${srcId},'starting','no start','bad coil','high','routine_safe','published')`,
  ); // ai_inferred can't jump straight to published without reviewed_by/reviewed_at
  await db.exec(
    `insert into automotive_knowledge_entries(source_id,system,symptom,possible_cause,confidence,risk_level,review_status,reviewed_by,reviewed_at)
     values (${srcId},'starting','no start','bad coil','high','routine_safe','published','${admin}',now())`,
  ); // allowed once a human has signed off
  await check("select count(*)::int from automotive_knowledge_entries where review_status='published'", 1, "published entry recorded once reviewed");
});

// --- knowledge read scoping: published+non-fixture visible broadly --------
await as(admin, async () => {
  await db.exec(`insert into automotive_knowledge_sources(source_type,name,authored_by) values ('mechanic_authored','Mehdi','${admin}')`);
  const srcId = (await db.query(`select id from automotive_knowledge_sources where name='Mehdi'`)).rows[0].id;
  await db.exec(
    `insert into automotive_knowledge_entries(source_id,system,symptom,possible_cause,confidence,risk_level,review_status,reviewed_by,reviewed_at,is_fixture)
     values (${srcId},'cooling','overheats','bad relay','medium','routine_safe','published','${admin}',now(),true)`,
  );
});
await as(owner, async () => {
  await check("select count(*)::int from automotive_knowledge_entries where system='starting'", 1, "non-fixture published entry readable by any authenticated user");
  await check("select count(*)::int from automotive_knowledge_entries where system='cooling'", 0, "fixture-marked entry not visible to a non-author owner");
});

console.log(`automotive schema-security: ${passed} checks passed`);
