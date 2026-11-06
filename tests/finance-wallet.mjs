import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSchemaDb, buildSchemaDb } from './helpers/schema-snapshot.mjs';

// WU-FINANCE-F4: the wallet, the settlement-screen writers, the finance settings RPCs.
// osaa/specs/finance.md section 10 (the wallet, the manual entry) and TD-042 (the paid run
// does not clear the debt; a manual entry does), TD-045 (the settings RPCs), TD-049 (the
// carried-forward signal). This file proves, through the real RPCs: the access denials; the
// balance and the unsettled debt as two separately computed numbers; the warning at exactly
// 40% and the stop at exactly 95%, driven by the ceiling row; the idempotent compute and the
// paid run that moves no entry; the manual charge and withdraw as one balanced transfer each
// with the tracking reference and the reason recorded; the settings RPCs' create, update,
// no-change and refusal paths; and the migration rolling back to exactly the pre-F4 schema.
//
// Dates: the RPCs stamp their rows with now(), so anything the wallet and the ledger do today
// lands on TODAY (the database's UTC date). The cash fixtures are dated P (yesterday).

const MIGRATION_FILE = '202611100000_ledger_wallet_admin.sql';
const ROLLBACK_FILE = '202611100000_ledger_wallet_admin_rollback.sql';

const WALLET_SIG = 'public.admin_wallet_accounts(text,integer,integer,boolean)';
const STATEMENT_SIG = 'public.admin_wallet_statement(uuid,date,date,integer,integer)';
const MANUAL_SIG = 'public.admin_manual_wallet_entry(uuid,text,bigint,text,text)';
const SCHEDULE_SIG = 'public.admin_upsert_settlement_schedule(uuid,time,boolean,text,text)';
const CEILING_SIG = 'public.admin_upsert_ledger_debt_ceiling(text,bigint,numeric,numeric,boolean,text)';
const REPORT_SIG = 'public.admin_finance_report(text,date,date,text)';
const COMPUTE_SIG = 'public.admin_compute_settlement_run(uuid,date)';
const NEW_FUNCTIONS = [WALLET_SIG, STATEMENT_SIG, MANUAL_SIG, SCHEDULE_SIG, CEILING_SIG, REPORT_SIG];

let passed = 0;
let db;
let ADMIN;
let TODAY;
let P;
let mobileCounter = 0;

async function scalar(sql, params) {
  return Object.values((await db.query(sql, params)).rows[0])[0];
}

// `as`: the client path. Sets the PostgREST-style role so the GRANT is exercised.
async function as(uid, fn) {
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub','${uid ?? ''}',false);`);
  try { return await fn(); } finally { await db.exec('reset role'); }
}

async function raisesWith(uid, sql, params, pattern) {
  let message = null;
  try { await as(uid, () => db.query(sql, params)); } catch (err) { message = err.message; }
  assert.notEqual(message, null, `expected the call to raise ${pattern}, but it succeeded`);
  assert.match(message, pattern);
  passed++;
  return message;
}

function parseJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function callJson(uid, sql, params) {
  const raw = (await as(uid, () => db.query(sql, params))).rows[0].r;
  return parseJson(raw);
}

async function seedProfile(userType) {
  const id = crypto.randomUUID();
  const mobile = '09' + String(100000000 + (++mobileCounter)).slice(0, 9);
  // The name carries the uuid, so a wallet search by the uuid finds exactly this account.
  await db.query(
    `insert into auth.users (id, raw_user_meta_data) values ($1, $2::jsonb)`,
    [id, JSON.stringify({ name: `F4 ${userType} ${id}`, mobile, user_type: userType })]);
  const row = (await db.query(`select user_type from public.profiles where id = $1`, [id])).rows[0];
  assert.equal(row?.user_type, userType, 'the create_profile trigger must create the profile with the requested user_type');
  passed++;
  return id;
}

async function accountOf(profileId) {
  return scalar(`select id from public.ledger_accounts where profile_id = $1`, [profileId]);
}

async function platformAccount(code) {
  return scalar(`select id from public.ledger_accounts where code = $1`, [code]);
}

async function balanceOf(accountId) {
  return Number(await scalar(
    `select coalesce(sum(signed_amount), 0)::bigint from public.ledger_entries where account_id = $1`, [accountId]));
}

async function transferSum(transferId) {
  return Number(await scalar(
    `select coalesce(sum(signed_amount), 0)::bigint from public.ledger_entries where transfer_id = $1`, [transferId]));
}

// One transfer written directly (fixture setup, as tests/finance-correction.mjs does).
async function transfer({ actor, sourceType = 'hauling_request', sourceId = crypto.randomUUID(), reason, createdAt = null, legs }) {
  const transferId = crypto.randomUUID();
  const params = [transferId, reason, sourceType, sourceId, actor, createdAt];
  const values = legs.map(([accountId, amount]) => {
    params.push(accountId, amount);
    return `($1::uuid, $${params.length - 1}::uuid, $${params.length}::bigint, $2::text, $3::text, $4::uuid, '{"code":"test"}'::jsonb, $5::uuid, coalesce($6::timestamptz, now()))`;
  });
  await db.query(
    `insert into public.ledger_entries (transfer_id, account_id, signed_amount, reason, source_type, source_id, rate_snapshot, actor_profile_id, created_at)
     values ${values.join(', ')}`,
    params);
  return transferId;
}

