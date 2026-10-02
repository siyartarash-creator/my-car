# Admin Panel Completion — Layer 2 completion gate (Checkpoint E)

Status: **PHASE 4 = PASS** (final local closure verification, 2026-10-02).
All automated/local database checks, the Owner-authorized order-line RLS
repair and independent security review, and the authenticated live
Auth/PostgREST/browser checklist pass. This closes Phase 4 only; Phase 5 is
not authorized or started by this result.

## Current closure evidence

- Repository: `D:\projects\my-car`; branch:
  `phase-4-admin-panel-completion`; verified HEAD:
  `87c388f801388a02306ca54b8085737794174567`.
- Pre-existing `supabase/.temp/` and the earlier verified local audit fixes
  were preserved. Current scoped local files: this document,
  `app/admin/audit/page.tsx`, `tests/admin-local-functional.mjs`,
  `tests/database-security.mjs`, and the new
  `supabase/migrations/202610020001_admin_order_item_read.sql`. No new
  commit was created; this closure mission did not authorize one.
- `npm run typecheck`: PASS after the audit-page fix. Accepted evidence
  retained; the RLS repair changes no TypeScript/application source.
- `npm run build`: PASS, including after the audit-page fix. The sandbox
  denied the TypeScript worker (`spawn EPERM`); the reviewed local retry
  passed. Existing middleware-deprecation warning remains. Build/server
  processes used `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, a dummy
  non-secret anonymous key, and `NEXT_TELEMETRY_DISABLED=1`, overriding
  hosted environment settings. No dependency install was needed.
- Gate-targeted lint: PASS; changed audit page and new test also lint clean.
- `node tests/database-security.mjs`: PASS after the final reviewed repair,
  302 security/transaction
  assertions + 15 HTTP-to-PostgreSQL integration assertions, **each** for
  empty and existing schemas. No regression relative to the 225/15 baseline.
- `npm run test:admin-seed`: PASS after the new migration, 17 total
  cross-checks and 4 reset checks.
  Dataset: 30 products/offers, 26 active offers, 50 orders, total order value
  11,966,500, 17 multi-seller orders, 11 discount requests, 6 product
  requests, 4 coupons, 5 coupon uses.
- `node tests/write-boundary.mjs`: PASS, 31 HTTP-boundary assertions.
- `node tests/admin-local-functional.mjs`: **PASS**, 172 assertions after
  the final reviewed repair. The test executes the real
  server guards and server-page components against migrated/seeded,
  ephemeral PGlite. It verifies six single-permission navigation/guard/
  widget cases, anonymous/non-operator/no-grant entry denial, all-six-grant
  audit denial at page and RLS layers, Super Admin rendered headline
  totals, all 17 multi-seller order headers and all 67 attached seed lines,
  exact buyer/seller-owned row sets and foreign-ID denial for five buyers
  and five sellers, unrelated-permission and revoked-permission denial,
  actual product audit filters and end-date boundaries.
  Its injected auth identity, read-query adapter and
  Link/client-component replacements do **not** verify Supabase Auth,
  PostgREST, browser interaction, or client-side mutations.
- Live loopback Next server: PASS for anonymous redirects to `/login`
  (307, preserving the requested path) on all 11 Admin routes, including
  product create/edit, plus login rendering (200).
- Authenticated live environment: PASS using Supabase CLI 2.119.0's native
  Linux runtime inside the existing Ubuntu WSL2 distribution. The isolated,
  free `phase4-final` stack ran only on loopback with local Postgres, Auth,
  PostgREST and the Storage dependency required by the baseline migration.
  Every repository migration through `202610020001` applied successfully.
  No Docker installation, hosted Supabase access, Production credential,
  deploy, push or paid service was used.
- Authenticated browser matrix: PASS with test-only identities for Super
  Admin, six isolated single-permission operators, an all-six-permission
  non-admin operator, and a no-grant user. Each isolated operator reached
  its mapped page; unrelated direct URLs redirected to `/admin`. The
  no-grant user was redirected out of the Admin shell, and the all-six
  non-admin was denied `/admin/operators` and `/admin/audit`.
- Live dashboard: PASS. Super Admin rendered 30 products, 30 offers,
  5 sellers, 50 orders, total order value 11,966,500, five 10-order status
  buckets, 3/4/3/1 discount-request buckets, 2/2/1/1 product-request
  buckets, 5 coupon uses, and seven daily buckets of 5. Each operator saw
  only the permission-specific breakdown or trend authorized by the widget
  registry; RLS-visible common product/offer headline counts varied where
  expected.
- Live controls: PASS. Discount approval, offer activation, product-request
  review, coupon activation/deactivation, and product create/update were
  exercised through the browser. The same actions were then exercised with
  their corresponding least-privilege single-permission operators. Final
  audit inspection found all six expected operator/action combinations;
  reversible coupon and product-name changes were restored. One test-only
  product remains in the isolated local database as mutation evidence.
- Audit UI: PASS. Actor, action, target-table and inclusive date filters
  produced the expected parameterized request; the reset link returned to
  unfiltered `/admin/audit`.
- Authenticated PostgREST/RLS: PASS with real local Auth JWTs. The
  `orders.read` operator received exactly 50 order headers, 67 attached line
  items and 17 multi-seller orders. The no-grant user and an unrelated
  `products.write` operator each received zero orders and zero line items.
  This supplies the previously missing transport-level proof for the scoped
  order-line policy without weakening any policy.
- Safe local fixes: audit action/table dropdowns now include product CRUD
  and `products`; the inclusive end-date filter includes fractional seconds
  at the end of the day and excludes the next midnight. The follow-up RLS
  change is strictly the additive authenticated line-item SELECT policy
  described below; no auth helpers, permission keys, write grants, or
  neighboring-table policies changed. Cost: $0; no hosted access/deploy/
  push/merge or Phase 5 work.

## Resolved RLS blocker and independent review

Root cause: `202609300000_fix_order_visibility.sql` made `item_read`'s
buyer path explicitly require `o.user_id=auth.uid()`.
`202609300008_store_admin_audit.sql` later added `orders.read` to the parent
order policy only. That parent-policy widening does not satisfy the
explicit buyer condition on line items. Consequently the non-owner
operator could read 17 multi-seller headers but none of their lines.

Mehdi's explicit **OWNER AUTHORIZATION — PHASE 4 SCOPED RLS REPAIR** permits
this local correction. New migration `202610020001_admin_order_item_read.sql`
adds only `item_orders_read`, `FOR SELECT TO authenticated`, requiring both
`private.has_permission('orders.read')` and an actual parent order visible
through `orders` RLS. Existing `item_read`, grants, DML denial, buyer/seller/
Super Admin access, and neighboring fulfillment/coupon/payout policies
remain intact. This migration has been applied only to ephemeral local
test databases, not a hosted database.

Independent read-only reviewer `phase4_security_review` found an initial
edge case: an unconstrained permission branch would expose legacy items
whose nullable `order_id` has no parent header. The final policy adds the
parent requirement, and the database regressions explicitly assert that
an isolated `orders.read` operator cannot retrieve an orphan by ID while
its existing seller and Super Admin paths still work. Re-review: **PASS,
no remaining actionable security findings** within the migration and
affected regression scope. Runtime/browser checks were not delegated or
claimed by the reviewer.

New database regressions run in both empty and existing schemas and check
exact attached row IDs, all six isolated permission cases, direct foreign-
ID probes, grant/revoke behavior, anonymous and authenticated/no-UID denial,
self-grant/profile escalation denial, INSERT/UPDATE/DELETE denial, and no
new reads of audit logs, fulfillments, coupon usages, or payouts.

## Closure disposition

No Phase 4 blocker remains. The authenticated live functional checklist is
complete with browser, Auth, PostgREST, RLS and atomic-audit evidence. Hold
after Phase 4 closure: do not start Phase 5 without a separate explicit
assignment.

## Historical Cloud dependency blocker (not applicable to this local run)

`npm ci`/`npm install` in this Cloud session cannot complete:
`package-lock.json`'s `resolved` URLs point at `mirror-npm.runflare.com`,
which this session's egress proxy denies by organization policy (403 on
CONNECT — confirmed via `curl $HTTPS_PROXY/__agentproxy/status`). This was
diagnosed in the A+B verification round and reconfirmed to still apply;
Cloud must not re-attempt it. All static review in Checkpoints C–E was done
by reading source and migrations directly, not by running anything that
needs `node_modules`.

## Exact Local verification commands

Run in this order; stop and fix forward on the first failure rather than
skipping ahead.

```bash
# 1. Full project — already verified PASS for A+B at commit 1043932;
#    re-run now that C/D sit on top, since new files can surface new
#    project-wide typecheck/build issues even where lint scope stays narrow.
npm run typecheck
npm run build

