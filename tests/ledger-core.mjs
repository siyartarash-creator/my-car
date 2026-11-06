import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSchemaDb, buildSchemaDb } from './helpers/schema-snapshot.mjs';

// WU-FINANCE-F1: the ledger core's evidence. osaa/specs/finance.md section 4
// row F1 / section 2's architecture decisions. This step adds NO product
// behaviour -- F2a wires real postings, F2b wires the debt ceiling, F3a
// wires settlement -- so everything here proves the SCHEMA facts: the two
// tables' shape, the four enforcement triggers, the posting helper's own
// validation order, RLS, the cutover marker, the reconciliation query (kept
// here as a tracked string, the same way F2a will need it), and that the
// migration changes nothing outside the new ledger objects.

const MIGRATION_FILE = '202611040000_ledger_core.sql';
const ROLLBACK_FILE = '202611040000_ledger_core_rollback.sql';

let passed = 0;

function jsonbLit(value) {
  return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
}

async function main() {
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  const db = await openSchemaDb(projectRoot);

  const scalar = async (sql) => Object.values((await db.query(sql)).rows[0])[0];

  // `as`: the client path -- sets the PostgREST-style role the real app
  // uses, so RLS and GRANTs are actually exercised.
  async function as(uid, fn) {
    await db.exec(`set role ${uid ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub','${uid ?? ''}',false);`);
    try { return await fn(); } finally { await db.exec('reset role'); }
  }
  // `asOwner`: post_ledger_transfer is not callable as `authenticated` at
  // all (see the migration header) -- its own behaviour must be exercised
  // through the role F2a's SECURITY DEFINER RPCs will actually call it as.
  // PGlite's default role (never changed by `set role` here) IS the
  // migration-owning role, so only the jwt claim is set; auth.uid() inside
  // the function then reads the intended caller.
  async function asOwner(uid, fn) {
    await db.exec(`select set_config('request.jwt.claim.sub','${uid ?? ''}',false);`);
    try { return await fn(); } finally { await db.exec(`select set_config('request.jwt.claim.sub','',false);`); }
  }
  async function deny(sql, pattern) {
    if (pattern) await assert.rejects(() => db.exec(sql), pattern);
    else await assert.rejects(() => db.exec(sql));
    passed++;
  }

  async function post(callerUid, sourceType, sourceId, reason, legs, rateSnapshot = { note: 'test snapshot' }) {
    return await asOwner(callerUid, () => scalar(
      `select post_ledger_transfer('${sourceType}','${sourceId}','${reason}',${jsonbLit(legs)},${jsonbLit(rateSnapshot)})`
    ));
  }
  async function postDeny(callerUid, sourceType, sourceId, reason, legs, rateSnapshot, pattern) {
    const before = Number(await scalar(`select count(*)::int from public.ledger_entries`));
    await asOwner(callerUid, () => assert.rejects(
      () => db.query(`select post_ledger_transfer('${sourceType}','${sourceId}','${reason}',${jsonbLit(legs)},${jsonbLit(rateSnapshot)})`),
      pattern
    ));
    passed++;
    const after = Number(await scalar(`select count(*)::int from public.ledger_entries`));
    assert.equal(after, before, 'a refused post must write no rows');
    passed++;
  }
  const leg = (accountId, amount) => ({ account_id: accountId, signed_amount: amount });
  // A reversal leg: the same two keys plus reverses_entry_id, which is what
  // now makes the helper the ONLY writer for a reversal row too (see the
  // migration header, section D).
  const reversalLeg = (accountId, amount, reversesEntryId) => ({
    account_id: accountId, signed_amount: amount, reverses_entry_id: reversesEntryId,
  });
  async function accountOf(profileId) {
    return await scalar(`select id from public.ledger_accounts where profile_id = '${profileId}'`);
  }
  async function platformAccount(code) {
    return await scalar(`select id from public.ledger_accounts where code = '${code}'`);
  }
  async function balanceOf(accountId) {
    return Number(await scalar(`select coalesce(sum(signed_amount),0)::bigint from public.ledger_entries where account_id = '${accountId}'`));
  }

  // ===========================================================================
  // Fixtures.
  // ===========================================================================
  const ADMIN = crypto.randomUUID();
  const OTHER = crypto.randomUUID();   // signed-in bystander, no special role
  const P1 = crypto.randomUUID();      // provider/profile 1
  const P2 = crypto.randomUUID();      // provider/profile 2
  const P3 = crypto.randomUUID();      // provider/profile 3 -- account deactivated for the "inactive account" case

  await db.exec(`insert into auth.users values
    ('${ADMIN}','{"name":"Ledger Admin","mobile":"09197000001","user_type":"owner"}'),
    ('${OTHER}','{"name":"Ledger Bystander","mobile":"09197000002","user_type":"owner"}'),
    ('${P1}','{"name":"Ledger Provider One","mobile":"09197000003","user_type":"rescuer"}'),
    ('${P2}','{"name":"Ledger Provider Two","mobile":"09197000004","user_type":"rescuer"}'),
    ('${P3}','{"name":"Ledger Provider Three","mobile":"09197000005","user_type":"rescuer"}');
  update profiles set is_admin = true where id = '${ADMIN}';`);

  const acctP1 = await accountOf(P1);
  const acctP2 = await accountOf(P2);
  const acctP3 = await accountOf(P3);
  const acctClearing = await platformAccount('platform.clearing');
  const acctRevenue = await platformAccount('platform.revenue');
  await db.exec(`update public.ledger_accounts set is_active = false where id = '${acctP3}'`);

  // ===========================================================================
  // 1) SHAPE -- both tables exist with the columns/types/nullability the
  //    migration declares; ledger_accounts carries no numeric column at all.
  // ===========================================================================
  {
    const cols = async (table) => (await db.query(
      `select column_name, data_type, is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = '${table}' order by ordinal_position`
    )).rows;

    const accountsCols = await cols('ledger_accounts');
    assert.deepEqual(accountsCols, [
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'kind', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'profile_id', data_type: 'uuid', is_nullable: 'YES' },
      { column_name: 'code', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'is_active', data_type: 'boolean', is_nullable: 'NO' },
      { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
      // F5 (202611110000_ledger_shop_escrow.sql) APPENDED this one column: false means the guard refuses a
      // wallet transfer that debits this account past zero. It is the database-level half of "a wallet can
      // never go negative"; the provider roles and the two counter-leg platform accounts carry true, because
      // D-0049 says a penalty with no balance grows a debt, and those two accounts are owed by design.
      { column_name: 'allows_negative', data_type: 'boolean', is_nullable: 'NO' },
    ]);
    passed++;
    const numericTypes = ['smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision', 'decimal'];
    assert.ok(
      !accountsCols.some((c) => numericTypes.includes(c.data_type)),
      'ledger_accounts must carry no numeric column -- a balance is always SUM(signed_amount), never stored'
    );
    passed++;

    const entriesCols = await cols('ledger_entries');
    assert.deepEqual(entriesCols, [
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'transfer_id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'account_id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'signed_amount', data_type: 'bigint', is_nullable: 'NO' },
      { column_name: 'reason', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'source_type', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'source_id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'reverses_entry_id', data_type: 'uuid', is_nullable: 'YES' },
      { column_name: 'settled_in_run_id', data_type: 'uuid', is_nullable: 'YES' },
      { column_name: 'rate_snapshot', data_type: 'jsonb', is_nullable: 'NO' },
      { column_name: 'actor_profile_id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
    ]);
    passed++;
  }

  // ===========================================================================
  // 2) AUTO-PROVISIONING -- every profile has exactly one ('profile')
  //    account; a brand-new profile gets one immediately, no manual step.
  // ===========================================================================
  {
    const profileCount = Number(await scalar(`select count(*)::int from public.profiles`));
    const profileAccountCount = Number(await scalar(`select count(*)::int from public.ledger_accounts where kind = 'profile'`));
    assert.equal(profileAccountCount, profileCount, 'every profile must have exactly one profile-kind ledger account');
    passed++;

    const fresh = crypto.randomUUID();
    await db.exec(`insert into auth.users values ('${fresh}','{"name":"Fresh Profile","mobile":"09197000006","user_type":"owner"}')`);
    const freshAccount = await accountOf(fresh);
    assert.ok(freshAccount, 'a brand-new profile must get a ledger account immediately, with no manual step');
    passed++;
  }

  // ===========================================================================
  // 3) PLATFORM ACCOUNTS -- exactly the expected codes, all profile_id null.
  //    F2c (202611080000) seeded platform.provider_earnings and platform.penalties,
  //    F4 (202611100000_ledger_wallet_admin.sql) seeded platform.manual_adjustments,
  //    the counter-leg of the admin charge/withdraw entry (osaa/specs/finance.md
  //    section 10), and F5 (202611110000_ledger_shop_escrow.sql) seeded
  //    platform.shop, the shop MODULE's own wallet -- the account the buyer's
  //    wallet payment lands in and the escrow is held in until release (D-0050),
  //    so the full schema has six. This group runs on the full database, so it
  //    pins six; the one-migration-earlier database is checked in group 15.
  // ===========================================================================
  {
    const rows = (await db.query(`select code, profile_id from public.ledger_accounts where kind = 'platform' order by code`)).rows;
    assert.deepEqual(rows, [
      { code: 'platform.clearing', profile_id: null },
      { code: 'platform.manual_adjustments', profile_id: null },
      { code: 'platform.penalties', profile_id: null },
      { code: 'platform.provider_earnings', profile_id: null },
      { code: 'platform.revenue', profile_id: null },
      { code: 'platform.shop', profile_id: null },
    ]);
    passed++;
  }

  // ===========================================================================
  // 4) UNIQUENESS -- a second account per profile fails, a second account
  //    with the same code fails, and the owner CHECK rejects a mismatched
  //    kind/profile_id/code combination either way.
  // ===========================================================================
  await deny(`insert into public.ledger_accounts (profile_id, kind) values ('${P1}','profile')`, /ledger_accounts_profile_unique/);
  await deny(`insert into public.ledger_accounts (kind, code) values ('platform','platform.revenue')`, /ledger_accounts_code_unique/);
  await deny(
    `insert into public.ledger_accounts (kind, profile_id, code) values ('profile','${crypto.randomUUID()}','platform.extra')`,
    /ledger_accounts_owner_check/
  );
  await deny(
    `insert into public.ledger_accounts (kind, code, profile_id) values ('platform','platform.extra2','${crypto.randomUUID()}')`,
    /ledger_accounts_owner_check/
  );

  // ===========================================================================
  // 5) THE HELPER WRITES BOTH LEGS -- one balanced two-leg call returns a
  //    transfer_id, writes exactly two rows sharing it, and every balance
  //    equals SUM(signed_amount), checked against an independent expectation.
  // ===========================================================================
  {
    const before1 = await balanceOf(acctP1);
    const beforeClearing = await balanceOf(acctClearing);
    const transferId = await post(P1, 'manual', crypto.randomUUID(), 'test_helper_writes_both_legs',
      [leg(acctP1, 1000), leg(acctClearing, -1000)]);
    assert.ok(transferId, 'post_ledger_transfer must return a transfer_id');
    passed++;
    const rows = (await db.query(`select account_id, signed_amount from public.ledger_entries where transfer_id = '${transferId}' order by account_id`)).rows;
    assert.equal(rows.length, 2, 'exactly two rows must share the returned transfer_id');
    passed++;
    assert.equal(await balanceOf(acctP1), before1 + 1000, "the provider's balance must equal the independently expected total");
    passed++;
    assert.equal(await balanceOf(acctClearing), beforeClearing - 1000, "platform.clearing's balance must equal the independently expected total");
    passed++;
  }

  // ===========================================================================
  // 6) ZERO-SUM -- after several different posts, every transfer_id sums to
  //    exactly zero.
  // ===========================================================================
  await post(P2, 'manual', crypto.randomUUID(), 'test_zero_sum_a', [leg(acctP2, 500), leg(acctRevenue, -500)]);
  await post(P1, 'manual', crypto.randomUUID(), 'test_zero_sum_b', [leg(acctP1, 250), leg(acctP2, -100), leg(acctRevenue, -150)]);
  {
    const unbalancedCount = Number(await scalar(
      `select count(*)::int from (
         select transfer_id from public.ledger_entries group by transfer_id having sum(signed_amount) <> 0
       ) x`
    ));
    assert.equal(unbalancedCount, 0, 'every transfer_id in the table must sum to exactly zero');
    passed++;
  }

  // ===========================================================================
  // 7) REFUSALS -- each is refused with no rows written.
  // ===========================================================================
  const srcManual = () => crypto.randomUUID();
  await postDeny(P1, 'manual', srcManual(), 'test_unbalanced', [leg(acctP1, 100), leg(acctClearing, -90)], { note: 'x' }, /unbalanced_transfer/);
  await postDeny(P1, 'manual', srcManual(), 'test_zero_leg', [leg(acctP1, 100), leg(acctClearing, 0)], { note: 'x' }, /invalid_leg/);
  await postDeny(P1, 'manual', srcManual(), 'test_one_leg', [leg(acctP1, 100)], { note: 'x' }, /invalid_legs/);
  await postDeny(P1, 'manual', srcManual(), 'test_malformed_leg',
    [{ account_id: acctP1, signed_amount: 100, extra: 'nope' }, leg(acctClearing, -100)], { note: 'x' }, /invalid_leg/);
  await postDeny(P1, 'manual', srcManual(), 'test_unknown_account', [leg(crypto.randomUUID(), 100), leg(acctClearing, -100)], { note: 'x' }, /account_not_found/);
  await postDeny(P1, 'manual', srcManual(), 'test_inactive_account', [leg(acctP3, 100), leg(acctClearing, -100)], { note: 'x' }, /account_not_found/);
  await postDeny(P1, 'bogus_source', srcManual(), 'test_bad_source_type', [leg(acctP1, 100), leg(acctClearing, -100)], { note: 'x' }, /invalid_source_type/);
  await postDeny(P1, 'manual', srcManual(), '', [leg(acctP1, 100), leg(acctClearing, -100)], { note: 'x' }, /invalid_reason/);
  await postDeny(P1, 'manual', srcManual(), 'x'.repeat(65), [leg(acctP1, 100), leg(acctClearing, -100)], { note: 'x' }, /invalid_reason/);
  await postDeny(P1, 'manual', srcManual(), 'test_empty_snapshot', [leg(acctP1, 100), leg(acctClearing, -100)], {}, /invalid_rate_snapshot/);
  await postDeny(P1, 'manual', srcManual(), 'test_array_snapshot', [leg(acctP1, 100), leg(acctClearing, -100)], ['not', 'an', 'object'], /invalid_rate_snapshot/);

  // ===========================================================================
  // 8) DUPLICATE POST THROUGH THE HELPER -- the identical call twice raises
  //    duplicate_ledger_post with no row-count change; a different reason
  //    for the same event posts fine; a reversal (exempt from the dedup
  //    index) posts fine too.
  // ===========================================================================
  let dupLeg1Id, dupLeg2Id;
  {
    const dupSource = crypto.randomUUID();
    const transferId = await post(P1, 'manual', dupSource, 'test_dup_reason', [leg(acctP1, 1000), leg(acctClearing, -1000)]);
    const rows = (await db.query(`select id, account_id from public.ledger_entries where transfer_id = '${transferId}' order by account_id`)).rows;
    [dupLeg1Id, dupLeg2Id] = [rows.find((r) => r.account_id === acctP1).id, rows.find((r) => r.account_id === acctClearing).id];

    await postDeny(P1, 'manual', dupSource, 'test_dup_reason', [leg(acctP1, 1000), leg(acctClearing, -1000)], { note: 'retry' }, /duplicate_ledger_post/);

    // A different reason for the same event is a DIFFERENT dedup key -- posts fine.
    const secondTransferId = await post(P1, 'manual', dupSource, 'test_dup_reason_other', [leg(acctP1, 1000), leg(acctClearing, -1000)]);
    assert.ok(secondTransferId && secondTransferId !== transferId, 'the same event under a different reason must post as a new transfer');
    passed++;

    // A reversal row IS exempt from the dedup index -- proven by posting it
    // THROUGH the helper (the ONLY writer, reversals included): each leg
    // carries its own reverses_entry_id pointing back at the original leg on
    // the same account, and the pair still balances to zero.
    const reversalTransferId = await post(P1, 'manual', dupSource, 'test_dup_reason_reversed', [
      reversalLeg(acctP1, -1000, dupLeg1Id),
      reversalLeg(acctClearing, 1000, dupLeg2Id),
    ], { note: 'reversal' });
    assert.ok(reversalTransferId, 'the helper must accept and post a balanced reversal leg pair');
    passed++;
  }

  // ===========================================================================
  // 9) SETTLEMENT -- the single legal transition works; a second update
  //    changing it, or nulling it, raises settled_in_run_id_is_immutable; a
  //    no-op re-set of the same value writes nothing new; changing any
  //    economic column raises ledger_entries_are_append_only; DELETE always
  //    does too. Done as the owner (RLS bypassed) -- the schema fact itself
  //    is under test.
  // ===========================================================================
  {
    const transferId = await post(P1, 'manual', crypto.randomUUID(), 'test_settlement', [leg(acctP1, 1000), leg(acctClearing, -1000)]);
    const [legA] = (await db.query(`select id, signed_amount from public.ledger_entries where transfer_id = '${transferId}' and account_id = '${acctP1}'`)).rows;
    // F3a added the foreign key F1 deliberately left out (ledger_entries.settled_in_run_id ->
    // public.settlement_runs), so a run id must now name a REAL run row. The transitions under
    // test are F1's own triggers, not the FK: two real rows are created so the "a DIFFERENT run
    // id is refused" case below is refused by the trigger and not by the foreign key.
    const runId = (await db.query(`insert into public.settlement_runs (provider_id, account_id, period) values ('${P1}', '${acctP1}', '2026-01-01') returning id`)).rows[0].id;
    const otherRunId = (await db.query(`insert into public.settlement_runs (provider_id, account_id, period) values ('${P1}', '${acctP1}', '2026-01-02') returning id`)).rows[0].id;

    await db.exec(`update public.ledger_entries set settled_in_run_id = '${runId}' where id = '${legA.id}'`);
    const settledRow = (await db.query(`select settled_in_run_id from public.ledger_entries where id = '${legA.id}'`)).rows[0];
    assert.equal(settledRow.settled_in_run_id, runId, 'the single legal null -> run id transition must succeed');
    passed++;

    await deny(`update public.ledger_entries set settled_in_run_id = '${otherRunId}' where id = '${legA.id}'`, /settled_in_run_id_is_immutable/);
    await deny(`update public.ledger_entries set settled_in_run_id = null where id = '${legA.id}'`, /settled_in_run_id_is_immutable/);

    await db.exec(`update public.ledger_entries set settled_in_run_id = '${runId}' where id = '${legA.id}'`);
    const afterNoop = (await db.query(`select settled_in_run_id, signed_amount from public.ledger_entries where id = '${legA.id}'`)).rows[0];
    assert.equal(afterNoop.settled_in_run_id, runId, 're-setting the SAME run id must be a legal no-op');
    passed++;
    assert.equal(Number(afterNoop.signed_amount), Number(legA.signed_amount), 'the no-op re-settle must leave every other column unchanged');
    passed++;

    await deny(`update public.ledger_entries set signed_amount = signed_amount + 1 where id = '${legA.id}'`, /ledger_entries_are_append_only/);
    await deny(`update public.ledger_entries set reason = 'changed' where id = '${legA.id}'`, /ledger_entries_are_append_only/);
    await deny(`update public.ledger_entries set account_id = '${acctP2}' where id = '${legA.id}'`, /ledger_entries_are_append_only/);
    await deny(`update public.ledger_entries set rate_snapshot = '{"tampered":true}'::jsonb where id = '${legA.id}'`, /ledger_entries_are_append_only/);
    await deny(`delete from public.ledger_entries where id = '${legA.id}'`, /ledger_entries_are_append_only/);

    const stillThere = (await db.query(`select signed_amount, settled_in_run_id from public.ledger_entries where id = '${legA.id}'`)).rows[0];
    assert.equal(Number(stillThere.signed_amount), Number(legA.signed_amount), 'the row must be fully unchanged after every refused update/delete');
    assert.equal(stillThere.settled_in_run_id, runId);
    passed++;
  }

  // ===========================================================================
  // 10) REVERSAL FIDELITY -- a correct reversal posts through the helper
  //     (proven in group 8 above); a wrong amount, a wrong account, a
  //     reversal of a reversal, and a second reversal of the same leg are
  //     each refused -- these go in directly (bypassing the helper) because
  //     the reversal-fidelity trigger must hold even for a caller that
  //     bypasses post_ledger_transfer entirely (migration header, mechanism 4).
  // ===========================================================================
  await deny(
    `insert into public.ledger_entries (transfer_id, account_id, signed_amount, reason, source_type, source_id, rate_snapshot, actor_profile_id, reverses_entry_id)
     values ('${crypto.randomUUID()}', '${acctP1}', -999, 'test_bad_reversal_amount', 'manual', '${crypto.randomUUID()}', '{}'::jsonb, '${P1}', '${dupLeg1Id}')`,
    /invalid_reversal/
  );
  await deny(
    `insert into public.ledger_entries (transfer_id, account_id, signed_amount, reason, source_type, source_id, rate_snapshot, actor_profile_id, reverses_entry_id)
     values ('${crypto.randomUUID()}', '${acctP2}', -1000, 'test_bad_reversal_account', 'manual', '${crypto.randomUUID()}', '{}'::jsonb, '${P1}', '${dupLeg1Id}')`,
    /invalid_reversal/
  );
  {
    // dupLeg1Id's own reversal row (created in group 8) is itself a
    // reversal -- reversing IT must fail as reversal_of_reversal.
    const reversalOfLeg1 = await scalar(`select id from public.ledger_entries where reverses_entry_id = '${dupLeg1Id}'`);
    await deny(
      `insert into public.ledger_entries (transfer_id, account_id, signed_amount, reason, source_type, source_id, rate_snapshot, actor_profile_id, reverses_entry_id)
       values ('${crypto.randomUUID()}', '${acctP1}', 1000, 'test_reversal_of_reversal', 'manual', '${crypto.randomUUID()}', '{}'::jsonb, '${P1}', '${reversalOfLeg1}')`,
      /reversal_of_reversal/
    );
  }
  {
    // dupLeg1Id already has exactly one reversal (group 8) -- a second one,
    // even a CORRECT one (same account/amount/source as the original, which
    // is what reversal_fidelity itself demands), collides with
    // ledger_entries_reversal_unique instead. Reusing the original's own
    // source_type/source_id (not a fresh one) is what makes this reach the
    // unique index rather than tripping invalid_reversal first.
    const dupLeg1Source = (await db.query(`select source_type, source_id from public.ledger_entries where id = '${dupLeg1Id}'`)).rows[0];
    await deny(
      `insert into public.ledger_entries (transfer_id, account_id, signed_amount, reason, source_type, source_id, rate_snapshot, actor_profile_id, reverses_entry_id)
       values ('${crypto.randomUUID()}', '${acctP1}', -1000, 'test_second_reversal_same_leg', '${dupLeg1Source.source_type}', '${dupLeg1Source.source_id}', '{}'::jsonb, '${P1}', '${dupLeg1Id}')`,
      /ledger_entries_reversal_unique/
    );
  }

  // ===========================================================================
  // 11) RATE_SNAPSHOT IS A SNAPSHOT -- posted with a real commission row's
  //     values, then the rate row changes, then the entry is byte-identical
  //     to what was posted. Plus the structural half: no FK to a rate table.
  // ===========================================================================
  {
    const COMMISSION_RATE_ID = 'a6000000-0000-4000-8000-000000000001'; // seeded by 202610140000, code = 'commission'
    const rateBefore = (await db.query(`select id, rate_percent from public.hauling_financial_rates where id = '${COMMISSION_RATE_ID}'`)).rows[0];
    const snapshot = { commission_rate_id: rateBefore.id, commission_percent: Number(rateBefore.rate_percent) };
    const transferId = await post(P1, 'hauling_request', crypto.randomUUID(), 'test_rate_snapshot', [leg(acctP1, 100), leg(acctRevenue, -100)], snapshot);
    const postedEntry = (await db.query(`select rate_snapshot, signed_amount from public.ledger_entries where transfer_id = '${transferId}' and account_id = '${acctP1}'`)).rows[0];

    await db.exec(`update public.hauling_financial_rates set rate_percent = 99.00 where id = '${COMMISSION_RATE_ID}'`);

    const postedEntryAfterRateChange = (await db.query(`select rate_snapshot, signed_amount from public.ledger_entries where transfer_id = '${transferId}' and account_id = '${acctP1}'`)).rows[0];
    assert.deepEqual(postedEntryAfterRateChange.rate_snapshot, postedEntry.rate_snapshot, "an entry's rate_snapshot must stay byte-identical to what was posted, regardless of later rate edits");
    passed++;
    assert.deepEqual(postedEntryAfterRateChange.rate_snapshot, snapshot, 'the stored snapshot must equal the exact object that was posted');
    passed++;
    assert.equal(Number(postedEntryAfterRateChange.signed_amount), Number(postedEntry.signed_amount));
    passed++;

    await db.exec(`update public.hauling_financial_rates set rate_percent = ${rateBefore.rate_percent} where id = '${COMMISSION_RATE_ID}'`); // leave fixtures as found

    const fkCount = Number(await scalar(`
      select count(*)::int from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      join pg_class rt on rt.oid = c.confrelid
      where n.nspname = 'public' and t.relname = 'ledger_entries' and c.contype = 'f'
        and rt.relname in ('hauling_financial_rates', 'onsite_pricing_rules')
    `));
    assert.equal(fkCount, 0, 'ledger_entries must carry no foreign key to a live rate table -- nothing may re-read a live rate at report time');
    passed++;
  }

  // ===========================================================================
  // 12) RLS -- the account owner reads their own account and its entries; a
  //     different signed-in account reads zero rows from both; an admin
  //     reads everything; anon reads nothing at all (no grant exists for
  //     anon). Write side: insert/update/delete on both tables are refused
  //     for a plain user AND an admin; authenticated cannot execute
  //     post_ledger_transfer at all.
  // ===========================================================================
  {
    const ownAccounts = await as(P1, () => scalar(`select count(*)::int from public.ledger_accounts where profile_id = '${P1}'`));
    assert.equal(Number(ownAccounts), 1, 'the account owner must read their own account');
    passed++;
    const ownEntries = await as(P1, () => scalar(`select count(*)::int from public.ledger_entries where account_id = '${acctP1}'`));
    assert.ok(Number(ownEntries) > 0, 'the account owner must read their own entries');
    passed++;

    const otherAccounts = await as(OTHER, () => scalar(`select count(*)::int from public.ledger_accounts where profile_id = '${P1}'`));
    assert.equal(Number(otherAccounts), 0, "a different signed-in account must read zero of another profile's accounts");
    passed++;
    const otherEntries = await as(OTHER, () => scalar(`select count(*)::int from public.ledger_entries where account_id = '${acctP1}'`));
    assert.equal(Number(otherEntries), 0, "a different signed-in account must read zero of another profile's entries");
    passed++;

    const adminAccounts = await as(ADMIN, () => scalar(`select count(*)::int from public.ledger_accounts`));
    assert.ok(Number(adminAccounts) >= 5, 'an admin must read every account, including platform accounts');
    passed++;
    const adminEntries = await as(ADMIN, () => scalar(`select count(*)::int from public.ledger_entries`));
    assert.ok(Number(adminEntries) > 0, 'an admin must read every entry');
    passed++;

    await as(null, () => deny(`select count(*)::int from public.ledger_accounts`));
    await as(null, () => deny(`select count(*)::int from public.ledger_entries`));

    for (const uid of [P1, ADMIN]) {
      await as(uid, () => deny(`insert into public.ledger_accounts (profile_id, kind) values ('${crypto.randomUUID()}','profile')`));
      await as(uid, () => deny(`update public.ledger_accounts set is_active = false where id = '${acctP2}'`));
      await as(uid, () => deny(`delete from public.ledger_accounts where id = '${acctP2}'`));
      await as(uid, () => deny(
        `insert into public.ledger_entries (transfer_id, account_id, signed_amount, reason, source_type, source_id, rate_snapshot, actor_profile_id)
         values ('${crypto.randomUUID()}','${acctP1}',1,'x','manual','${crypto.randomUUID()}','{"a":1}'::jsonb,'${uid}')`
      ));
      await as(uid, () => deny(`update public.ledger_entries set reason = 'x' where id = '${dupLeg1Id}'`));
      await as(uid, () => deny(`delete from public.ledger_entries where id = '${dupLeg1Id}'`));
      await as(uid, () => deny(
        `select post_ledger_transfer('manual','${crypto.randomUUID()}','x',${jsonbLit([leg(acctP1, 1), leg(acctClearing, -1)])},${jsonbLit({ a: 1 })})`,
        /permission denied/
      ));
    }
  }

  // ===========================================================================
  // 13) CUTOVER MARKER -- exactly one ledger_cutover_at row whose value
  //     parses as an ISO-8601 UTC timestamp; admin reads it, a plain user
  //     and anon do not; no write grant to anyone; plus the structural
  //     assertion that the migration file states NO HISTORICAL BACKFILL.
  // ===========================================================================
  {
    const rows = (await db.query(`select key, value from public.ledger_settings where key = 'ledger_cutover_at'`)).rows;
    assert.equal(rows.length, 1, 'exactly one ledger_cutover_at row must exist');
    passed++;
    const parsed = new Date(rows[0].value);
    assert.ok(!Number.isNaN(parsed.getTime()), 'ledger_cutover_at must parse as a valid timestamp');
    passed++;
    assert.match(rows[0].value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'ledger_cutover_at must be ISO-8601 UTC, ending in Z');
    passed++;

    const adminRead = await as(ADMIN, () => scalar(`select count(*)::int from public.ledger_settings where key = 'ledger_cutover_at'`));
    assert.equal(Number(adminRead), 1, 'an admin must read the cutover marker');
    passed++;
    const otherRead = await as(OTHER, () => scalar(`select count(*)::int from public.ledger_settings where key = 'ledger_cutover_at'`));
    assert.equal(Number(otherRead), 0, 'a plain signed-in user must not read the cutover marker');
    passed++;
    await as(null, () => deny(`select count(*)::int from public.ledger_settings`));

    for (const uid of [OTHER, ADMIN]) {
      await as(uid, () => deny(`insert into public.ledger_settings (key, value) values ('x','y')`));
      await as(uid, () => deny(`update public.ledger_settings set value = 'y' where key = 'ledger_cutover_at'`));
      await as(uid, () => deny(`delete from public.ledger_settings where key = 'ledger_cutover_at'`));
    }

    const migrationText = fs.readFileSync(path.join(projectRoot, 'supabase/migrations', MIGRATION_FILE), 'utf8');
    assert.match(migrationText, /NO HISTORICAL BACKFILL/, "the migration's header must state NO HISTORICAL BACKFILL in those words");
    passed++;
  }

  // ===========================================================================
  // 14) RECONCILIATION -- kept as a tracked string constant, the same
  //     canonical query F2a's reconciliation screen/report will use: for
  //     every terminal (status = 'done'), cash-paid (payment_method =
  //     'cash' and cash_collected) hauling_requests/onsite_requests row, the
  //     number of DISTINCT transfer_ids among its entries carrying a leg
  //     with reason 'job_cash_collected' must be exactly 1.
  // ===========================================================================
  const RECONCILIATION_SQL = `
    with cash_jobs as (
      select 'hauling_request'::text as source_type, id as source_id
        from public.hauling_requests
       where status = 'done' and payment_method = 'cash' and cash_collected
      union all
      select 'onsite_request'::text as source_type, id as source_id
        from public.onsite_requests
       where status = 'done' and payment_method = 'cash' and cash_collected
    )
    select j.source_type, j.source_id,
           count(distinct e.transfer_id) filter (where e.reason = 'job_cash_collected') as collection_groups
      from cash_jobs j
      left join public.ledger_entries e
        on e.source_type = j.source_type and e.source_id = j.source_id
     group by j.source_type, j.source_id`;

  {
    const SEDAN = 'a1000000-0000-4000-8000-000000000001';
    const FLATBED = 'a2000000-0000-4000-8000-000000000001';
    const haulingFixture = (status, paymentMethod, cashCollected, providerId) => {
      const id = crypto.randomUUID();
      const acceptanceFields = ['accepted', 'en_route', 'arrived', 'in_progress', 'done'].includes(status)
        ? `'${providerId ?? P1}', 500000, now(), '${paymentMethod ?? 'cash'}'`
        : `null, null, null, ${paymentMethod ? `'${paymentMethod}'` : 'null'}`;
      return { id, sql: `
        insert into public.hauling_requests (
          id, requester_id, vehicle_type_id, is_movable, hauling_vehicle_type_id,
          origin_lat, origin_lng, destination_mode, destination_lat, destination_lng,
          scope, distance_km, quoted_price_toman, provider_id, accepted_price_toman,
          accepted_at, payment_method, status, cash_collected
        ) values (
          '${id}', '${OTHER}', '${SEDAN}', true, '${FLATBED}',
          35.70, 51.33, 'map_point', 35.72, 51.35,
          'intracity', 10, 500000, ${acceptanceFields}, '${status}', ${cashCollected}
        )` };
    };
    async function run(fixture) { await db.exec(fixture.sql); return fixture.id; }

    // (a) a correct job -- one job_cash_collected group -- reported clean.
    const cleanJobId = await run(haulingFixture('done', 'cash', true, P1));
    await post(P1, 'hauling_request', cleanJobId, 'job_cash_collected', [leg(acctP1, 500000), leg(acctClearing, -500000)]);

    // (b) terminal cash-paid, no group at all -- reported missing.
    const missingJobId = await run(haulingFixture('done', 'cash', true, P1));

    // (c) terminal cash-paid, TWO job_cash_collected groups (a real-world
    //     anomaly this query exists to catch) -- reported duplicated. Two
    //     DIFFERENT account pairs so the dedup index does not itself block
    //     the second group from being posted.
    const duplicateJobId = await run(haulingFixture('done', 'cash', true, P1));
    await post(P1, 'hauling_request', duplicateJobId, 'job_cash_collected', [leg(acctP1, 500000), leg(acctClearing, -500000)]);
    await post(P2, 'hauling_request', duplicateJobId, 'job_cash_collected', [leg(acctP2, 500000), leg(acctRevenue, -500000)]);

    // (d) a job carrying a cancellation_penalty group AND a reversal group
    //     ON TOP of its one legitimate collection group -- still clean.
    const withExtrasJobId = await run(haulingFixture('done', 'cash', true, P1));
    await post(P1, 'hauling_request', withExtrasJobId, 'job_cash_collected', [leg(acctP1, 500000), leg(acctClearing, -500000)]);
    const penaltyTransferId = await post(P1, 'hauling_request', withExtrasJobId, 'cancellation_penalty', [leg(acctP1, -50000), leg(acctRevenue, 50000)]);
    const [penaltyLegP1] = (await db.query(`select id from public.ledger_entries where transfer_id = '${penaltyTransferId}' and account_id = '${acctP1}'`)).rows;
    const [penaltyLegRevenue] = (await db.query(`select id from public.ledger_entries where transfer_id = '${penaltyTransferId}' and account_id = '${acctRevenue}'`)).rows;
    const penaltyReversalTransferId = crypto.randomUUID();
    await db.exec(`
      insert into public.ledger_entries (transfer_id, account_id, signed_amount, reason, source_type, source_id, rate_snapshot, actor_profile_id, reverses_entry_id)
      values
        ('${penaltyReversalTransferId}', '${acctP1}', 50000, 'cancellation_penalty_reversed', 'hauling_request', '${withExtrasJobId}', '{}'::jsonb, '${P1}', '${penaltyLegP1.id}'),
        ('${penaltyReversalTransferId}', '${acctRevenue}', -50000, 'cancellation_penalty_reversed', 'hauling_request', '${withExtrasJobId}', '{}'::jsonb, '${P1}', '${penaltyLegRevenue.id}')`);

    // Universe check -- a dispatching, a cancelled, and an online job, each
    // WITH a job_cash_collected-reason group posted against it anyway, are
    // not reported at all (the query's WHERE clause, not the group count,
    // is what must exclude them).
    const dispatchingJobId = await run(haulingFixture('dispatching', null, false));
    await post(P1, 'hauling_request', dispatchingJobId, 'job_cash_collected', [leg(acctP1, 1), leg(acctClearing, -1)]);
    const cancelledJobId = await run(haulingFixture('cancelled', null, false));
    await post(P1, 'hauling_request', cancelledJobId, 'job_cash_collected', [leg(acctP1, 1), leg(acctClearing, -1)]);
    const onlineJobId = await run(haulingFixture('done', 'online', false, P1));
    await post(P1, 'hauling_request', onlineJobId, 'job_cash_collected', [leg(acctP1, 1), leg(acctClearing, -1)]);

    const report = (await db.query(RECONCILIATION_SQL)).rows;
    const byId = Object.fromEntries(report.map((r) => [r.source_id, Number(r.collection_groups)]));

    assert.equal(byId[cleanJobId], 1, 'a correctly posted job must be reported clean (exactly one group)');
    passed++;
    assert.equal(byId[missingJobId], 0, 'a terminal cash job with no collection group must be reported missing');
    passed++;
    assert.equal(byId[duplicateJobId], 2, 'a terminal cash job with two collection groups must be reported duplicated');
    passed++;
    assert.equal(byId[withExtrasJobId], 1, 'a job with an unrelated penalty group and its reversal must STILL be reported clean');
    passed++;
    for (const excludedId of [dispatchingJobId, cancelledJobId, onlineJobId]) {
      assert.ok(!(excludedId in byId), 'a non-terminal or non-cash job must never appear in the reconciliation universe, regardless of any posted groups');
      passed++;
    }
  }

  // ===========================================================================
  // 16) NO CONSUMERS, NO BEHAVIOUR WIRING -- structural, on the main `db`
  //     (group 15's rollback-fidelity test uses its own isolated database,
  //     below, so it cannot disturb this check or vice versa).
  // ===========================================================================
  {
    // F1 asserted that NOTHING mentioned post_ledger_transfer. F2a is the step
    // that deliberately makes that false. The measured truth is narrower than
    // "every posting function": the five private helpers below are the only
    // callers of the helper by name, and the public RPCs reach it THROUGH
    // them (each one calls private.post_ledger_cash_collection /
    // _provider_earnings / _job_commission / _penalty / reverse_ledger_transfer),
    // so the second pin below states that contract explicitly instead of hiding
    // it behind a substring that does not actually match. Together they are the
    // conscious list: a new writer must be an edit here, never a silent addition.
    // F2c added private.post_ledger_provider_earnings (the provider's earned share).
    // F3b added public.admin_correct_settled_entry: the post-settlement correction path
    // calls the central helper DIRECTLY (it is a public, admin-gated RPC, so it has no
    // private posting helper of its own). Registering it here is exactly what this pin
    // asks for -- a new writer is an edit to this list, never a silent addition.
    // F4 added public.admin_manual_wallet_entry (migration 202611100000_ledger_wallet_admin.sql):
    // it is F4's manual charge/withdraw entry, the one new ledger writer that step adds, and it
    // posts through public.post_ledger_transfer like every other consumer above.
    // F5 added public.pay_order_from_wallet and public.admin_release_order_escrow (migration
    // 202611110000_ledger_shop_escrow.sql): the wallet payment into the module's escrow account and
    // the release that pays the sellers and the commission. Its third writer,
    // admin_refund_order_escrow, is deliberately NOT in this list: it posts through
    // private.reverse_ledger_transfer, which is already registered here, exactly like
    // admin_decide_return's refund path.
    const EXPECTED_POSTING_CONSUMERS = [
      'private.post_ledger_cash_collection',
      'private.post_ledger_job_commission',
      'private.post_ledger_penalty',
      'private.post_ledger_provider_earnings',
      'private.reverse_ledger_transfer',
      'public.admin_correct_settled_entry',
      'public.admin_manual_wallet_entry',
      'public.admin_release_order_escrow',
      'public.pay_order_from_wallet',
    ].sort();
    const consumers = (await db.query(
      `select n.nspname || '.' || p.proname as name
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public','private')
          and p.prosrc ~ 'post_ledger_transfer'
          and p.proname <> 'post_ledger_transfer'`
    )).rows.map((r) => r.name).sort();
    assert.deepEqual(consumers, EXPECTED_POSTING_CONSUMERS,
      `the pinned F2a posting call sites must be exactly these -- measured: ${consumers.join(', ')}`);
    passed++;

    // F5 added public.admin_refund_order_escrow (202611110000_ledger_shop_escrow.sql): the
    // pre-release refund reverses the buyer's payment transfer, so it posts through
    // private.reverse_ledger_transfer -- the same helper admin_decide_return's refund uses.
    const EXPECTED_POSTING_RPCS = [
      'public.admin_decide_return',
      'public.admin_refund_order_escrow',
      'public.cancel_hauling_request',
      'public.complete_hauling_job',
      'public.onsite_job_complete',
      'public.rescuer_cancel_hauling_request',
    ].sort();
    const postingRpcs = (await db.query(
      `select n.nspname || '.' || p.proname as name
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosrc ~ 'post_ledger_(cash_collection|job_commission|penalty|provider_earnings)|reverse_ledger_transfer'`
    )).rows.map((r) => r.name).sort();
    assert.deepEqual(postingRpcs, EXPECTED_POSTING_RPCS,
      `the pinned F2a public RPCs that post through the private helpers must be exactly these -- measured: ${postingRpcs.join(', ')}`);
    passed++;

    const EXPECTED_NEW_TRIGGERS = [
      'profiles:mycar_create_ledger_account',
      'ledger_entries:ledger_entries_guard_settled',
      'ledger_entries:ledger_entries_append_only',
      'ledger_entries:ledger_entries_balanced_transfer',
      'ledger_entries:ledger_entries_reversal_fidelity',
      // F5 (202611110000_ledger_shop_escrow.sql) added two more, and this list is the pin that makes
      // adding a trigger to either table a conscious edit:
      //   ledger_accounts:mycar_ledger_account_negative_default -- sets allows_negative from the
      //     profile's role at insert time, so a later account is governed by the same rule;
      //   ledger_entries:ledger_entries_non_negative_guard -- the DEFERRED constraint trigger that
      //     refuses a wallet transfer debiting a guarded account past zero.
      'ledger_accounts:mycar_ledger_account_negative_default',
      'ledger_entries:ledger_entries_non_negative_guard',
    ].sort();
    const triggerRows = (await db.query(`
      select c.relname as table_name, tg.tgname as trigger_name
        from pg_trigger tg
        join pg_class c on c.oid = tg.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname in ('profiles','ledger_accounts','ledger_entries','ledger_settings')
         and not tg.tgisinternal
       order by c.relname, tg.tgname`)).rows;
    const foundTriggers = triggerRows.map((r) => `${r.table_name}:${r.trigger_name}`).sort();
    assert.deepEqual(foundTriggers, EXPECTED_NEW_TRIGGERS, 'this table pair must carry exactly the pinned triggers and no others');
    passed++;

    // No trigger on any job table changed from what pre-existed this
    // migration (hauling_requests_locked_price_immutable /
    // onsite_requests_locked_price_immutable, from 202611020000 --
    // unrelated to this step). service_requests carries none. F5 added exactly one to orders:
    // mycar_orders_stamp_delivered_at, which stamps delivered_at the first time an order becomes
    // delivered -- the clock the shop escrow release window is counted from. It writes no ledger row
    // (only a column of the order it is already updating), so it does not touch this ledger's rules.
    const EXPECTED_JOB_TABLE_TRIGGERS = [
      'hauling_requests:hauling_requests_locked_price_immutable',
      'onsite_requests:onsite_requests_locked_price_immutable',
      'orders:mycar_orders_stamp_delivered_at',
    ].sort();
    const jobTriggerRows = (await db.query(`
      select c.relname as table_name, tg.tgname as trigger_name
        from pg_trigger tg
        join pg_class c on c.oid = tg.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname in ('hauling_requests','onsite_requests','service_requests','orders')
         and not tg.tgisinternal
       order by c.relname, tg.tgname`)).rows;
    const foundJobTriggers = jobTriggerRows.map((r) => `${r.table_name}:${r.trigger_name}`).sort();
    assert.deepEqual(foundJobTriggers, EXPECTED_JOB_TABLE_TRIGGERS, 'a job-table trigger change must be a conscious edit to this list');
    passed++;
  }

  await db.close();

  // ===========================================================================
  // 15) ROLLBACK FIDELITY -- apply ظçْ assert ظçْ roll back ظçْ assert clean, on
  //     its OWN isolated database so this destructive sequence cannot
  //     disturb anything checked above.
  // ===========================================================================
  await rollbackFidelity(projectRoot);

  console.log(`${passed} ledger core assertions passed.`);
}

// isLedgerRelated marks the lines that belong to the ledger surface. The filtered
// comparison in rollbackFidelity runs on databases whose HEAD is 202611040000 itself
// (see there), so no later migration's objects exist in them. At that head the helper
// only removes F1's own ledger lines. It is kept on purpose: it states what the
// assertion means -- 202611040000 may only ever add ledger-named objects, and every
// non-ledger line of the schema must be untouched by it. Removing it would silently
// widen that assertion.
function isLedgerRelated(line) {
  return (
    line.includes('ledger_') ||
    line.includes('post_ledger_') ||
    line.includes('reverse_ledger_transfer') ||
    line.includes('ledger_postings')
  );
}

async function schemaSnapshot(dbInstance) {
  const rows = [];
  const push = (kind, obj) => rows.push(JSON.stringify({ kind, ...obj }));

  const cols = await dbInstance.query(`
    select table_schema, table_name, column_name, data_type, udt_name, character_maximum_length, column_default, is_nullable
      from information_schema.columns
     where table_schema in ('public','private')
     order by table_schema, table_name, column_name`);
  for (const r of cols.rows) push('column', r);

  const cons = await dbInstance.query(`
    select n.nspname as table_schema, t.relname as table_name, c.conname, pg_get_constraintdef(c.oid) as definition
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname in ('public','private')
     order by n.nspname, t.relname, c.conname`);
  for (const r of cons.rows) push('constraint', r);

  const idx = await dbInstance.query(`
    select schemaname, tablename, indexname, indexdef
      from pg_indexes
     where schemaname in ('public','private')
     order by schemaname, tablename, indexname`);
  for (const r of idx.rows) push('index', r);

  const trig = await dbInstance.query(`
    select n.nspname as table_schema, c.relname as table_name, tg.tgname as trigger_name, pg_get_triggerdef(tg.oid) as definition
      from pg_trigger tg
      join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public','private') and not tg.tgisinternal
     order by n.nspname, c.relname, tg.tgname`);
  for (const r of trig.rows) push('trigger', r);

  const pol = await dbInstance.query(`
    select schemaname, tablename, policyname, cmd, roles, qual, with_check
      from pg_policies
     where schemaname in ('public','private')
     order by schemaname, tablename, policyname`);
  for (const r of pol.rows) push('policy', r);

  const tableAcl = await dbInstance.query(`
    select n.nspname as table_schema, c.relname as table_name, c.relacl::text as acl
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public','private') and c.relkind in ('r','v')
     order by n.nspname, c.relname`);
  for (const r of tableAcl.rows) push('table_acl', r);

  const funcs = await dbInstance.query(`
    select n.nspname as schema, p.proname as name, pg_get_function_identity_arguments(p.oid) as args,
           p.prosrc as body, p.prosecdef as security_definer, p.proacl::text as acl
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public','private') and p.prokind = 'f'
     order by n.nspname, p.proname, args`);
  for (const r of funcs.rows) push('function', r);

  const siteSettings = await dbInstance.query(`select key, value from public.site_settings order by key`);
  for (const r of siteSettings.rows) push('site_setting_row', r);

  return rows.sort();
}

async function rollbackFidelity(projectRoot) {
  // F1's rollback is run at F1's OWN head. Every migration that sorts after it may depend on
  // its tables (F3a's settlement_lines references ledger_entries), so the destructive half of
  // this group runs on a database built up to F1. The comparison target is that same database
  // one migration earlier, which is what "exactly clean after the rollback" means here.
  const migDir = path.join(projectRoot, 'supabase/migrations');
  const laterMigrations = fs.readdirSync(migDir).sort().filter((f) => f > MIGRATION_FILE);
  const preDb = await buildSchemaDb(projectRoot, { exclude: laterMigrations.concat([MIGRATION_FILE]) });
  const preSnapshot = await schemaSnapshot(preDb);
  await preDb.close();

  const db = await buildSchemaDb(projectRoot, { exclude: laterMigrations });

  const postSnapshotFull = await schemaSnapshot(db);
  const postSnapshotFiltered = postSnapshotFull.filter((line) => !isLedgerRelated(line));
  // Both sides are filtered with the same predicate. The post-migration database has
  // 202611040000_ledger_core.sql as its HEAD, because a rollback is only executable at
  // its own head: F3a's public.settlement_lines references public.ledger_entries, so
  // F1's tables cannot be dropped on the current head at all. The pre-migration
  // database is one migration earlier. Neither database holds any later migration's
  // objects. The question asked here is the one the assertion message states: did the
  // 202611040000 migration change anything OUTSIDE the ledger objects? The rollback
  // check below is deliberately NOT filtered: at F1's head the whole F1 surface is
  // ledger-named, so there is nothing else to exclude and the schema must come back
  // exactly clean.
  const preSnapshotFiltered = preSnapshot.filter((line) => !isLedgerRelated(line));
  assert.deepEqual(postSnapshotFiltered, preSnapshotFiltered, 'the migration changed something outside the new ledger objects -- F1 must be byte-for-byte behaviour-neutral');
  passed++;

  const rollbackSql = fs.readFileSync(path.join(projectRoot, 'supabase/rollback', ROLLBACK_FILE), 'utf8');
  await db.exec(rollbackSql);

  const afterRollbackSnapshot = await schemaSnapshot(db);
  assert.deepEqual(afterRollbackSnapshot, preSnapshot, 'the schema must be exactly clean (equal to pre-migration) after running the rollback');
  passed++;

  assert.equal((await db.query(`select to_regclass('public.ledger_entries') as r`)).rows[0].r, null);
  assert.equal((await db.query(`select to_regclass('public.ledger_accounts') as r`)).rows[0].r, null);
  assert.equal((await db.query(`select to_regclass('public.ledger_settings') as r`)).rows[0].r, null);
  assert.equal((await db.query(`select to_regprocedure('public.post_ledger_transfer(text,uuid,text,jsonb,jsonb)') as r`)).rows[0].r, null);
  passed++;

  await assert.doesNotReject(() => db.exec(rollbackSql), 'running the rollback file a second time must not error');
  passed++;

  const migrationSql = fs.readFileSync(path.join(projectRoot, 'supabase/migrations', MIGRATION_FILE), 'utf8');
  await assert.doesNotReject(() => db.exec(migrationSql), 're-applying the migration after a rollback must succeed');
  passed++;
  const platformCount = Number((await db.query(`select count(*)::int from public.ledger_accounts where kind = 'platform'`)).rows[0].count);
  assert.equal(platformCount, 2, 're-applying the migration must restore the two platform accounts');
  passed++;

  await db.close();
}

await main();