// A cash job as F2c posts it: the cash collected (a debt of the full invoice, offset on
// clearing), the provider's own share, and the commission on platform.revenue.
async function cashJob(provider, { invoice, earned, createdAt }) {
  const sourceId = crypto.randomUUID();
  const acct = await accountOf(provider);
  const clearing = await platformAccount('platform.clearing');
  const earnings = await platformAccount('platform.provider_earnings');
  const revenue = await platformAccount('platform.revenue');
  await transfer({ actor: provider, sourceId, reason: 'job_cash_collected', createdAt, legs: [[acct, invoice], [clearing, -invoice]] });
  await transfer({ actor: provider, sourceId, reason: 'job_provider_earnings', createdAt, legs: [[acct, -earned], [earnings, earned]] });
  await transfer({ actor: provider, sourceId, reason: 'job_commission', createdAt, legs: [[clearing, -(invoice - earned)], [revenue, invoice - earned]] });
  return sourceId;
}

async function compute(provider, period) {
  return callJson(ADMIN, `select public.admin_compute_settlement_run($1::uuid, $2::date) as r`, [provider, period]);
}

async function approve(runId) {
  await as(ADMIN, () => db.query(`select public.admin_approve_settlement_run($1::uuid) as r`, [runId]));
}

async function markPaid(runId, reference) {
  await as(ADMIN, () => db.query(`select public.admin_mark_settlement_run_paid($1::uuid, $2::text) as r`, [runId, reference]));
}

// The wallet list, searched by the provider's uuid (its name carries the uuid).
async function walletItem(profileId) {
  const page = await callJson(ADMIN, `select public.admin_wallet_accounts($1::text, 50, 0) as r`, [profileId]);
  const item = page.items.find((i) => i.profile_id === profileId);
  assert.ok(item, 'the wallet list must return the searched account');
  return item;
}

async function manualEntry(accountId, direction, amount, reason = 'Bank transfer received', tracking = 'TRK-DEFAULT') {
  return callJson(ADMIN,
    `select public.admin_manual_wallet_entry($1::uuid, $2::text, $3::bigint, $4::text, $5::text) as r`,
    [accountId, direction, amount, reason, tracking]);
}

// The whole ledger's (id, signed_amount, reason, settled_in_run_id), byte for byte.
async function ledgerSnapshot() {
  return (await db.query(`
    select id, transfer_id, account_id, signed_amount, reason, source_type, source_id, settled_in_run_id, reverses_entry_id
      from public.ledger_entries order by id`)).rows;
}

async function auditCount(action, targetId) {
  return Number(await scalar(
    `select count(*)::int from public.admin_audit_log where action = $1 and target_id = $2`, [action, targetId]));
}

// ===========================================================================
// 1) ACCESS. Every new RPC refuses a non-admin and an anonymous caller, and the anonymous
//    caller gets no data. The grants are pinned on the live catalog.
// ===========================================================================
async function group1() {
  const rescuer = await seedProfile('rescuer');
  const acct = await accountOf(rescuer);
  const calls = [
    [`select public.admin_wallet_accounts(null, 50, 0) as r`, []],
    [`select public.admin_wallet_statement($1::uuid, $2::date, $3::date, 100, 0) as r`, [acct, P, TODAY]],
    [`select public.admin_manual_wallet_entry($1::uuid, 'charge', 1000::bigint, 'x', 'y') as r`, [acct]],
    [`select public.admin_upsert_settlement_schedule(null, '22:00'::time, true, null, 'x') as r`, []],
    [`select public.admin_upsert_ledger_debt_ceiling('service', 1::bigint, 40, 95, true, 'x') as r`, []],
    [`select public.admin_finance_report('commission', $1::date, $2::date, 'day') as r`, [P, TODAY]],
  ];
  for (const uid of [rescuer, null]) {
    for (const [sql, params] of calls) {
      await raisesWith(uid, sql, params, /forbidden|permission denied/);
    }
  }

  for (const sig of NEW_FUNCTIONS) {
    const priv = (await db.query(`
      select has_function_privilege('anon', $1, 'execute') as anon_ok,
             has_function_privilege('authenticated', $1, 'execute') as auth_ok`, [sig])).rows[0];
    assert.equal(priv.anon_ok, false, `anon must not execute ${sig}`); passed++;
    assert.equal(priv.auth_ok, true, `authenticated must execute ${sig} (the RPC gates on is_admin)`); passed++;
  }
  // The two private helpers are owner-only: no client role may call them.
  const helperPriv = await scalar(`
    select has_function_privilege('authenticated', 'private.wallet_account_figures(uuid)', 'execute')`);
  assert.equal(helperPriv, false); passed++;
  return { rescuer, acct };
}

