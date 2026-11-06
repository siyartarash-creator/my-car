import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSchemaDb, buildSchemaDb } from './helpers/schema-snapshot.mjs';
import { seedApprovedDocuments } from './helpers/approved-documents.mjs';

// WU-FINANCE-F2b: the debt ceiling's evidence. osaa/specs/finance.md section 2
// rule 6 and section 4 row F2b. The decision private.ceiling_decision(uuid) is
// the only place the ceiling is decided. public.can_accept_work(uuid) is the
// client-facing permission layer over it, and the three accept RPCs call the
// decision directly. This file proves: the stop boundary on real RPC calls; that a direct call to the
// lowest-level accept branch is refused too; the three distinct refusal states
// and their precedence; that a provider with no cash collected is never blocked;
// that nothing in the ceiling path moves a balance; the predicate's contract as
// data; the accept-path inventory, measured against the live catalog; that the
// lock precedes the sum in the live body; and that the migration rolls back to
// exactly the pre-migration schema.
//
// Fixtures are INSERTed directly in the state an accept RPC expects, because
// the request-creation chain is not walked here. The accepts themselves are the
// real RPCs, called as the real roles.

const MIGRATION_FILE = '202611060000_ledger_debt_ceiling.sql';
const ROLLBACK_FILE = '202611060000_ledger_debt_ceiling_rollback.sql';

