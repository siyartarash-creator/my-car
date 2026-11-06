import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openSchemaDb } from './helpers/schema-snapshot.mjs';
import {
  ACCEPT_PATH_FUNCTIONS, ACCEPT_PATH_WHAT_IT_BINDS, NOT_ACCEPT_PATHS, scanAcceptPathCandidates,
} from './helpers/accept-paths.mjs';

// WU-FINANCE-F1: proves the accept-path inventory (tests/helpers/accept-paths.mjs)
// is complete against the LIVE catalog, not just internally consistent. This
// step adds no can_accept_work(...) predicate -- F2b is what will iterate
// this list -- so the only thing to prove here is that the list and the
// measured population agree, and that the measurement can actually detect
// drift (the self-proof).

let passed = 0;

async function main() {
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  const db = await openSchemaDb(projectRoot);

  // 1) Every pinned name resolves in pg_proc as a public, SECURITY DEFINER
  //    function that `authenticated` may execute.
  for (const name of ACCEPT_PATH_FUNCTIONS) {
    const row = (await db.query(
      `select p.oid, p.prosecdef, has_function_privilege('authenticated', p.oid, 'execute') as can_exec
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = $1`,
      [name]
    )).rows[0];
    assert.ok(row, `${name}: not found as a public function at all`);
    passed++;
    assert.equal(row.prosecdef, true, `${name}: not SECURITY DEFINER`);
    passed++;
    assert.equal(row.can_exec, true, `${name}: authenticated cannot execute it`);
    passed++;
  }

  // 2) The measured structural scan returns EXACTLY the pinned set (accept
  //    functions + named exclusions) -- missing or extra fails the build.
  const liveRows = await scanAcceptPathCandidates(db);
  const found = liveRows.map((r) => r.proname).sort();
  const expected = [...ACCEPT_PATH_FUNCTIONS, ...Object.keys(NOT_ACCEPT_PATHS)].sort();
  assert.deepEqual(
    found, expected,
    `accept-path population drifted -- found: [${found.join(', ')}], expected: [${expected.join(', ')}]` +
    ' (a function assigning a provider/assignee column on hauling_requests/onsite_requests/service_requests/orders' +
    ' appeared or disappeared -- add it to ACCEPT_PATH_FUNCTIONS in tests/helpers/accept-paths.mjs if it is a real' +
    ' accept path, F2b must gate it, or to NOT_ACCEPT_PATHS there with a written reason otherwise)'
  );
  passed++;

  // 3) Every listed name carries its "what it binds" line; every exclusion
  //    carries its written reason. Both are required, same discipline as
  //    the suspension/documents-gate coverage suite's pinned sets.
  for (const name of ACCEPT_PATH_FUNCTIONS) {
    assert.ok(
      typeof ACCEPT_PATH_WHAT_IT_BINDS[name] === 'string' && ACCEPT_PATH_WHAT_IT_BINDS[name].trim().length > 0,
      `${name}: missing a "what it binds" line in ACCEPT_PATH_WHAT_IT_BINDS`
    );
    passed++;
  }
  for (const name of Object.keys(NOT_ACCEPT_PATHS)) {
    assert.ok(
      typeof NOT_ACCEPT_PATHS[name] === 'string' && NOT_ACCEPT_PATHS[name].trim().length > 0,
      `${name}: excluded from the accept-path list with no written reason`
    );
    passed++;
  }

  // 4) Self-proof: the scan must be able to FAIL. Plant a synthetic
  //    SECURITY DEFINER function that assigns a provider on a real job
  //    table, inside this run's own PGlite instance only -- nothing here
  //    touches supabase/migrations.
  await selfProof(db);

  await db.close();
  console.log(`${passed} finance accept-path inventory assertions passed.`);
}

async function selfProof(db) {
  await db.exec(`
    create function public.probe_finance_accept_path(p_id uuid) returns void
    language plpgsql security definer set search_path = '' as $$
    begin
      update public.hauling_requests set provider_id = auth.uid(), status = 'accepted' where id = p_id;
    end $$;
    revoke all on function public.probe_finance_accept_path(uuid) from public, anon;
    grant execute on function public.probe_finance_accept_path(uuid) to authenticated;
  `);
  try {
    const rows = await scanAcceptPathCandidates(db);
    const probe = rows.find((r) => r.proname === 'probe_finance_accept_path');
    assert.ok(probe, 'self-proof FAILED: synthetic accept-shaped function not detected by the structural scan');
    passed++;

    const registered =
      ACCEPT_PATH_FUNCTIONS.includes(probe.proname) || Object.keys(NOT_ACCEPT_PATHS).includes(probe.proname);
    assert.ok(!registered, 'self-proof FAILED: synthetic probe function unexpectedly matched a pinned/exempt name');
    passed++;

    // The same equality check assertion (2) above would now fail on this
    // live population -- that is the point of the self-proof: an
    // unregistered accept-shaped function breaks the build instead of
    // slipping through silently.
    const found = rows.map((r) => r.proname).sort();
    const expected = [...ACCEPT_PATH_FUNCTIONS, ...Object.keys(NOT_ACCEPT_PATHS)].sort();
    assert.notDeepEqual(found, expected, 'self-proof FAILED: the planted probe did not actually change the measured population');
    passed++;
  } finally {
    await db.exec('drop function public.probe_finance_accept_path(uuid)');
  }

  const restored = (await scanAcceptPathCandidates(db)).map((r) => r.proname).sort();
  const expected = [...ACCEPT_PATH_FUNCTIONS, ...Object.keys(NOT_ACCEPT_PATHS)].sort();
  assert.deepEqual(restored, expected, 'restore FAILED: the scan did not return to the clean pinned set after the probe was dropped');
  passed++;
}

await main();