// ===========================================================================
// 2) BALANCE AND UNSETTLED DEBT ARE TWO NUMBERS. A run is computed, approved and marked paid.
//    The balance does not move. The unsettled debt moves by exactly the run's claimed lines.
//    The paid run moves NO ledger row.
// ===========================================================================
async function group2() {
  const provider = await seedProfile('rescuer');
  const acct = await accountOf(provider);
  await cashJob(provider, { invoice: 1000000, earned: 800000, createdAt: `${P} 12:00:00+00` });

  // The hand-computed balance: +1,000,000 cash, -800,000 share = +200,000 owed.
  const handBalance = 1000000 - 800000;
  assert.equal(await balanceOf(acct), handBalance); passed++;

  const before = await walletItem(provider);
  assert.equal(before.balance_toman, handBalance); passed++;
  assert.equal(before.unsettled_debt_toman, handBalance); passed++;
  assert.equal(before.unsettled_entry_count, 2); passed++;
  assert.equal(before.collected_cash_debt_toman, 1000000); passed++;

  const run = await compute(provider, P);
  assert.equal(run.reason, 'computed'); passed++;
  await approve(run.run_id);

  const ledgerBeforePaid = await ledgerSnapshot();
  const payment = `REF-F4-PAY-${crypto.randomUUID().slice(0, 8)}`;
  await markPaid(run.run_id, payment);
  const ledgerAfterPaid = await ledgerSnapshot();

  // THE PAID RUN MOVES NO ENTRY: every row byte-identical, same count, every transfer's sum zero.
  assert.deepEqual(ledgerAfterPaid, ledgerBeforePaid); passed++;
  assert.equal(ledgerAfterPaid.length, ledgerBeforePaid.length); passed++;

  const after = await walletItem(provider);
  assert.equal(after.balance_toman, before.balance_toman); passed++;
  // The unsettled debt moved by exactly the run's claimed lines: 200,000 -> 0.
  assert.equal(before.unsettled_debt_toman - after.unsettled_debt_toman, handBalance); passed++;
  assert.equal(after.unsettled_debt_toman, 0); passed++;
  assert.equal(after.unsettled_entry_count, 0); passed++;
  assert.equal(after.settled_entry_count, 2); passed++;
  // The two numbers are different and separately computed: the balance still counts the settled rows.
  assert.notEqual(after.balance_toman, after.unsettled_debt_toman); passed++;

  // The period carries its own status and reference, and its figures are the run's own.
  const period = after.settlement_periods.find((p) => p.run_id === run.run_id);
  assert.equal(period.status, 'paid'); passed++;
  assert.equal(period.payment_reference, payment); passed++;
  assert.equal(period.net_toman, handBalance); passed++;
  assert.equal(period.lines_total, 2); passed++;
  assert.equal(period.carried_forward_count, 0); passed++;
  assert.equal(period.unsettled_entries_before_period, 0); passed++;
  assert.equal(after.closed_runs_with_unsettled_entries, 0); passed++;
  assert.equal(after.unsettled_periods_count, 0); passed++;

  // Each wallet read is read-only: no run appeared for TODAY, and reading computed nothing.
  const runCount = Number(await scalar(`select count(*)::int from public.settlement_runs where provider_id = $1`, [provider]));
  await walletItem(provider);
  assert.equal(Number(await scalar(`select count(*)::int from public.settlement_runs where provider_id = $1`, [provider])), runCount); passed++;
  return { provider, acct, runId: run.run_id };
}

// ===========================================================================
// 2b) THE SETTLEMENT AMOUNT IS NOT THE LEDGER SUM. A manual charge posted before the compute is
//     a line of the run: it counts in net_toman (the signed sum of every line) and in no other
//     figure. The settlement amount is cash - income - penalty, so the two DIFFER here by the
//     charge: 1,000,000 - 800,000 - 0 = 200,000, while net_toman = 500,000.
// ===========================================================================
async function group2b() {
  const provider = await seedProfile('rescuer');
  const acct = await accountOf(provider);
  await cashJob(provider, { invoice: 1000000, earned: 800000, createdAt: `${P} 12:00:00+00` });
  await manualEntry(acct, 'charge', 300000, 'Manual charge counted in the run', 'TRK-AMOUNT-1');

  const run = await compute(provider, TODAY);
  assert.equal(run.reason, 'computed'); passed++;

  const item = await walletItem(provider);
  const period = item.settlement_periods.find((p) => p.run_id === run.run_id);
  assert.ok(period); passed++;
  assert.equal(period.cash_collected_toman, 1000000); passed++;
  assert.equal(period.income_toman, 800000); passed++;
  assert.equal(period.penalty_toman, 0); passed++;
  assert.equal(period.commission_toman, 200000); passed++;
  assert.equal(period.net_toman, 500000); passed++;
  const settlementAmount = period.cash_collected_toman - period.income_toman - period.penalty_toman;
  assert.equal(settlementAmount, 200000); passed++;
  assert.notEqual(settlementAmount, period.net_toman); passed++;
}

// ===========================================================================
// 2c) THE UNSETTLED FILTER AND THE WALLET ORDER (p_only_unsettled, D11 and D12).
// ===========================================================================
async function allWalletItems(onlyUnsettled) {
  const items = [];
  let total = 0;
  for (let offset = 0; ; offset += 200) {
    const page = await callJson(ADMIN,
      `select public.admin_wallet_accounts(null, 200, $1::integer, $2::boolean) as r`, [offset, onlyUnsettled]);
    total = page.total;
    items.push(...page.items);
    if (page.items.length === 0 || items.length >= total) break;
  }
  return { total, items };
}

const attention = (i) => i.at_warn || i.at_stop;

