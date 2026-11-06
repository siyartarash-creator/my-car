import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openSchemaDb } from './helpers/schema-snapshot.mjs';

// WU-FINANCE-F4: the financial reports. osaa/specs/finance.md section 6 (the reports) and
// section 7 item 6 (one hand-computed example per report, checked against the database).
// This file proves, through the real RPC admin_finance_report: a date range is mandatory on
// every kind and a range over 366 days is refused; the access denials; one hand-computed
// example per kind; the commission report reads the platform.revenue ACCOUNT and not the
// run's derived commission; the daily trend's zero days; and every answer names its source.
//
// Each group uses its own fixed date window (2024), so its expected sums are exact and the
// groups cannot see each other's rows. The rollback of the migration is exercised in
// tests/finance-wallet.mjs, the same harness pass as the wallet's own RPCs.

const WINDOW_A = { from: '2024-03-10', to: '2024-03-10' };
const WINDOW_B = { from: '2024-04-01', to: '2024-04-03' };

let passed = 0;
let db;
let ADMIN;
let mobileCounter = 0;

async function scalar(sql, params) {
  return Object.values((await db.query(sql, params)).rows[0])[0];
}

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

async function report(kind, from, to, granularity = 'day', uid = ADMIN) {
  const raw = (await as(uid, () => db.query(
    `select public.admin_finance_report($1::text, $2::date, $3::date, $4::text) as r`, [kind, from, to, granularity]))).rows[0].r;
  return parseJson(raw);
}

