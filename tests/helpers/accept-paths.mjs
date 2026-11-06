// WU-FINANCE-F1: the accept-path inventory. F2b (osaa/specs/finance.md
// section 4, row F2b) will need to attach can_accept_work(...) to every
// function that can bind a provider to a job -- this file is the tracked
// artifact that makes that a checklist instead of a guess. F1 adds no
// ceiling predicate and no call to it anywhere; it only builds the list and
// proves the list is complete against the live catalog.
//
// The population is MEASURED, not assumed: scanAcceptPathCandidates(db)
// finds every public, SECURITY DEFINER function authenticated may execute
// whose body contains an UPDATE of one of the four job/request tables that
// assigns the provider/assignee column (provider_id, on every table that
// actually has one). This is the same heuristic-textual-scan spirit as
// tests/suspension-guard-coverage.mjs's Rule B/C/D -- not a full call-graph
// analysis -- but it is deliberately a NARROWER and more specific signature
// than that file's Rule D (which scans for any UPDATE of the two
// hauling/onsite dispatch_offers tables, including an offer merely
// expiring as a side effect of a cancellation). Scanning for the actual
// provider_id ASSIGNMENT on the REQUEST table itself is what "accepts a
// job" means for this inventory, so cancellation paths -- which only touch
// the offers table and never assign a request's provider_id -- never enter
// this population at all; NOT_ACCEPT_PATHS stays empty for exactly that
// reason (see its own comment below), unlike Rule D's three-entry set.
//
// public.service_requests has a provider_id column, but it is assigned
// exactly once, at INSERT time, by the BUYER choosing a provider
// (create_service_request) -- never by an UPDATE, so no function can ever
// match this scan through that table; there is no "accept" event to gate.
// public.orders carries no provider/assignee column at all. Both tables
// stay in the scan's search surface (per the owner's instruction) precisely
// so that a FUTURE accept-shaped change to either one is caught the moment
// it starts assigning a provider, not assumed away.
export const ACCEPT_PATH_FUNCTIONS = [
  'respond_to_dispatch_offer',
  'respond_to_onsite_offer',
  'respond_to_price_revision',
];

export const ACCEPT_PATH_WHAT_IT_BINDS = {
  respond_to_dispatch_offer: 'a rescuer accepting a hauling dispatch invitation becomes hauling_requests.provider_id',
  respond_to_onsite_offer: 'an on-site provider accepting a dispatch invitation becomes onsite_requests.provider_id',
  respond_to_price_revision: "the offer-stage accept branch binds the PROPOSING rescuer to hauling_requests.provider_id when the customer accepts their price increase",
};

// Measured and found empty: see the header above for why cancellation paths
// (which Rule D in suspension-guard-coverage.mjs excludes by name) never
// even enter THIS scan's population in the first place -- they touch only
// the dispatch_offers tables, never a request's provider_id column. Kept as
// an exported object (not simply omitted) so a future entry has a place to
// go, with the same contract as ACCEPT_PATH_WHAT_IT_BINDS: a name here must
// carry a written reason, never a silent exclusion.
export const NOT_ACCEPT_PATHS = {};

// BOUNDARY NOTE: this inventory is UPDATE-assignment acceptances only -- a
// function matched by ACCEPT_PATH_SQL because it UPDATEs an existing job row
// to set provider_id. INSERT-time binding, where a row is born already
// carrying its provider, is deliberately OUTSIDE this population:
// create_service_request (a buyer choosing a provider up front) and
// place_order never run through this scan at all, because there is no
// UPDATE for the scan to find. Whether either of those needs its own
// can_accept_work(...) gate is an F2b product decision, not something this
// list resolves. Read ACCEPT_PATH_FUNCTIONS as "every UPDATE-assignment
// acceptance path", never as "every path that binds a provider to a job".
export const ACCEPT_PATH_SCOPE = 'update_assignment_only';

const ACCEPT_PATH_SQL = `
  select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosrc
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
    and has_function_privilege('authenticated', p.oid, 'execute')
    and p.prosrc ~* 'update[[:space:]]+(only[[:space:]]+)?public\\.(hauling_requests|onsite_requests|service_requests|orders)([^a-z_]|$).*?set[[:space:]].*?provider_id[[:space:]]*='
  order by p.proname`;

export async function scanAcceptPathCandidates(db) {
  return (await db.query(ACCEPT_PATH_SQL)).rows;
}