async function groupWalletList() {
  // THE FIXTURE. This group creates every row it measures: a rescuer over the warning line (the
  // order check below), and two calm accounts with small unsettled entries, so the filtered set
  // is more than one row. The amounts stay under the 40% warning line of the 5,000,000 ceiling.
  const hot = await seedProfile('rescuer');
  await manualEntry(await accountOf(hot), 'charge', 2000000, 'Over the warning line', 'TRK-ORDER-1');
  const calmRescuer = await seedProfile('rescuer');
  await manualEntry(await accountOf(calmRescuer), 'charge', 150000, 'Small balance, rescuer', 'TRK-CALM-1');
  const calmService = await seedProfile('service');
  await manualEntry(await accountOf(calmService), 'charge', 40000, 'Small balance, service', 'TRK-CALM-2');

  // The default is unchanged: the three-argument form and the explicit false give the same list.
  const threeArg = await callJson(ADMIN, `select public.admin_wallet_accounts(null, 200, 0) as r`, []);
  const fourArg = await callJson(ADMIN, `select public.admin_wallet_accounts(null, 200, 0, false) as r`, []);
  assert.equal(fourArg.total, threeArg.total); passed++;
  assert.deepEqual(fourArg.items.map((i) => i.account_id), threeArg.items.map((i) => i.account_id)); passed++;

  // THE FILTER. The owing set, computed by SQL straight from the ledger: profile accounts with at
  // least one unsettled entry, and the sum of what they owe.
  const owingRows = (await db.query(`
    select a.id, sum(e.signed_amount)::bigint as owed
      from public.ledger_accounts a
      join public.ledger_entries e on e.account_id = a.id and e.settled_in_run_id is null
     where a.kind = 'profile'
     group by a.id`)).rows;
  assert.ok(owingRows.length > 0); passed++;
  const expectedIds = owingRows.map((r) => r.id).sort();
  const expectedOwed = owingRows.reduce((sum, r) => sum + Number(r.owed), 0);

  const owing = await allWalletItems(true);
  assert.equal(owing.total, owingRows.length); passed++;
  assert.equal(owing.items.length, owing.total); passed++;
  assert.deepEqual(owing.items.map((i) => i.account_id).sort(), expectedIds); passed++;
  assert.equal(owing.items.reduce((sum, i) => sum + i.unsettled_debt_toman, 0), expectedOwed); passed++;
  assert.ok(owing.items.every((i) => i.kind === 'profile' && i.unsettled_entry_count > 0)); passed++;

  // The unfiltered list is larger: it also carries the platform accounts, which the screen never lists.
  const everyone = await allWalletItems(false);
  assert.ok(everyone.total > owing.total); passed++;
  assert.ok(everyone.items.some((i) => i.kind === 'platform')); passed++;

  // THE ORDER. A rescuer at 40% of its ceiling is listed before every account below that line.
  const ordered = await allWalletItems(false);
  const hotIndex = ordered.items.findIndex((i) => i.profile_id === hot);
  assert.ok(hotIndex >= 0); passed++;
  assert.equal(ordered.items[hotIndex].at_warn, true); passed++;
  const firstCalm = ordered.items.findIndex((i) => !attention(i));
  assert.ok(firstCalm === -1 || hotIndex < firstCalm); passed++;
  // Down the whole list: attention first, then the unsettled amount descending within each group.
  for (let k = 1; k < ordered.items.length; k++) {
    const prev = ordered.items[k - 1];
    const cur = ordered.items[k];
    assert.ok(attention(prev) >= attention(cur), 'an account under its warning line must not come before one over it');
    if (attention(prev) === attention(cur)) {
      assert.ok((prev.unsettled_debt_toman ?? 0) >= (cur.unsettled_debt_toman ?? 0), 'the unsettled amount must not rise down the list');
    }
  }
  passed++;

  // PAGING IS STABLE. Two pages of three are the first six, in the same order.
  const first3 = await callJson(ADMIN, `select public.admin_wallet_accounts(null, 3, 0, false) as r`, []);
  const next3 = await callJson(ADMIN, `select public.admin_wallet_accounts(null, 3, 3, false) as r`, []);
  const first6 = await callJson(ADMIN, `select public.admin_wallet_accounts(null, 6, 0, false) as r`, []);
  assert.deepEqual([...first3.items, ...next3.items].map((i) => i.account_id), first6.items.map((i) => i.account_id)); passed++;
  assert.equal(first3.total, first6.total); passed++;
}