# 2. Targeted lint — every file Checkpoints C/D added or touched.
#    (Do not run bare `npm run lint` and fix unrelated pre-existing debt —
#    same scoping rule as the A+B fix-forward round.)
npx eslint \
  app/admin/page.tsx \
  app/admin/audit/page.tsx \
  lib/admin/dashboard.ts \
  lib/admin/modules.ts \
  tests/fixtures/admin-routine-seed.mjs \
  tests/seed-routine-dataset.mjs \
  tests/admin-local-functional.mjs

# 3. Full database-security suite — covers A/B/C's RLS and RPC invariants,
#    including the Checkpoint C audit-boundary assertions added this round.
node tests/database-security.mjs

# 4. Checkpoint D's own seed+cross-check+reset run (LOCAL/EPHEMERAL PGlite
#    only — see tests/fixtures/admin-routine-seed.mjs's header for why it
#    cannot reach Staging/Production even by mistake).
npm run test:admin-seed

# 5. Real local server guards/pages + seeded RLS visibility regression.
#    Includes exact buyer/seller/operator row sets and multi-seller reads.
node tests/admin-local-functional.mjs
```

All five must pass with **no new failures** relative to the confirmed A+B
baseline (`225 database security/transaction assertions passed` ×2 forms,
`15 HTTP-to-PostgreSQL integration assertions passed` ×2) before this gate
is closed. `node tests/database-security.mjs` now includes additional
Checkpoint B (request_read fix) and Checkpoint C (audit-log boundary)
assertions on top of that count — expect a higher total, not the same one.

## Manual / functional checklist

Evidence below combines the retained automated/server/database results with
the completed authenticated live browser and PostgREST checks.

- **Admin permission matrix**: for each of `products.write`,
  `offers.moderate`, `discounts.approve`,
  `requests.review`, `orders.read`, `coupons.manage`: an operator holding
  only that key can reach exactly the pages `lib/admin/modules.ts` maps to
  it and no others. A user holding none of them is redirected away from
  the entire Admin shell. `/admin/products`, create and edit now require
  `products.write` (review fix-forward `49d671f`); there is no no-grant
  entry-level product exception. Automated and authenticated live
  guard/navigation cases pass.
- **Admin entry authorization**: anonymous → redirected to `/login`;
  authenticated non-admin/non-operator → redirected away from `/admin`;
  Super Admin and any single-permission operator → shell renders.
- **Page/action permission enforcement**: direct-URL access to
  `/admin/discount-requests`, `/admin/offers`, `/admin/orders`,
  `/admin/coupons`, `/admin/product-requests`, `/admin/operators`,
  `/admin/audit`, `/admin/products`, product create/edit by a profile
  lacking the specific permission → redirected. Authenticated live direct-
  URL checks pass in addition to the code and server-page checks.
- **RLS/IDOR on touched surfaces**: covered by `tests/database-security.mjs`
  (direct-table-write bypass denial, cross-record/IDOR checks already
  present for discount_requests/product_sellers/coupons/product_requests);
  no new `[id]`-style detail route was added in C/D that takes a
  user-suppliable record id outside those already-tested RPCs, so no new
  IDOR surface was identified requiring a new test.
- **Privileged mutation + atomic audit**: every RPC added across A/B and
  the product-write review fix-forward (grant/
  revoke, approve/reject, activate/deactivate, review, coupon/product CRUD) writes
  `admin_audit_log` in the same transaction — verified by reading each
  function body (single `perform private.log_admin_action(...)` inside the
  same `plpgsql` block as its mutation, no function that mutates without
  one) and by the existing rollback-on-audit-failure test in
  `database-security.mjs`.
- **Discount workflow / Offer moderation / operator grant-revoke**: no
  change in C/D — still exactly the Task 4.2A/4.2B/4.3 + Checkpoint A
  behavior, covered by existing assertions.
- **Product request finality**: review fix-forward `49d671f` permits review
  only while pending; the database suite confirms denied re-decisions do
  not change state or add an audit row. Product CRUD is now audited RPC-only.
- **Dashboard deterministic totals**: `npm run test:admin-seed` passes 17
  independent queries covering product/offer/active-offer/order counts,
  order value and status counts, discount-request counts/statuses, coupon
  usage and operator grant count. The local page test confirms rendered
  headline totals and permission-specific widget presence. Authenticated
  live rendering additionally confirms product-request breakdowns, seller
  count, the seven-day trend, and each operator's RLS-visible widgets;
  operator totals differ from Super Admin totals only where RLS intentionally
  narrows rows.
- **Audit view authorization**: `/admin/audit` as a non-Super-Admin
  operator (even one holding every other permission) → redirected.
  `admin-local-functional.mjs` confirms both the server-page denial and
  zero visible audit rows for an operator holding all six permissions;
  the original database suite also covers its five-permission fixture.
- **Deterministic seed/reset behavior**: `npm run test:admin-seed` asserts
  the dataset is fully removable (all seeded rows gone after
  `resetRoutineDataset`) and does not depend on run order beyond needing a
  freshly migrated database (it is not safe to call `seedRoutineDataset`
  twice against the same instance without a `resetRoutineDataset` between —
  `products.slug` is unique, so a second run fails cleanly on conflict
  rather than silently duplicating data).
- **Search/filter/pagination touched by C**: `/admin/audit`'s actor/
  action/target_table/date filters (GET form, server-rendered) — the live
  combined filter and "حذف فیلترها" reset pass; `/admin/audit`
  and `/admin/orders` (Checkpoint B) both cap at a fixed row limit (200/100)
  with no page-2 control — acceptable at current data volume, flagged here
  rather than silently left undiscoverable.
- **Multi-seller Admin order visibility**: `npm run test:admin-seed`'s
  dataset includes 17 multi-seller orders (`multiSellerOrderCount` in its
  totals). Authenticated live `/admin/orders` renders all 50 headers as an
  `orders.read` viewer, and the same viewer's real Auth JWT returns all
  67 attached lines through PostgREST, grouped into exactly 17 multi-seller
  orders. The no-grant and unrelated-permission JWTs return zero. The
  `order_items` existing `seller_id=auth.uid() or is_admin() or
  exists(...)` read policy (unchanged by A–D) still lets an `orders.read`
  operator actually see every line of a multi-seller order. **Local RLS/
  server-page PASS:** the reviewed additive policy now exposes all attached
  lines to `orders.read`, without removing the existing explicit buyer
  ownership check. Authenticated live transport confirmation also passes.

## Known limitations carried into this gate (not fixed here — out of scope)

- `/admin/audit` and `/admin/orders` list views are capped (200/100 rows)
  with no pagination control — acceptable at this project's current data
  volume; would need real pagination before the row count approaches the
  cap.
- The optional large stress dataset (Checkpoint D) was not built.

## Independent review range

Original preparation range: `011f006` (approved Task 4.3 base) → `ce1be9e`
(Checkpoint D). Commit-by-commit:
`20b5f81` (Checkpoint A), `f0a1ff1` (Checkpoint B), `1043932` (B fix-forward
— request_read + scoped lint), `792e57b` (Checkpoint C), `ce1be9e`
(Checkpoint D).

Current closure inspection extends through `87c388f`: `7e070e8` (gate
preparation), `12722df` (seed identity bootstrap), `49d671f` (independent
review fix-forward: request finality + real audited `products.write`),
`87c388f` (database fixtures). This closure inspection is not an additional
independent review of the whole Phase 4 range. The follow-up independent
security review covers the new line-item policy and affected security
regressions only. Local audit/RLS fixes are uncommitted.