// The accept-path inventory. Pinned as a literal array in this file on purpose:
// a new accept RPC that is not registered here must fail the suite below.
const ACCEPT_PATH_FUNCTIONS = [
  'respond_to_dispatch_offer',
  'respond_to_onsite_offer',
  'respond_to_price_revision',
];
// INSERT-time binds, deliberately outside the UPDATE-assignment population (TD-032).
const NOT_ACCEPT_PATHS = {
  create_service_request: 'INSERT-time bind: the buyer names the provider when the row is born, so no UPDATE assigns provider_id and the scan never reaches it. The ceiling prices a provider taking work, not a buyer creating a request (TD-032).',
  place_order: 'INSERT-time bind, the same reason as create_service_request: no UPDATE assigns a provider. It posts no ledger row in this phase (F2a TD-034), so there is no metered balance to act on (TD-032).',
};
// The per-name pin. Each accept body must call the CORE with the provider it names.
// The client-facing wrapper's name is a second, separate assertion: no accept body
// may call it.
const CEILING_CALLS = {
  respond_to_dispatch_offer: /private\.ceiling_decision\s*\(\s*o\.provider_id\s*\)/i,
  respond_to_onsite_offer:   /private\.ceiling_decision\s*\(\s*o\.provider_id\s*\)/i,
  respond_to_price_revision: /private\.ceiling_decision\s*\(\s*o\.provider_id\s*\)/i,
};
const WRAPPER_CALL = /public\.can_accept_work\s*\(/i;

// The population measurement: every public, security definer function that
// authenticated may execute, whose body UPDATEs a job table and assigns
// provider_id. Written out here so this file does not depend on F1's helper.
const POPULATION_SQL = `
  select p.proname, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute')
     and p.prosrc ~* 'update[[:space:]]+(only[[:space:]]+)?public\\.(hauling_requests|onsite_requests|service_requests|orders)([^a-z_]|$).*?set[[:space:]].*?provider_id[[:space:]]*='
   order by p.proname`;

const DISPATCH_ACCEPT = `select public.respond_to_dispatch_offer($1::uuid, 'accept') as outcome`;
const ONSITE_ACCEPT = `select public.respond_to_onsite_offer($1::uuid, 'accept') as outcome`;
const REVISION_ACCEPT = `select public.respond_to_price_revision($1::uuid, true) as outcome`;

let passed = 0;
let db;

async function scalar(sql, params) {
  return Object.values((await db.query(sql, params)).rows[0])[0];
}

// `as`: the client path. Sets the PostgREST-style role so GRANTs are exercised
// on the RPC call itself. The RPCs are SECURITY DEFINER, so their own reads and
// writes run as the owner and are not filtered by RLS.
async function as(uid, fn) {
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub','${uid ?? ''}',false);`);
  try { return await fn(); } finally { await db.exec('reset role'); }
}
// `asOwner`: only the jwt claim is set, for the ledger helper, which the owner
// calls. It is not callable as authenticated.
async function asOwner(uid, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub','${uid ?? ''}',false);`);
  try { return await fn(); } finally { await db.exec(`select set_config('request.jwt.claim.sub','',false);`); }
}

// Runs an accept as `uid` and asserts it raises a message matching `pattern`.
// Returns the message, so the caller can compare it with the others.
async function raisesWith(uid, sql, params, pattern) {
  let message = null;
  try { await as(uid, () => db.query(sql, params)); } catch (err) { message = err.message; }
  assert.notEqual(message, null, `expected the call to raise ${pattern}, but it succeeded`);
  assert.match(message, pattern);
  passed++;
  return message;
}

async function ledgerCount() {
  return Number(await scalar(`select count(*)::int from public.ledger_entries`));
}
async function ledgerReversalCount() {
  return Number(await scalar(`select count(*)::int from public.ledger_entries where reverses_entry_id is not null`));
}
async function ledgerRows() {
  return (await db.query(`select id, signed_amount, reason from public.ledger_entries order by id`)).rows;
}
async function accountOf(profileId) {
  return scalar(`select id from public.ledger_accounts where profile_id = $1`, [profileId]);
}
async function platformAccount(code) {
  return scalar(`select id from public.ledger_accounts where code = $1`, [code]);
}
async function balanceOf(accountId) {
  return Number(await scalar(`select coalesce(sum(signed_amount),0)::bigint from public.ledger_entries where account_id = $1`, [accountId]));
}

// The grant is revoked from every client role, so the predicate is called as the
// OWNER. The jwt claim is the subject itself, so the predicate's own self-check
// passes for the profile it is asked about.
async function canAcceptWork(profileId) {
  return asOwner(profileId, async () =>
    (await db.query(`select public.can_accept_work($1::uuid) as v`, [profileId])).rows[0].v);
}

// A decline, as the given caller. Returns the RPC's answer.
async function decline(uid, fn, offerId) {
  return (await as(uid, () => db.query(`select public.${fn}($1::uuid, 'decline') as outcome`, [offerId]))).rows[0].outcome;
}

async function ceilingRow(role) {
  const row = (await db.query(
    `select ceiling_toman, warn_at_percent, stop_at_percent, is_active from public.ledger_debt_ceilings where role = $1`, [role]
  )).rows[0];
  return row ? {
    ceiling: Number(row.ceiling_toman),
    warn: Number(row.warn_at_percent),
    stop: Number(row.stop_at_percent),
    active: row.is_active,
  } : null;
}

// Seeds a user the way the product does: the AFTER INSERT trigger on auth.users
// creates public.profiles from the meta-data, so the row is never written here.
// Every mobile must be unique, because the column is unique.
let mobileCounter = 0;
async function seedProfile(userType, { suspended = false } = {}) {
  const id = crypto.randomUUID();
  const mobile = '09' + String(100000000 + (++mobileCounter)).slice(0, 9);
  await db.query(
    `insert into auth.users (id, raw_user_meta_data) values ($1, $2::jsonb)`,
    [id, JSON.stringify({ name: `F2b ${userType} ${mobileCounter}`, mobile, user_type: userType })]);
  const row = (await db.query(`select user_type from public.profiles where id = $1`, [id])).rows[0];
  assert.equal(row?.user_type, userType, 'the create_profile trigger must have created the profile with the requested user_type');
  passed++;
  if (suspended) await db.query(`update public.profiles set is_suspended = true where id = $1`, [id]);
  return id;
}

// A ledger transfer through the F1 helper, as the owner. Each call gets a fresh
// source id, so every leg is unique under ledger_entries_event_leg_unique.
async function postTransfer(actorId, sourceType, reason, legs) {
  return asOwner(actorId, () => scalar(
    `select post_ledger_transfer($1::text, $2::uuid, $3::text, $4::jsonb, $5::jsonb)`,
    [sourceType, crypto.randomUUID(), reason, JSON.stringify(legs), JSON.stringify({ note: 'f2b test' })],
  ));
}
// A cash job's collection: the provider holds the platform's cash (positive
// balance = debt), and platform.clearing is the counterparty.
async function seedCashDebt(providerId, amount) {
  const acct = await accountOf(providerId);
  const clearing = await platformAccount('platform.clearing');
  await postTransfer(providerId, 'hauling_request', 'job_cash_collected', [
    { account_id: acct, signed_amount: amount },
    { account_id: clearing, signed_amount: -amount },
  ]);
}
// A settled online-style job: only the provider's earned share posts, so the
// provider's balance goes negative. Nothing was collected in cash. F2c moved the
// provider's share onto 'job_provider_earnings' with platform.provider_earnings as
// the counterparty (the commission now lives on platform.revenue, which this
// fixture does not need), so the provider's balance effect is unchanged.
async function seedEarningsOnly(providerId, amount) {
  const acct = await accountOf(providerId);
  const earnings = await platformAccount('platform.provider_earnings');
  await postTransfer(providerId, 'hauling_request', 'job_provider_earnings', [
    { account_id: acct, signed_amount: -amount },
    { account_id: earnings, signed_amount: amount },
  ]);
}

// A rescuer with approved documents (for the dispatch and price-revision paths)
// and an optional cash debt.
async function rescuerWithDebt(debtToman, { suspended = false, approved = true } = {}) {
  const id = await seedProfile('rescuer', { suspended });
  if (approved) await seedApprovedDocuments(db, id);
  if (debtToman) await seedCashDebt(id, debtToman);
  return id;
}
// A service provider with approved ON-SITE documents and an optional cash debt.
async function serviceWithDebt(debtToman) {
  const id = await seedProfile('service');
  await seedApprovedDocuments(db, id, { target: 'onsite' });
  if (debtToman) await seedCashDebt(id, debtToman);
  return id;
}

// Catalog ids seeded by earlier migrations (measured on the live schema).
const VEHICLE_SEDAN = 'a1000000-0000-4000-8000-000000000001';   // public.vehicle_types, code 'sedan'
const HAULING_FLATBED = 'a2000000-0000-4000-8000-000000000002'; // public.hauling_vehicle_types, code 'flatbed'
const ONSITE_OIL = 'b1000000-0000-4000-8000-000000000001';      // public.onsite_service_types, slug 'oil-change'

// Each fixture is a fresh row set in the live NOT NULL and CHECK shape. A fresh
// invitation is made for every accept, decline and revision, because the schema
// allows one pending revision per request.
async function haulingInvitation(providerId, customerId, { quotedPrice = 1000000 } = {}) {
  const requestId = crypto.randomUUID();
  const offerId = crypto.randomUUID();
  await db.query(
    `insert into public.hauling_requests (
       id, requester_id, vehicle_type_id, is_movable, hauling_vehicle_type_id,
       origin_lat, origin_lng, destination_mode, destination_lat, destination_lng,
       scope, distance_km, quoted_price_toman, status, dispatching_at)
     values ($1,$2,$3,true,$4,35.70,51.33,'map_point',35.72,51.35,'intracity',10,$5,'dispatching',now())`,
    [requestId, customerId, VEHICLE_SEDAN, HAULING_FLATBED, quotedPrice]);
  await db.query(
    `insert into public.hauling_dispatch_offers (id, request_id, provider_id, offer_deadline_at, distance_km)
     values ($1,$2,$3, now() + interval '1 hour', 3)`,
    [offerId, requestId, providerId]);
  return { requestId, offerId };
}
async function onsiteInvitation(providerId, customerId, { quotedPrice = 1000000 } = {}) {
  const requestId = crypto.randomUUID();
  const offerId = crypto.randomUUID();
  await db.query(
    `insert into public.onsite_requests (
       id, requester_id, vehicle_type_id, service_type_id,
       origin_lat, origin_lng, quoted_price_toman, status, dispatching_at)
     values ($1,$2,$3,$4,35.70,51.33,$5,'dispatching',now())`,
    [requestId, customerId, VEHICLE_SEDAN, ONSITE_OIL, quotedPrice]);
  await db.query(
    `insert into public.onsite_dispatch_offers (id, request_id, provider_id, offer_deadline_at, distance_km)
     values ($1,$2,$3, now() + interval '1 hour', 3)`,
    [offerId, requestId, providerId]);
  return { requestId, offerId };
}
// revisedToman must be strictly greater than lockedToman (the CHECK), so a test
// that wants another revised price passes a matching lockedToman.
async function priceRevision(invitation, rescuerId, revisedToman, { lockedToman = 900000 } = {}) {
  const revId = crypto.randomUUID();
  await db.query(
    `insert into public.request_price_revisions
       (id, request_id, offer_id, proposed_by, locked_price_toman, revised_price_toman, reason, status)
     values ($1,$2,$3,$4,$5,$6,'test: cost changed',$7)`,
    [revId, invitation.requestId, invitation.offerId, rescuerId, lockedToman, revisedToman, 'pending']);
  return revId;
}

async function haulingState(requestId) {
  return (await db.query(`select status, provider_id from public.hauling_requests where id = $1`, [requestId])).rows[0];
}
async function onsiteState(requestId) {
  return (await db.query(`select status, provider_id from public.onsite_requests where id = $1`, [requestId])).rows[0];
}
async function offerResponse(table, offerId) {
  return scalar(`select response from public.${table} where id = $1`, [offerId]);
}
async function revisionStatus(revId) {
  return scalar(`select status from public.request_price_revisions where id = $1`, [revId]);
}

// ===========================================================================
// 1) THE BOUNDARY, on real RPC calls. The thresholds are read from the data,
//    so the boundary is recomputed here from the row and not from a literal.
// ===========================================================================
async function groupBoundary() {
  const row = await ceilingRow('rescuer');
  const threshold = row.ceiling * row.stop / 100;
  assert.equal(threshold, 4750000, `the seeded rescuer row must give a 4,750,000 stop threshold (got ${threshold})`);
  passed++;
  // Exactly one toman either side of the threshold, derived from the data.
  assert.equal(4749999, threshold - 1); passed++;
  assert.equal(4750000, threshold); passed++;

  const customer = await seedProfile('owner');

  // Dispatch, just below the threshold: the accept SUCCEEDS.
  const below = await rescuerWithDebt(4749999);
  assert.equal(Number(await scalar(`select count(*) from public.ledger_accounts where profile_id = $1`, [below])), 1,
    'the account-provisioning trigger must create one ledger account for a cash-debt provider'); passed++;
  const belowInv = await haulingInvitation(below, customer);
  const outcome = (await as(below, () => db.query(DISPATCH_ACCEPT, [belowInv.offerId]))).rows[0].outcome;
  assert.equal(outcome, 'accepted'); passed++;
  const belowReq = await haulingState(belowInv.requestId);
  assert.equal(belowReq.status, 'accepted'); passed++;
  assert.equal(belowReq.provider_id, below); passed++;
  assert.equal((await canAcceptWork(below)).reason, 'below_stop_threshold'); passed++;

  // Dispatch, exactly at the threshold: the accept RAISES, and nothing moves.
  const atRescuer = await rescuerWithDebt(4750000);
  const atInv = await haulingInvitation(atRescuer, customer);
  const countBefore = await ledgerCount();
  await raisesWith(atRescuer, DISPATCH_ACCEPT, [atInv.offerId], /debt_ceiling_reached/);
  const atReq = await haulingState(atInv.requestId);
  assert.equal(atReq.status, 'dispatching'); passed++;
  assert.equal(atReq.provider_id, null); passed++;
  assert.equal(await offerResponse('hauling_dispatch_offers', atInv.offerId), 'pending'); passed++;
  assert.equal(await ledgerCount(), countBefore, 'a refused accept must write no ledger row'); passed++;

  // FIX 4: the ceiling bites only when work is TAKEN. At exactly 95% a decline
  // RETURNS 'declined' and writes no ledger row; an accept on another fresh
  // invitation still raises. Both answers are asserted against the same count.
  const declineInv = await haulingInvitation(atRescuer, customer);
  const freshAcceptInv = await haulingInvitation(atRescuer, customer);
  const beforeDecline = await ledgerCount();
  assert.equal(await decline(atRescuer, 'respond_to_dispatch_offer', declineInv.offerId), 'declined'); passed++;
  assert.equal(await offerResponse('hauling_dispatch_offers', declineInv.offerId), 'declined'); passed++;
  await raisesWith(atRescuer, DISPATCH_ACCEPT, [freshAcceptInv.offerId], /debt_ceiling_reached/);
  assert.equal(await ledgerCount(), beforeDecline, 'a decline and a refused accept must write no ledger row'); passed++;

  // On-site, the same boundary on respond_to_onsite_offer.
  const onsiteBelow = await serviceWithDebt(4749999);
  const onsiteBelowInv = await onsiteInvitation(onsiteBelow, customer);
  const onsiteOutcome = (await as(onsiteBelow, () => db.query(ONSITE_ACCEPT, [onsiteBelowInv.offerId]))).rows[0].outcome;
  assert.equal(onsiteOutcome, 'accepted'); passed++;
  const onsiteBelowReq = await onsiteState(onsiteBelowInv.requestId);
  assert.equal(onsiteBelowReq.status, 'accepted'); passed++;
  assert.equal(onsiteBelowReq.provider_id, onsiteBelow); passed++;

  const onsiteAt = await serviceWithDebt(4750000);
  const onsiteAtInv = await onsiteInvitation(onsiteAt, customer);
  const onsiteCountBefore = await ledgerCount();
  await raisesWith(onsiteAt, ONSITE_ACCEPT, [onsiteAtInv.offerId], /debt_ceiling_reached/);
  const onsiteAtReq = await onsiteState(onsiteAtInv.requestId);
  assert.equal(onsiteAtReq.status, 'dispatching'); passed++;
  assert.equal(onsiteAtReq.provider_id, null); passed++;
  assert.equal(await offerResponse('onsite_dispatch_offers', onsiteAtInv.offerId), 'pending'); passed++;
  assert.equal(await ledgerCount(), onsiteCountBefore); passed++;

  // The on-site twin of FIX 4: decline returns 'declined' at 95%, accept raises.
  const onsiteDeclineInv = await onsiteInvitation(onsiteAt, customer);
  const onsiteFreshAcceptInv = await onsiteInvitation(onsiteAt, customer);
  const onsiteBeforeDecline = await ledgerCount();
  assert.equal(await decline(onsiteAt, 'respond_to_onsite_offer', onsiteDeclineInv.offerId), 'declined'); passed++;
  assert.equal(await offerResponse('onsite_dispatch_offers', onsiteDeclineInv.offerId), 'declined'); passed++;
  await raisesWith(onsiteAt, ONSITE_ACCEPT, [onsiteFreshAcceptInv.offerId], /debt_ceiling_reached/);
  assert.equal(await ledgerCount(), onsiteBeforeDecline, 'an on-site decline and a refused accept must write no ledger row'); passed++;
}

// ===========================================================================
// 2) THE REFUSAL SURVIVES A DIRECT LOWEST-LEVEL CALL. respond_to_price_revision's
//    offer-stage accept branch is called directly, with no UI and no filter. The
//    caller is the CUSTOMER; the subject is the PROPOSING rescuer.
// ===========================================================================
async function groupPriceRevision() {
  const customer = await seedProfile('owner');

  const atRescuer = await rescuerWithDebt(4750000);
  const inv = await haulingInvitation(atRescuer, customer);
  const rev = await priceRevision(inv, atRescuer, 5200000);
  const refusal = await raisesWith(customer, REVISION_ACCEPT, [rev], /debt_ceiling_reached/);
  assert.doesNotMatch(refusal, /forbidden/, 'the customer must be refused by the ceiling, never by an authorization check'); passed++;
  assert.equal(await revisionStatus(rev), 'pending'); passed++;
  assert.equal((await haulingState(inv.requestId)).status, 'dispatching'); passed++;
  assert.equal((await haulingState(inv.requestId)).provider_id, null); passed++;

  // The counterpart: a rescuer below the threshold, through the same branch, is
  // accepted, so the refusal above cannot be the branch being broken in general.
  const belowRescuer = await rescuerWithDebt(4749999);
  const belowInv = await haulingInvitation(belowRescuer, customer);
  const belowRev = await priceRevision(belowInv, belowRescuer, 5200000);
  await as(customer, () => db.query(REVISION_ACCEPT, [belowRev]));
  assert.equal(await revisionStatus(belowRev), 'accepted'); passed++;
  const belowReq = await haulingState(belowInv.requestId);
  assert.equal(belowReq.status, 'accepted'); passed++;
  assert.equal(belowReq.provider_id, belowRescuer); passed++;
}

// ===========================================================================
// 3) PRECEDENCE. Three distinct states, each proven by a real raise. The
//    suspension and documents guards answer first; the ceiling is the third.
// ===========================================================================
async function groupPrecedence() {
  const customer = await seedProfile('owner');

  const suspended = await rescuerWithDebt(4750000, { suspended: true });
  const suspendedInv = await haulingInvitation(suspended, customer);
  const undocumented = await rescuerWithDebt(4750000, { approved: false });
  const undocumentedInv = await haulingInvitation(undocumented, customer);
  const neither = await rescuerWithDebt(4750000);
  const neitherInv = await haulingInvitation(neither, customer);

  const messages = [];
  messages.push(await raisesWith(suspended, DISPATCH_ACCEPT, [suspendedInv.offerId], /account_suspended/));
  messages.push(await raisesWith(undocumented, DISPATCH_ACCEPT, [undocumentedInv.offerId], /documents_not_approved/));
  messages.push(await raisesWith(neither, DISPATCH_ACCEPT, [neitherInv.offerId], /debt_ceiling_reached/));
  assert.equal(new Set(messages).size, 3, `the three refusal states must be three distinct messages: ${JSON.stringify(messages)}`);
  passed++;
}

// ===========================================================================
// 4) A PROVIDER WHOSE JOBS WERE PAID ONLINE IS NEVER BLOCKED. Balance zero with
//    nothing collected, and a balance that is negative from commission only.
// ===========================================================================
async function groupNeverBlocked() {
  const customer = await seedProfile('owner');
  const rescuerRow = await ceilingRow('rescuer');
  const threshold = rescuerRow.ceiling * rescuerRow.stop / 100;

  const idle = await rescuerWithDebt(0);
  assert.equal(await balanceOf(await accountOf(idle)), 0); passed++;
  assert.ok(0 < threshold, 'a zero balance must sit below the stop threshold'); passed++;
  const idleInv = await haulingInvitation(idle, customer);
  assert.equal((await as(idle, () => db.query(DISPATCH_ACCEPT, [idleInv.offerId]))).rows[0].outcome, 'accepted'); passed++;
  const idleVerdict = await canAcceptWork(idle);
  assert.equal(idleVerdict.decision, 'allow'); passed++;

  const online = await rescuerWithDebt(0);
  await seedEarningsOnly(online, 300000);
  assert.ok((await balanceOf(await accountOf(online))) < 0, 'an earnings-only provider must have a negative balance'); passed++;
  const onlineInv = await haulingInvitation(online, customer);
  assert.equal((await as(online, () => db.query(DISPATCH_ACCEPT, [onlineInv.offerId]))).rows[0].outcome, 'accepted'); passed++;
  assert.equal((await canAcceptWork(online)).decision, 'allow'); passed++;
}

// ===========================================================================
// 5) THE APPEND-ONLY INVARIANT HOLDS THROUGH THE CEILING PATH. Nothing that
//    refuses, accepts or reads moves a balance. The snapshot is taken after the
//    fixtures are seeded and before any accept or refusal in this group.
// ===========================================================================
async function groupAppendOnly() {
  const customer = await seedProfile('owner');
  const atCeiling = await rescuerWithDebt(4750000);
  const belowRescuer = await rescuerWithDebt(4749999);
  const atInv = await haulingInvitation(atCeiling, customer);
  const belowInv = await haulingInvitation(belowRescuer, customer);

  const rowsBefore = await ledgerRows();
  const countBefore = await ledgerCount();
  const reversalsBefore = await ledgerReversalCount();

  await raisesWith(atCeiling, DISPATCH_ACCEPT, [atInv.offerId], /debt_ceiling_reached/);
  await as(belowRescuer, () => db.query(DISPATCH_ACCEPT, [belowInv.offerId]));
  await canAcceptWork(atCeiling);
  await canAcceptWork(belowRescuer);

  assert.deepEqual(await ledgerRows(), rowsBefore, 'no ledger row may change through the ceiling path'); passed++;
  assert.equal(await ledgerCount(), countBefore); passed++;
  assert.equal(await ledgerReversalCount(), reversalsBefore); passed++;

  await assert.rejects(
    () => db.query(`update public.ledger_entries set signed_amount = signed_amount + 1
                     where id = (select id from public.ledger_entries limit 1)`),
    /ledger_entries_are_append_only/,
  );
  passed++;
  assert.equal(await ledgerCount(), countBefore); passed++;
}

// ===========================================================================
// 6) THE PREDICATE'S OWN CONTRACT, asserted as data. Scope, the unknown-id
//    path, and the thresholds read as data, changed and restored.
// ===========================================================================
async function groupContract() {
  const ghost = await canAcceptWork(crypto.randomUUID());
  assert.equal(ghost.decision, 'allow'); passed++;
  assert.equal(ghost.reason, 'account_not_found'); passed++;
  assert.equal(ghost.error_code, null); passed++;

  // The grant is revoked from every client role: as authenticated, the engine
  // refuses the call before the body runs. Then the catalog itself, so a future
  // migration that grants it is caught even if the call above were not run.
  const anyClient = await seedProfile('rescuer');
  await raisesWith(anyClient, `select public.can_accept_work($1::uuid) as v`, [anyClient], /permission denied for function can_accept_work/);
  const clientGrant = await scalar(`select has_function_privilege('authenticated', 'public.can_accept_work(uuid)', 'execute')`);
  assert.equal(clientGrant, false, `has_function_privilege('authenticated', 'public.can_accept_work(uuid)', 'execute') must be false (measured: ${clientGrant})`);
  passed++;

  // Defence in depth behind the revoked grant. The predicate refuses a caller
  // asking about a different profile. Run as the OWNER, with the jwt claim set to
  // a non-admin profile other than the subject, so only the in-body check can
  // refuse it.
  const otherCaller = await seedProfile('rescuer');
  const subject = await seedProfile('rescuer');
  let forbidden = null;
  try {
    await asOwner(otherCaller, () => db.query(`select public.can_accept_work($1::uuid)`, [subject]));
  } catch (err) { forbidden = err.message; }
  assert.notEqual(forbidden, null, 'a caller asking about a different profile must be refused, but the call succeeded');
  assert.match(forbidden, /forbidden/); passed++;

  // The predicate is the permission layer over the core. For a provider asking
  // about itself, it must return exactly what the core returns for the same id.
  const provider = await rescuerWithDebt(4750000);
  const viaWrapper = await canAcceptWork(provider);
  const viaCore = await asOwner(provider, async () =>
    (await db.query(`select private.ceiling_decision($1::uuid) as v`, [provider])).rows[0].v);
  assert.deepEqual(viaWrapper, viaCore, 'the wrapper must return exactly what the core returns for the same provider'); passed++;
  assert.equal(viaWrapper.decision, 'refuse'); passed++;

  // A seller with a real, large balance is out of scope: escrow, not cash.
  const seller = await seedProfile('seller');
  const sellerAcct = await accountOf(seller);
  const clearing = await platformAccount('platform.clearing');
  await postTransfer(seller, 'manual', 'manual_test_balance', [
    { account_id: sellerAcct, signed_amount: 5000000 },
    { account_id: clearing, signed_amount: -5000000 },
  ]);
  assert.ok((await balanceOf(sellerAcct)) >= 4750000, 'the seller fixture must hold a real balance over the threshold'); passed++;
  const sellerVerdict = await canAcceptWork(seller);
  assert.equal(sellerVerdict.decision, 'allow'); passed++;
  assert.equal(sellerVerdict.reason, 'no_ceiling_for_role'); passed++;

  // Deactivate the rescuer row: the same over-threshold provider is now allowed.
  // Reactivate it: refused again. This is what makes the numbers data.
  const over = await rescuerWithDebt(4750000);
  await db.query(`update public.ledger_debt_ceilings set is_active = false where role = 'rescuer'`);
  try {
    const off = await canAcceptWork(over);
    assert.equal(off.decision, 'allow'); passed++;
    assert.equal(off.reason, 'no_ceiling_for_role'); passed++;
  } finally {
    await db.query(`update public.ledger_debt_ceilings set is_active = true where role = 'rescuer'`);
  }
  const back = await canAcceptWork(over);
  assert.equal(back.decision, 'refuse'); passed++;
  assert.equal(back.reason, 'debt_ceiling_reached'); passed++;

  // Stop at 50% instead of 95%: a provider at 60% debt is refused. Back to 95%:
  // allowed again.
  const midway = await rescuerWithDebt(3000000);
  assert.equal((await canAcceptWork(midway)).decision, 'allow'); passed++;
  try {
    await db.query(`update public.ledger_debt_ceilings set stop_at_percent = 50 where role = 'rescuer'`);
    const tighter = await canAcceptWork(midway);
    assert.equal(tighter.decision, 'refuse'); passed++;
    assert.equal(Number(tighter.stop_at_percent), 50); passed++;
  } finally {
    await db.query(`update public.ledger_debt_ceilings set stop_at_percent = 95 where role = 'rescuer'`);
  }
  assert.equal((await canAcceptWork(midway)).decision, 'allow'); passed++;
}

// ===========================================================================
// 7) THE STRUCTURAL INVENTORY. The population is measured from the live catalog,
//    and the self-proof strips a guard in this run's own PGlite instance (never
//    supabase/migrations) and proves the inventory notices.
// ===========================================================================
async function liveBody(name, schema = 'public') {
  const rows = (await db.query(
    `select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = $2 and p.proname = $1`, [name, schema]
  )).rows;
  assert.equal(rows.length, 1, `${schema}.${name} must exist exactly once`);
  return rows[0].prosrc;
}

// The measured body around the ceiling call, for a failure message.
function excerpt(body) {
  const at = body.search(/ceiling_decision|can_accept_work/i);
  return at < 0 ? body.slice(0, 400) : body.slice(Math.max(0, at - 160), at + 160);
}

// A name fails when its body does not call the core with its provider, or when
// it calls the client-facing wrapper.
async function ceilingCallFailures() {
  const failing = [];
  for (const name of ACCEPT_PATH_FUNCTIONS) {
    const body = await liveBody(name);
    if (!CEILING_CALLS[name].test(body) || WRAPPER_CALL.test(body)) failing.push(name);
  }
  return failing;
}

async function groupInventory() {
  // (a) every pinned name's live body calls the core with its provider, and no
  //     accept body calls the client-facing wrapper.
  for (const name of ACCEPT_PATH_FUNCTIONS) {
    const body = await liveBody(name);
    assert.match(body, CEILING_CALLS[name],
      `${name} must call private.ceiling_decision(o.provider_id). Measured: ...${excerpt(body)}...`); passed++;
    assert.doesNotMatch(body, WRAPPER_CALL,
      `${name} must not call the client-facing public.can_accept_work. Measured: ...${excerpt(body)}...`); passed++;
  }
  assert.deepEqual(await ceilingCallFailures(), []); passed++;

  // (b) the population, measured here, must equal the pinned array.
  const measured = (await db.query(POPULATION_SQL)).rows.map((r) => r.proname);
  const unexplained = measured.filter((n) => !ACCEPT_PATH_FUNCTIONS.includes(n) && !(n in NOT_ACCEPT_PATHS));
  assert.deepEqual(unexplained, [],
    `accept-shaped functions that are neither pinned nor excluded: ${unexplained.join(', ')} (measured: ${measured.join(', ')})`);
  passed++;
  assert.deepEqual(measured.filter((n) => ACCEPT_PATH_FUNCTIONS.includes(n)), ACCEPT_PATH_FUNCTIONS,
    `the measured population must equal the pinned array (measured: ${measured.join(', ')})`);
  passed++;

  // (c) no accept body gates the CALLER (uid). respond_to_price_revision is called
  //     by the CUSTOMER, so a uid-based check there would gate the wrong person
  //     and must be red. The provider-naming form is pinned per name in (a).
  for (const name of ACCEPT_PATH_FUNCTIONS) {
    const body = await liveBody(name);
    assert.doesNotMatch(body, /(can_accept_work|ceiling_decision)\s*\(\s*uid\s*\)/i, `${name} gates the caller (uid), not the provider`); passed++;
  }

  await selfProof();
}

async function dispatchDef() {
  return (await db.query(
    `select pg_get_functiondef('public.respond_to_dispatch_offer(uuid,text)'::regprocedure) as def`
  )).rows[0].def;
}

// Strips the dispatch guard in this run's own database and proves BOTH detectors
// notice: the per-name pin, and the inventory membership check. The original
// definition is restored in a finally, and the restore is asserted. Mirrors
// selfProof() in tests/suspension-guard-coverage.mjs.
async function selfProof() {
  const originalDef = await dispatchDef();

  // The whole guard block: the call and the check on its result. Stripping only
  // the check would leave the call in place, and the call is what is inventoried.
  // If the guard's shape changes, update THIS stripper, not the assertions.
  const guardBlockRe = /\s*v_ceiling\s*:=\s*private\.ceiling_decision\s*\(\s*o\.provider_id\s*\)\s*;\s*if\s*\(\s*v_ceiling\s*->>\s*'decision'\s*\)\s*<>\s*'allow'\s+then\s*raise\s+exception\s+'%',\s*coalesce\(\s*v_ceiling\s*->>\s*'error_code',\s*'debt_ceiling_reached'\s*\)\s*;\s*end\s+if\s*;/i;
  const occurrences = originalDef.match(new RegExp(guardBlockRe.source, 'gi'));
  assert.equal(occurrences ? occurrences.length : 0, 1,
    'respond_to_dispatch_offer ceiling-guard shape changed -- the self-proof stripper (guardBlockRe) needs updating; stop and report, do not edit the assertions');
  passed++;
  const strippedDef = originalDef.replace(guardBlockRe, '');
  assert.notEqual(strippedDef, originalDef); passed++;

  await db.exec(strippedDef);
  try {
    const strippedBody = await liveBody('respond_to_dispatch_offer');
    assert.doesNotMatch(strippedBody, CEILING_CALLS.respond_to_dispatch_offer,
      'self-proof FAILED: the per-name pin still matches respond_to_dispatch_offer after its guard was stripped'); passed++;
    assert.ok((await ceilingCallFailures()).includes('respond_to_dispatch_offer'),
      'self-proof FAILED: the inventory did not report respond_to_dispatch_offer after its guard was stripped'); passed++;
  } finally {
    await db.exec(originalDef);
  }
  assert.equal(await dispatchDef(), originalDef, 'the restore must reproduce the original respond_to_dispatch_offer definition'); passed++;
  assert.deepEqual(await ceilingCallFailures(), []); passed++;
}

// ===========================================================================
// 8) THE LOCK IS REAL SQL, NOT A PROMISE. The live body takes FOR UPDATE on the
//    provider's ledger account, and that lock comes BEFORE the sum.
// ===========================================================================
async function groupLockOrder() {
  // The decision lives in the private core, so the lock and the sum are measured there.
  const body = await liveBody('ceiling_decision', 'private');
  const lockMatch = body.match(/from\s+public\.ledger_accounts\b[^;]*\bfor\s+update\b/i);
  const sumIndex = body.search(/\bsum\s*\(\s*(?:[a-z_]+\.)?signed_amount\s*\)/i);
  assert.ok(lockMatch, 'private.ceiling_decision must take SELECT ... FOR UPDATE on public.ledger_accounts'); passed++;
  assert.ok(sumIndex >= 0, 'private.ceiling_decision must sum signed_amount over public.ledger_entries'); passed++;
  assert.ok(lockMatch.index < sumIndex,
    `the ledger lock must come BEFORE the sum: lock at index ${lockMatch.index}, sum at index ${sumIndex}`);
  passed++;

  // The core is not executable by any client role. PUBLIC is read from the ACL
  // itself; a NULL proacl means the default, which grants PUBLIC execute.
  for (const role of ['authenticated', 'anon']) {
    const granted = await scalar(
      `select has_function_privilege($1::text, 'private.ceiling_decision(uuid)', 'execute')`, [role]);
    assert.equal(granted, false, `${role} must not be able to execute private.ceiling_decision (measured: ${granted})`); passed++;
  }
  const publicGranted = await scalar(
    `select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     where p.oid = 'private.ceiling_decision(uuid)'::regprocedure
                       and a.grantee = 0 and a.privilege_type = 'EXECUTE')`);
  assert.equal(publicGranted, false, 'PUBLIC must not hold EXECUTE on private.ceiling_decision'); passed++;
}

// ===========================================================================
// 9) ROLLBACK FIDELITY, on its own isolated database. Exactly like
//    tests/finance-postings.mjs's rollbackFidelity.
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

  return rows.sort();
}