// ===========================================================================
// 2d) THE SCREENS' WIRING. The rendered text is not run here (there is no component harness).
//     These checks pin the two rules the copy turns on: the banners take the ROW's percentage as
//     an argument and carry no literal, and the screens print the settlement amount under its own
//     label, with net_toman labelled as the signed ledger sum.
// ===========================================================================
function screenWiring(projectRoot) {
  const read = (rel) => fs.readFileSync(path.join(projectRoot, rel), 'utf8');
  const labels = read('lib/admin/finance-labels.ts');
  assert.match(labels, /warnBanner: \(percent: number\) => `[^`]*\$\{percent\.toLocaleString\("fa-IR"\)\}/); passed++;
  assert.match(labels, /stopBanner: \(percent: number\) => `[^`]*\$\{percent\.toLocaleString\("fa-IR"\)\}/); passed++;
  assert.doesNotMatch(labels, /[█░-█╣0-9]+┘ز/); passed++;

  const wallet = read('app/admin/wallet/page.tsx');
  assert.match(wallet, /FINANCE_TEXT\.warnBanner\(selected\.warn_at_percent/); passed++;
  assert.match(wallet, /FINANCE_TEXT\.stopBanner\(selected\.stop_at_percent/); passed++;
  assert.match(wallet, /settlementAmountToman\(p\)/); passed++;

  const client = read('app/admin/settlements/settlements-client.tsx');
  assert.match(client, /settlementAmountToman\(p\)/); passed++;

  const settlements = read('app/admin/settlements/page.tsx');
  assert.match(settlements, /p_only_unsettled: true/); passed++;
}

// ===========================================================================
// 3) THE COMPUTE IS IDEMPOTENT THROUGH THE SCREEN'S OWN PATH. A second press creates no run,
//    adds no line, answers a reason from the existing set, and writes no ledger row.
// ===========================================================================
async function group3() {
  const provider = await seedProfile('rescuer');
  await cashJob(provider, { invoice: 500000, earned: 400000, createdAt: `${P} 13:00:00+00` });

  const first = await compute(provider, P);
  assert.equal(first.reason, 'computed'); passed++;
  assert.equal(first.created, true); passed++;

  const runsBefore = Number(await scalar(`select count(*)::int from public.settlement_runs where provider_id = $1`, [provider]));
  const linesBefore = Number(await scalar(`select count(*)::int from public.settlement_lines where run_id = $1`, [first.run_id]));
  const ledgerBefore = await ledgerSnapshot();

  const second = await compute(provider, P);
  assert.ok(['nothing_new', 'nothing_to_settle', 'run_already_closed', 'computed'].includes(second.reason)); passed++;
  assert.notEqual(second.reason, 'computed'); passed++;
  assert.equal(second.created, false); passed++;
  assert.equal(Number(await scalar(`select count(*)::int from public.settlement_runs where provider_id = $1`, [provider])), runsBefore); passed++;
  assert.equal(Number(await scalar(`select count(*)::int from public.settlement_lines where run_id = $1`, [first.run_id])), linesBefore); passed++;
  assert.deepEqual(await ledgerSnapshot(), ledgerBefore); passed++;
}

// ===========================================================================
// 4) THE THRESHOLDS. The warning at exactly 40% and not at 39.99%; the stop at exactly 95% and
//    not at 94.99%. Driven by the ceiling row, with the gate (ceiling_decision) agreeing.
//    The manual entries here are the RPC itself, so the setup exercises the write too.
// ===========================================================================
async function group4() {
  const provider = await seedProfile('rescuer');
  const acct = await accountOf(provider);
  const ceiling = await scalar(`select ceiling_toman::bigint from public.ledger_debt_ceilings where role = 'rescuer'`);
  assert.equal(Number(ceiling), 5000000); passed++;

  const gate = async () => parseJson((await db.query(`select private.ceiling_decision($1::uuid) as r`, [provider])).rows[0].r);

  // 1,999,999 is below 40% of 5,000,000 (2,000,000): no warning.
  await manualEntry(acct, 'charge', 1999999, 'Below the warning line', 'TRK-W-1');
  let w = await walletItem(provider);
  assert.equal(w.balance_toman, 1999999); passed++;
  assert.equal(w.at_warn, false); passed++;
  assert.equal(w.at_stop, false); passed++;
  assert.equal((await gate()).decision, 'allow'); passed++;

  // 2,000,000 is exactly 40%: the warning appears, the work is still allowed.
  await manualEntry(acct, 'charge', 1, 'Exactly at the warning line', 'TRK-W-2');
  w = await walletItem(provider);
  assert.equal(w.balance_toman, 2000000); passed++;
  assert.equal(w.warn_threshold_toman, 2000000); passed++;
  assert.equal(w.at_warn, true); passed++;
  assert.equal(w.at_stop, false); passed++;
  assert.equal((await gate()).decision, 'allow'); passed++;

  // 4,749,999 is 94.99998%: still below the stop.
  await manualEntry(acct, 'charge', 2749999, 'Just below the stop line', 'TRK-S-1');
  w = await walletItem(provider);
  assert.equal(w.balance_toman, 4749999); passed++;
  assert.equal(w.at_stop, false); passed++;
  assert.equal((await gate()).decision, 'allow'); passed++;

  // 4,750,000 is exactly 95%: the stop appears, and the gate refuses new work.
  await manualEntry(acct, 'charge', 1, 'Exactly at the stop line', 'TRK-S-2');
  w = await walletItem(provider);
  assert.equal(w.balance_toman, 4750000); passed++;
  assert.equal(w.stop_threshold_toman, 4750000); passed++;
  assert.equal(w.at_stop, true); passed++;
  const refused = await gate();
  assert.equal(refused.decision, 'refuse'); passed++;
  assert.equal(refused.error_code, 'debt_ceiling_reached'); passed++;

  // Change the ROW, and the threshold moves with it (no literal in the code). At 10,000,000
  // the same 4,750,000 is 47.5%: past the warning (40%), short of the stop (95%).
  const changed = await callJson(ADMIN,
    `select jsonb_build_object('role', public.admin_upsert_ledger_debt_ceiling('rescuer', 10000000::bigint, 40, 95, true, 'Test: ceiling moved to 10 million')) as r`, []);
  assert.equal(changed.role, 'rescuer'); passed++;
  w = await walletItem(provider);
  assert.equal(w.ceiling_toman, 10000000); passed++;
  assert.equal(w.warn_threshold_toman, 4000000); passed++;
  assert.equal(w.stop_threshold_toman, 9500000); passed++;
  assert.equal(w.at_warn, true); passed++;
  assert.equal(w.at_stop, false); passed++;
  assert.equal((await gate()).decision, 'allow'); passed++;

  // THE BANNER'S PERCENTAGE IS THE ROW'S. Moving the warning to 60% moves the line with it: the
  // same 4,750,000 is 47.5%, below 60%, so the warning goes. The stop stays at 95%.
  await as(ADMIN, () => db.query(
    `select public.admin_upsert_ledger_debt_ceiling('rescuer', 10000000::bigint, 60, 95, true, 'Test: warning moved to 60 percent') as r`));
  w = await walletItem(provider);
  assert.equal(w.warn_at_percent, 60); passed++;
  assert.equal(w.warn_threshold_toman, 6000000); passed++;
  assert.equal(w.at_warn, false); passed++;
  assert.equal(w.at_stop, false); passed++;

  // Put the row back so later groups see the seeded default.
  await as(ADMIN, () => db.query(
    `select public.admin_upsert_ledger_debt_ceiling('rescuer', 5000000::bigint, 40, 95, true, 'Test: restore seeded ceiling') as r`));

  // A service is a cash-holding role with its own row; a platform account has no ceiling at all.
  const platform = await platformAccount('platform.revenue');
  const platformFigures = await callJson(ADMIN, `select public.admin_wallet_accounts($1::text, 50, 0) as r`, ['platform.revenue']);
  const revenue = platformFigures.items.find((i) => i.account_id === platform);
  assert.ok(revenue); passed++;
  assert.equal(revenue.ceiling_toman, null); passed++;
  assert.equal(revenue.at_warn, false); passed++;
  assert.equal(revenue.at_stop, false); passed++;
  assert.equal(revenue.unsettled_debt_toman, null); passed++;
}

// ===========================================================================
// 5) THE MANUAL ENTRY. A charge and a withdraw each post exactly ONE balanced transfer (two
//    legs, sum zero), with the tracking reference and the operator's reason in rate_snapshot,
//    the audit row present, and the account balance moved by the amount in the right direction.
// ===========================================================================
async function group5() {
  const provider = await seedProfile('service');
  const acct = await accountOf(provider);
  const manualAcct = await platformAccount('platform.manual_adjustments');
  assert.notEqual(manualAcct, null); passed++;

  const reasonText = 'Cash deposit at the branch, counted twice';
  const charge = await manualEntry(acct, 'charge', 500000, reasonText, 'BANK-REF-0001');
  assert.equal(charge.direction, 'charge'); passed++;
  assert.equal(charge.amount_toman, 500000); passed++;
  assert.equal(charge.balance_before_toman, 0); passed++;
  assert.equal(charge.balance_after_toman, 500000); passed++;
  assert.equal(charge.tracking_reference, 'BANK-REF-0001'); passed++;
  assert.equal(charge.entry_ids.length, 2); passed++;

  const legs = (await db.query(`select * from public.ledger_entries where transfer_id = $1 order by account_id`, [charge.transfer_id])).rows;
  assert.equal(legs.length, 2); passed++;
  assert.equal(await transferSum(charge.transfer_id), 0); passed++;
  const ours = legs.find((l) => l.account_id === acct);
  const other = legs.find((l) => l.account_id === manualAcct);
  assert.equal(Number(ours.signed_amount), 500000); passed++;
  assert.equal(Number(other.signed_amount), -500000); passed++;
  assert.equal(ours.reason, 'admin_charge'); passed++;
  assert.equal(ours.source_type, 'manual'); passed++;
  assert.notEqual(ours.source_id, null); passed++;
  assert.deepEqual(ours.rate_snapshot, {
    tracking_reference: 'BANK-REF-0001', direction: 'charge', reason: reasonText, source: 'admin_manual_wallet_entry',
  }); passed++;
  assert.equal(await balanceOf(acct), 500000); passed++;

  // The audit row, written in the same call. Its metadata carries the balances and the transfer.
  const audit = (await db.query(`
    select actor_id, target_id, reason, metadata from public.admin_audit_log
     where action = 'manual_wallet_charge' and target_id = $1`, [acct])).rows;
  assert.equal(audit.length, 1); passed++;
  assert.equal(audit[0].actor_id, ADMIN); passed++;
  assert.equal(audit[0].reason, reasonText); passed++;
  assert.equal(audit[0].metadata.previous, 0); passed++;
  assert.equal(audit[0].metadata.new, 500000); passed++;
  assert.equal(audit[0].metadata.transfer_id, charge.transfer_id); passed++;
  assert.equal(audit[0].metadata.tracking_reference, 'BANK-REF-0001'); passed++;

  // The withdraw: the exact opposite, one balanced transfer, the balance down by its amount.
  const withdraw = await manualEntry(acct, 'withdraw', 200000, 'Paid out by bank transfer', 'BANK-REF-0002');
  assert.equal(withdraw.balance_before_toman, 500000); passed++;
  assert.equal(withdraw.balance_after_toman, 300000); passed++;
  const wlegs = (await db.query(`select * from public.ledger_entries where transfer_id = $1`, [withdraw.transfer_id])).rows;
  assert.equal(wlegs.length, 2); passed++;
  assert.equal(await transferSum(withdraw.transfer_id), 0); passed++;
  const wours = wlegs.find((l) => l.account_id === acct);
  assert.equal(Number(wours.signed_amount), -200000); passed++;
  assert.equal(wours.reason, 'admin_withdraw'); passed++;
  assert.equal(wours.rate_snapshot.direction, 'withdraw'); passed++;
  assert.equal(wours.rate_snapshot.tracking_reference, 'BANK-REF-0002'); passed++;
  assert.equal(await balanceOf(acct), 300000); passed++;
  assert.equal(await auditCount('manual_wallet_withdraw', acct), 1); passed++;

  // THE AUDIT IS IN THE SAME TRANSACTION: the function body calls the audit writer itself.
  const body = await scalar(`select pg_get_functiondef(to_regprocedure('${MANUAL_SIG}'))`);
  assert.match(body, /private\.log_admin_action\(/); passed++;
  assert.match(body, /post_ledger_transfer\(/); passed++;

  // The validation refusals, each raised before any row is written.
  const ledgerBefore = await ledgerSnapshot();
  const bad = [
    [acct, 'refund', 1000, 'reason', 'ref', /invalid_direction/],
    [acct, 'charge', 0, 'reason', 'ref', /invalid_amount/],
    [acct, 'charge', -5, 'reason', 'ref', /invalid_amount/],
    [acct, 'charge', 1000, '   ', 'ref', /invalid_reason/],
    [acct, 'charge', 1000, null, 'ref', /invalid_reason/],
    [acct, 'charge', 1000, 'x'.repeat(501), 'ref', /invalid_reason/],
    [acct, 'charge', 1000, 'reason', '   ', /invalid_tracking_reference/],
    [acct, 'charge', 1000, 'reason', 'x'.repeat(201), /invalid_tracking_reference/],
    [crypto.randomUUID(), 'charge', 1000, 'reason', 'ref', /account_not_found/],
    [manualAcct, 'charge', 1000, 'reason', 'ref', /not_a_profile_account/],
  ];
  for (const [account, direction, amount, reason, tracking, pattern] of bad) {
    await raisesWith(ADMIN,
      `select public.admin_manual_wallet_entry($1::uuid, $2::text, $3::bigint, $4::text, $5::text) as r`,
      [account, direction, amount, reason, tracking], pattern);
  }
  assert.deepEqual(await ledgerSnapshot(), ledgerBefore); passed++;
  assert.equal(await balanceOf(acct), 300000); passed++;

  // A non-admin is refused before any validation or write.
  await raisesWith(provider, `select public.admin_manual_wallet_entry($1::uuid, 'charge', 1000::bigint, 'r', 't') as r`, [acct], /forbidden/);
  assert.deepEqual(await ledgerSnapshot(), ledgerBefore); passed++;
}

// ===========================================================================
// 6) THE SETTINGS RPCs (TD-045). Create, update, no-change (no write, no audit row), a
//    non-admin refused, a blank reason refused, and the closed input sets.
// ===========================================================================
async function group6() {
  const provider = await seedProfile('service');
  const profileAudit = async () => Number(await scalar(
    `select count(*)::int from public.admin_audit_log where action = 'upsert_settlement_schedule'`));
  const ceilingAudit = async () => Number(await scalar(
    `select count(*)::int from public.admin_audit_log where action = 'upsert_ledger_debt_ceiling'`));

  // THE DEFAULT ROW. Editing it with the same values writes nothing and logs nothing.
  const defaultBefore = await db.query(`select * from public.settlement_schedules where profile_id is null`);
  assert.equal(defaultBefore.rows.length, 1); passed++;
  const defaultId = defaultBefore.rows[0].id;
  const auditBeforeNoop = await profileAudit();
  const noop = await as(ADMIN, () => db.query(
    `select public.admin_upsert_settlement_schedule(null, $1::time, $2::boolean, $3::text, $4::text) as r`,
    [defaultBefore.rows[0].settle_at_time, defaultBefore.rows[0].is_active, defaultBefore.rows[0].note, 'Test: no-change default']));
  assert.equal(noop.rows[0].r, defaultId); passed++;
  assert.equal(await profileAudit(), auditBeforeNoop); passed++;
  assert.deepEqual((await db.query(`select * from public.settlement_schedules where profile_id is null`)).rows, defaultBefore.rows); passed++;

  // A PROFILE OVERRIDE. Create, then update, then the same values again.
  const created = await callJson(ADMIN,
    `select jsonb_build_object('id', public.admin_upsert_settlement_schedule($1::uuid, '18:30'::time, true, 'Test override', 'Test: create override')) as r`,
    [provider]);
  assert.notEqual(created.id, null); passed++;
  const overrideRows = (await db.query(`select * from public.settlement_schedules where profile_id = $1`, [provider])).rows;
  assert.equal(overrideRows.length, 1); passed++;
  assert.equal(overrideRows[0].id, created.id); passed++;
  assert.equal(overrideRows[0].settle_at_time, '18:30:00'); passed++;
  assert.equal(await profileAudit(), auditBeforeNoop + 1); passed++;

  const updated = await as(ADMIN, () => db.query(
    `select public.admin_upsert_settlement_schedule($1::uuid, '19:45'::time, false, 'Test override paused', 'Test: pause override') as r`, [provider]));
  assert.equal(updated.rows[0].r, created.id); passed++;
  const after = (await db.query(`select * from public.settlement_schedules where profile_id = $1`, [provider])).rows[0];
  assert.equal(after.settle_at_time, '19:45:00'); passed++;
  assert.equal(after.is_active, false); passed++;
  assert.equal(await profileAudit(), auditBeforeNoop + 2); passed++;

  const again = await as(ADMIN, () => db.query(
    `select public.admin_upsert_settlement_schedule($1::uuid, '19:45'::time, false, 'Test override paused', 'Test: no-change override') as r`, [provider]));
  assert.equal(again.rows[0].r, created.id); passed++;
  assert.equal(await profileAudit(), auditBeforeNoop + 2); passed++;
  assert.deepEqual((await db.query(`select * from public.settlement_schedules where profile_id = $1`, [provider])).rows[0], after); passed++;

  // Refusals: blank reason, null time, oversized note, unknown profile, non-admin.
  await raisesWith(ADMIN, `select public.admin_upsert_settlement_schedule($1::uuid, '10:00'::time, true, null, '   ') as r`, [provider], /invalid_reason/);
  await raisesWith(ADMIN, `select public.admin_upsert_settlement_schedule($1::uuid, null::time, true, null, 'r') as r`, [provider], /invalid_time/);
  await raisesWith(ADMIN, `select public.admin_upsert_settlement_schedule($1::uuid, '10:00'::time, true, $2::text, 'r') as r`, [provider, 'n'.repeat(501)], /invalid_note/);
  await raisesWith(ADMIN, `select public.admin_upsert_settlement_schedule($1::uuid, '10:00'::time, true, null, 'r') as r`, [crypto.randomUUID()], /invalid_profile/);
  await raisesWith(provider, `select public.admin_upsert_settlement_schedule($1::uuid, '10:00'::time, true, null, 'r') as r`, [provider], /forbidden/);

  // THE CEILING ROW (TD-045). Update a role, no-change writes nothing, and the refusals.
  const serviceBefore = (await db.query(`select * from public.ledger_debt_ceilings where role = 'service'`)).rows[0];
  const ceilAuditBefore = await ceilingAudit();
  await as(ADMIN, () => db.query(
    `select public.admin_upsert_ledger_debt_ceiling('service', 4000000::bigint, 40, 90, true, 'Test: service ceiling') as r`));
  const serviceAfter = (await db.query(`select * from public.ledger_debt_ceilings where role = 'service'`)).rows[0];
  assert.equal(Number(serviceAfter.ceiling_toman), 4000000); passed++;
  assert.equal(Number(serviceAfter.stop_at_percent), 90); passed++;
  assert.equal(await ceilingAudit(), ceilAuditBefore + 1); passed++;

  await as(ADMIN, () => db.query(
    `select public.admin_upsert_ledger_debt_ceiling('service', 4000000::bigint, 40, 90, true, 'Test: same values') as r`));
  assert.equal(await ceilingAudit(), ceilAuditBefore + 1); passed++;
  assert.deepEqual((await db.query(`select * from public.ledger_debt_ceilings where role = 'service'`)).rows[0], serviceAfter); passed++;

  await raisesWith(ADMIN, `select public.admin_upsert_ledger_debt_ceiling('service', 1::bigint, 40, 90, true, '') as r`, [], /invalid_reason/);
  await raisesWith(ADMIN, `select public.admin_upsert_ledger_debt_ceiling('seller', 1::bigint, 40, 90, true, 'r') as r`, [], /invalid_role/);
  await raisesWith(ADMIN, `select public.admin_upsert_ledger_debt_ceiling('service', -1::bigint, 40, 90, true, 'r') as r`, [], /invalid_ceiling/);
  await raisesWith(ADMIN, `select public.admin_upsert_ledger_debt_ceiling('service', 1::bigint, 0, 90, true, 'r') as r`, [], /invalid_percent/);
  await raisesWith(ADMIN, `select public.admin_upsert_ledger_debt_ceiling('service', 1::bigint, 40, 101, true, 'r') as r`, [], /invalid_percent/);
  await raisesWith(ADMIN, `select public.admin_upsert_ledger_debt_ceiling('service', 1::bigint, 50, 50, true, 'r') as r`, [], /invalid_percent_order/);
  await raisesWith(provider, `select public.admin_upsert_ledger_debt_ceiling('service', 1::bigint, 40, 90, true, 'r') as r`, [], /forbidden/);

  // Put the service row back to the seeded values.
  await as(ADMIN, () => db.query(
    `select public.admin_upsert_ledger_debt_ceiling('service', $1::bigint, $2::numeric, $3::numeric, $4::boolean, 'Test: restore service row') as r`,
    [serviceBefore.ceiling_toman, serviceBefore.warn_at_percent, serviceBefore.stop_at_percent, serviceBefore.is_active]));
}

// ===========================================================================
// 7) THE ROLLBACK, on its own isolated database, exactly as tests/finance-correction.mjs does.
//    apply -> assert -> rollback -> assert clean.
// ===========================================================================
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

  const ledgerAccounts = await dbInstance.query(`select kind, code from public.ledger_accounts where kind = 'platform' order by code`);
  for (const r of ledgerAccounts.rows) push('platform_account', r);

  return rows.sort();
}

async function rollbackFidelity(projectRoot) {
  const migDir = path.join(projectRoot, 'supabase/migrations');
  const laterMigrations = fs.readdirSync(migDir).sort().filter((f) => f > MIGRATION_FILE);
  const preDb = await buildSchemaDb(projectRoot, { exclude: laterMigrations.concat([MIGRATION_FILE]) });
  const preSnapshot = await schemaSnapshot(preDb);
  await preDb.close();

  const full = await buildSchemaDb(projectRoot, { exclude: laterMigrations });
  const one = async (sql) => Object.values((await full.query(sql)).rows[0])[0];
  const migrationSql = fs.readFileSync(path.join(migDir, MIGRATION_FILE), 'utf8');
  const rollbackSql = fs.readFileSync(path.join(projectRoot, 'supabase/rollback', ROLLBACK_FILE), 'utf8');

  // FIRST, the new objects exist. Without this, the rollback assertions could pass
  // against a migration that was never applied.
  for (const sig of NEW_FUNCTIONS) {
    assert.notEqual(await one(`select to_regprocedure('${sig}')::text`), null,
      `${sig} must exist after the migration`); passed++;
  }
  assert.equal(await one(`select count(*)::int from public.ledger_accounts where code = 'platform.manual_adjustments'`), 1); passed++;
  const liveCompute = await one(`select prosrc from pg_proc where oid = to_regprocedure('${COMPUTE_SIG}')`);
  assert.match(liveCompute, /carried_forward_count/); passed++;

  await full.exec(rollbackSql);

  assert.deepEqual(await schemaSnapshot(full), preSnapshot,
    'the schema must equal the pre-F4 schema after running the rollback'); passed++;

  for (const sig of NEW_FUNCTIONS) {
    assert.equal(await one(`select to_regprocedure('${sig}')::text`), null,
      `${sig} must no longer exist after the rollback`); passed++;
  }
  assert.equal(await one(`select count(*)::int from public.ledger_accounts where code = 'platform.manual_adjustments'`), 0); passed++;
  assert.equal(await one(`select to_regprocedure('private.wallet_account_figures(uuid)')::text`), null); passed++;

  // Every prior object is still present: the snapshot above already compares every prior
  // function body, the compute included, and the four ledger platform rows remain.
  assert.equal(await one(`select count(*)::int from public.ledger_accounts where code in ('platform.revenue','platform.clearing','platform.provider_earnings','platform.penalties')`), 4); passed++;

  await assert.doesNotReject(() => full.exec(rollbackSql), 'running the rollback file a second time must not error'); passed++;
  assert.deepEqual(await schemaSnapshot(full), preSnapshot,
    'a second rollback must leave the schema equal to the pre-F4 schema'); passed++;

  await assert.doesNotReject(() => full.exec(migrationSql), 're-applying the migration after a rollback must succeed'); passed++;
  for (const sig of NEW_FUNCTIONS) {
    assert.notEqual(await one(`select to_regprocedure('${sig}')::text`), null,
      `re-applying the migration must restore ${sig}`); passed++;
  }

  await full.close();
}

async function main() {
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  db = await openSchemaDb(projectRoot);

  const dates = (await db.query(`
    select ((now() at time zone 'utc')::date)::text as today,
           ((now() at time zone 'utc')::date - 1)::text as yesterday`)).rows[0];
  TODAY = dates.today;
  P = dates.yesterday;

  ADMIN = await seedProfile('owner');
  await db.query(`update public.profiles set is_admin = true where id = $1`, [ADMIN]);
  passed++;

  await group1();
  // The list group is self-contained: it creates its own fixture, so its place here is free.
  await groupWalletList();
  await group2();
  await group2b();
  await group3();
  await group4();
  await group5();
  await group6();

  screenWiring(projectRoot);

  await db.close();
  await rollbackFidelity(projectRoot);

  console.log(`${passed} finance-wallet assertions passed`);
}

await main();