async function seedProfile(userType) {
  const id = crypto.randomUUID();
  const mobile = '09' + String(100000000 + (++mobileCounter)).slice(0, 9);
  await db.query(
    `insert into auth.users (id, raw_user_meta_data) values ($1, $2::jsonb)`,
    [id, JSON.stringify({ name: `F4R ${userType} ${id}`, mobile, user_type: userType })]);
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

// A cash job as F2c posts it: 1,000,000 cash, 800,000 provider share, 200,000 commission on
// platform.revenue. Dated `createdAt`.
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

async function penalty(provider, { amount, createdAt }) {
  const acct = await accountOf(provider);
  const penalties = await platformAccount('platform.penalties');
  await transfer({ actor: provider, reason: 'cancel_penalty', createdAt, legs: [[acct, -amount], [penalties, amount]] });
}

async function compute(provider, period) {
  return parseJson((await as(ADMIN, () => db.query(
    `select public.admin_compute_settlement_run($1::uuid, $2::date) as r`, [provider, period]))).rows[0].r);
}

async function approve(runId) {
  await as(ADMIN, () => db.query(`select public.admin_approve_settlement_run($1::uuid) as r`, [runId]));
}

async function markPaid(runId, reference) {
  await as(ADMIN, () => db.query(`select public.admin_mark_settlement_run_paid($1::uuid, $2::text) as r`, [runId, reference]));
}

const KINDS = ['commission', 'settlement', 'provider_debt', 'penalties', 'breakdown', 'daily_trend'];

// ===========================================================================
// 1) THE RANGE IS MANDATORY ON EVERY KIND, AND NO REPORT RUNS UNBOUNDED.
// ===========================================================================
async function group1() {
  const rescuer = await seedProfile('rescuer');
  for (const kind of KINDS) {
    await raisesWith(ADMIN, `select public.admin_finance_report($1::text, null::date, '2024-03-10'::date, 'day') as r`, [kind], /invalid_date_range/);
    await raisesWith(ADMIN, `select public.admin_finance_report($1::text, '2024-03-10'::date, null::date, 'day') as r`, [kind], /invalid_date_range/);
    await raisesWith(ADMIN, `select public.admin_finance_report($1::text, '2024-03-11'::date, '2024-03-10'::date, 'day') as r`, [kind], /invalid_date_range/);
    // 367 days inclusive (a difference of 366) is refused; 366 inclusive (a difference of 365) is allowed.
    await raisesWith(ADMIN, `select public.admin_finance_report($1::text, '2023-01-01'::date, '2024-01-02'::date, 'day') as r`, [kind], /date_range_too_wide/);
  }
  const allowed = await report('commission', '2023-01-01', '2024-01-01');
  assert.equal(allowed.kind, 'commission'); passed++;

  await raisesWith(ADMIN, `select public.admin_finance_report('nonsense', '2024-03-10'::date, '2024-03-10'::date, 'day') as r`, [], /invalid_report_kind/);
  await raisesWith(ADMIN, `select public.admin_finance_report(null::text, '2024-03-10'::date, '2024-03-10'::date, 'day') as r`, [], /invalid_report_kind/);
  await raisesWith(ADMIN, `select public.admin_finance_report('commission', '2024-03-10'::date, '2024-03-10'::date, 'year') as r`, [], /invalid_granularity/);
  await raisesWith(ADMIN, `select public.admin_finance_report('commission', '2024-03-10'::date, '2024-03-10'::date, null::text) as r`, [], /invalid_granularity/);
  for (const g of ['day', 'week', 'month']) {
    const ok = await report('commission', WINDOW_A.from, WINDOW_A.to, g);
    assert.equal(ok.granularity, g); passed++;
  }

  // A non-admin and an anonymous caller are refused on every kind, and get no rows.
  for (const kind of KINDS) {
    await raisesWith(rescuer, `select public.admin_finance_report($1::text, '2024-03-10'::date, '2024-03-10'::date, 'day') as r`, [kind], /forbidden/);
    await raisesWith(null, `select public.admin_finance_report($1::text, '2024-03-10'::date, '2024-03-10'::date, 'day') as r`, [kind], /forbidden|permission denied/);
  }
  const grant = (await db.query(`
    select has_function_privilege('anon', 'public.admin_finance_report(text,date,date,text)', 'execute') as anon_ok,
           has_function_privilege('authenticated', 'public.admin_finance_report(text,date,date,text)', 'execute') as auth_ok`)).rows[0];
  assert.equal(grant.anon_ok, false); passed++;
  assert.equal(grant.auth_ok, true); passed++;
}

// ===========================================================================
// 2) WINDOW A, one provider, a settled cash job, one zero-sum extra share, one late penalty.
//    Hand-computed, dated 2024-03-10:
//      cash job       cash +1,000,000 / share -800,000 / platform.revenue +200,000 (commission)
//      extra share    provider -100,000 / platform.provider_earnings +100,000
//      run (computed before the penalty, then paid): cash 1,000,000, income 900,000,
//                     commission 100,000 (DERIVED), net 100,000
//      penalty        provider -30,000 / platform.penalties +30,000 (unsettled, after the run)
//    So: commission report = 200,000 (the revenue account), NOT the run's 100,000 derived figure.
// ===========================================================================
async function groupA() {
  const provider = await seedProfile('rescuer');
  const acct = await accountOf(provider);
  await db.query(`update public.profiles set city = '╪ز┘ç╪▒╪د┘' where id = $1`, [provider]);

  await cashJob(provider, { invoice: 1000000, earned: 800000, createdAt: `${WINDOW_A.from} 12:00:00+00` });
  await transfer({
    actor: provider, reason: 'job_provider_earnings', createdAt: `${WINDOW_A.from} 13:00:00+00`,
    legs: [[acct, -100000], [await platformAccount('platform.provider_earnings'), 100000]],
  });
  const run = await compute(provider, WINDOW_A.from);
  assert.equal(run.reason, 'computed'); passed++;
  assert.equal(Number((await db.query(`select commission_toman from public.settlement_runs where id = $1`, [run.run_id])).rows[0].commission_toman), 100000); passed++;
  await approve(run.run_id);
  await markPaid(run.run_id, 'REF-F4-REPORT-A');

  await penalty(provider, { amount: 30000, createdAt: `${WINDOW_A.from} 14:00:00+00` });

  // COMMISSION: the revenue account itself. 200,000, not the run's derived 100,000.
  const commission = await report('commission', WINDOW_A.from, WINDOW_A.to, 'day');
  assert.equal(commission.total, 200000); passed++;
  assert.equal(commission.rows.length, 1); passed++;
  assert.equal(commission.rows[0].label, WINDOW_A.from); passed++;
  assert.equal(commission.rows[0].value, 200000); passed++;
  assert.equal(commission.rows[0].entry_count, 1); passed++;
  assert.equal(commission.source.account, 'platform.revenue'); passed++;
  assert.notEqual(commission.total, 100000); passed++;

  // THE COMMISSION READS THE ACCOUNT, NOT THE RUN: the extra share above moved the run's own
  // derived commission (100,000) and left the revenue account's commission (200,000) where the
  // job put it. The report must follow the account. The next assertion is the same fact on the
  // stored run, so the two numbers are visibly different in the same window.
  const storedRunCommission = Number(await scalar(`select commission_toman from public.settlement_runs where id = $1`, [run.run_id]));
  assert.notEqual(storedRunCommission, commission.total); passed++;

  // SETTLEMENT: the paid run of 100,000 in the window, and 30,000 pending (the late penalty).
  const settlement = await report('settlement', WINDOW_A.from, WINDOW_A.to, 'day');
  assert.equal(settlement.total.paid_net_toman, 100000); passed++;
  assert.equal(settlement.total.approved_net_toman, 0); passed++;
  assert.equal('draft_net_toman' in settlement.total, false); passed++;
  assert.equal(settlement.total.draft_run_count, 0); passed++;
  assert.equal(settlement.total.pending_entry_count, 1); passed++;
  assert.equal(settlement.total.pending_entries_toman, -30000); passed++;
  assert.deepEqual(settlement.rows, [{ bucket: WINDOW_A.from, status: 'paid', runs: 1, net_toman: 100000 }]); passed++;

  // PROVIDER DEBT: a snapshot of this provider's own account. Balance 1,000,000 - 800,000 - 100,000 - 30,000 = 70,000.
  const debt = await report('provider_debt', WINDOW_A.from, WINDOW_A.to, 'day');
  const row = debt.rows.find((r) => r.profile_id === provider);
  assert.ok(row); passed++;
  assert.equal(row.balance_toman, 70000); passed++;
  assert.equal(row.collected_cash_debt_toman, 1000000); passed++;
  assert.equal(row.unsettled_debt_toman, -30000); passed++;
  assert.equal(row.ceiling_toman, 5000000); passed++;
  assert.equal(row.at_warn, false); passed++;
  assert.equal(debt.source.snapshot, true); passed++;

  // PENALTIES: one cancel_penalty of 30,000 posted by a rescuer.
  const penalties = await report('penalties', WINDOW_A.from, WINDOW_A.to, 'day');
  assert.equal(penalties.total, 30000); passed++;
  assert.deepEqual(penalties.rows, [{ reason: 'cancel_penalty', role: 'rescuer', value: 30000, entry_count: 1 }]); passed++;
  assert.equal(penalties.source.account, 'platform.penalties'); passed++;

  // BREAKDOWN: the profile legs in the window: +1,000,000 - 800,000 - 100,000 - 30,000 = 70,000.
  // Four profile entries. The city is set above; the service type is the source type (no onsite job).
  const breakdown = await report('breakdown', WINDOW_A.from, WINDOW_A.to, 'day');
  assert.equal(breakdown.total, 70000); passed++;
  assert.deepEqual(breakdown.rows.by_role, [{ key: 'rescuer', value: 70000, entry_count: 4 }]); passed++;
  assert.deepEqual(breakdown.rows.by_city, [{ key: '╪ز┘ç╪▒╪د┘', value: 70000, entry_count: 4 }]); passed++;
  assert.deepEqual(breakdown.rows.by_service_type, [{ key: 'hauling_request', value: 70000, entry_count: 4 }]); passed++;

  // DAILY TREND, one day: the commission 200,000, the paid net 100,000, the pending -30,000.
  const trend = await report('daily_trend', WINDOW_A.from, WINDOW_A.to, 'day');
  assert.deepEqual(trend.rows, [{ day: WINDOW_A.from, commission_toman: 200000, settled_net_toman: 100000, pending_net_toman: -30000 }]); passed++;
  assert.deepEqual(trend.total, { commission_toman: 200000, settled_net_toman: 100000, pending_net_toman: -30000 }); passed++;

  // A DRAFT RUN IS COUNTED, NOT SUMMED (D13). The fixture is dated 2024-03-20, outside WINDOW_A,
  // so none of the figures above move. Its own net (700,000 - 500,000 = 200,000) shows on its row
  // and is left out of every total.
  const draftProvider = await seedProfile('service');
  await cashJob(draftProvider, { invoice: 700000, earned: 500000, createdAt: '2024-03-20 12:00:00+00' });
  const draft = await compute(draftProvider, '2024-03-20');
  assert.equal(draft.reason, 'computed'); passed++;
  const draftReport = await report('settlement', '2024-03-20', '2024-03-20', 'day');
  assert.equal('draft_net_toman' in draftReport.total, false); passed++;
  assert.equal(draftReport.total.draft_run_count, 1); passed++;
  assert.equal(draftReport.total.paid_net_toman, 0); passed++;
  assert.equal(draftReport.total.approved_net_toman, 0); passed++;
  assert.deepEqual(draftReport.rows, [{ bucket: '2024-03-20', status: 'draft', runs: 1, net_toman: 200000 }]); passed++;
  assert.match(draftReport.source.draft_note, /recomputable snapshot, not a settled amount/); passed++;
}

// ===========================================================================
// 3) WINDOW B, the daily trend across three days. 2024-04-01 has the activity; the other two
//    days must report zeros, never an invented value.
// ===========================================================================
async function groupB() {
  const provider = await seedProfile('service');
  await cashJob(provider, { invoice: 500000, earned: 400000, createdAt: `${WINDOW_B.from} 12:00:00+00` });
  const run = await compute(provider, WINDOW_B.from);
  await approve(run.run_id);
  await markPaid(run.run_id, 'REF-F4-REPORT-B');
  await penalty(provider, { amount: 20000, createdAt: `${WINDOW_B.from} 15:00:00+00` });

  const trend = await report('daily_trend', WINDOW_B.from, WINDOW_B.to, 'day');
  assert.deepEqual(trend.rows, [
    { day: '2024-04-01', commission_toman: 100000, settled_net_toman: 100000, pending_net_toman: -20000 },
    { day: '2024-04-02', commission_toman: 0, settled_net_toman: 0, pending_net_toman: 0 },
    { day: '2024-04-03', commission_toman: 0, settled_net_toman: 0, pending_net_toman: 0 },
  ]); passed++;
  assert.deepEqual(trend.total, { commission_toman: 100000, settled_net_toman: 100000, pending_net_toman: -20000 }); passed++;

  // A week bucket of the same window carries the same total: the granularity moves the buckets, not the sums.
  const weekly = await report('commission', WINDOW_B.from, WINDOW_B.to, 'week');
  assert.equal(weekly.total, 100000); passed++;
  const monthly = await report('commission', WINDOW_B.from, WINDOW_B.to, 'month');
  assert.equal(monthly.total, 100000); passed++;
  assert.equal(monthly.rows[0].label, '2024-04-01'); passed++;
}

// ===========================================================================
// 4) EVERY ANSWER NAMES ITS SOURCE. A table and a column, for every kind.
// ===========================================================================
async function group4() {
  for (const kind of KINDS) {
    const answer = await report(kind, WINDOW_A.from, WINDOW_A.to, 'day');
    assert.equal(answer.kind, kind); passed++;
    assert.equal(answer.from, WINDOW_A.from); passed++;
    assert.equal(answer.to, WINDOW_A.to); passed++;
    assert.equal(answer.granularity, 'day'); passed++;
    assert.ok(answer.total !== undefined); passed++;
    assert.ok(answer.rows !== undefined); passed++;
    assert.ok(Array.isArray(answer.source.tables) && answer.source.tables.length > 0, `${kind} must name its tables`); passed++;
    assert.ok(Array.isArray(answer.source.columns) && answer.source.columns.length > 0, `${kind} must name its columns`); passed++;
  }
}

async function main() {
  db = await openSchemaDb(fileURLToPath(new URL('../', import.meta.url)));

  ADMIN = await seedProfile('owner');
  await db.query(`update public.profiles set is_admin = true where id = $1`, [ADMIN]);
  passed++;

  await group1();
  await groupA();
  await groupB();
  await group4();

  await db.close();
  console.log(`${passed} finance-reports assertions passed`);
}

await main();