async function rollbackFidelity(projectRoot) {
  // The "one migration earlier" database: every migration except F2b.
  const preDb = await buildSchemaDb(projectRoot, { exclude: [MIGRATION_FILE] });
  const preSnapshot = await schemaSnapshot(preDb);
  await preDb.close();

  const full = await openSchemaDb(projectRoot);
  const migrationSql = fs.readFileSync(path.join(projectRoot, 'supabase/migrations', MIGRATION_FILE), 'utf8');
  const rollbackSql = fs.readFileSync(path.join(projectRoot, 'supabase/rollback', ROLLBACK_FILE), 'utf8');

  await full.exec(rollbackSql);

  const afterRollbackSnapshot = await schemaSnapshot(full);
  assert.deepEqual(afterRollbackSnapshot, preSnapshot,
    'the schema must equal the pre-F2b schema after running the rollback (a restored accept body must match its source character for character)');
  passed++;

  for (const sig of ['public.can_accept_work(uuid)', 'private.ceiling_decision(uuid)', 'private.ledger_debt_ceiling_for(text)']) {
    assert.equal((await full.query(`select to_regprocedure('${sig}') as r`)).rows[0].r, null, `${sig} must no longer exist after the rollback`);
    passed++;
  }
  assert.equal((await full.query(`select to_regclass('public.ledger_debt_ceilings') as r`)).rows[0].r, null,
    'public.ledger_debt_ceilings must no longer exist after the rollback');
  passed++;

  await assert.doesNotReject(() => full.exec(rollbackSql), 'running the rollback file a second time must not error');
  passed++;

  await assert.doesNotReject(() => full.exec(migrationSql), 're-applying the migration after a rollback must succeed');
  passed++;
  const seeded = Number((await full.query(`select count(*)::int as n from public.ledger_debt_ceilings`)).rows[0].n);
  assert.equal(seeded, 3, 're-applying the migration must seed exactly three ceiling rows');
  passed++;

  await full.close();
}

async function main() {
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  db = await openSchemaDb(projectRoot);

  await groupBoundary();
  await groupPriceRevision();
  await groupPrecedence();
  await groupNeverBlocked();
  await groupAppendOnly();
  await groupContract();
  await groupInventory();
  await groupLockOrder();
  // Nothing in this whole file reverses anything: no reversal row exists at the end.
  assert.equal(await ledgerReversalCount(), 0, 'nothing in this step may reverse a ledger row'); passed++;

  await db.close();
  await rollbackFidelity(projectRoot);

  console.log(`${passed} ledger debt ceiling assertions passed.`);
}

await main();
