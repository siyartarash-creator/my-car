# Admin Panel Completion — Layer 2 completion gate (Checkpoint E)

Status: **prepared, not executed**. This environment's dependency install
is blocked by a confirmed, already-diagnosed network-policy issue (see
"Cloud dependency blocker" below); per this checkpoint's own instructions,
Cloud did not attempt to install, repair, or poll for dependencies again.
Every command below must be run on Local before Checkpoints A–D (or this
gate) can be called verified. Nothing in this document should be read as a
PASS claim.

## Cloud dependency blocker (for context, not re-diagnosed here)

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
  tests/seed-routine-dataset.mjs

# 3. Full database-security suite — covers A/B/C's RLS and RPC invariants,
#    including the Checkpoint C audit-boundary assertions added this round.
node tests/database-security.mjs

# 4. Checkpoint D's own seed+cross-check+reset run (LOCAL/EPHEMERAL PGlite
#    only — see tests/fixtures/admin-routine-seed.mjs's header for why it
#    cannot reach Staging/Production even by mistake).
npm run test:admin-seed
```

All four must pass with **no new failures** relative to the confirmed A+B
baseline (`225 database security/transaction assertions passed` ×2 forms,
`15 HTTP-to-PostgreSQL integration assertions passed` ×2) before this gate
is closed. `node tests/database-security.mjs` now includes additional
Checkpoint B (request_read fix) and Checkpoint C (audit-log boundary)
assertions on top of that count — expect a higher total, not the same one.

## Manual / functional checklist

Static review (this round) confirms these by reading the code; Local
should still exercise them against a running dev server, since none of
this was rendered or clicked:

- **Admin permission matrix**: for each of `products.write` (unused —
  see Known limitation below), `offers.moderate`, `discounts.approve`,
  `requests.review`, `orders.read`, `coupons.manage`: an operator holding
  only that key can reach exactly the pages `lib/admin/modules.ts` maps to
  it and no others; an operator holding none of them sees only `/admin`
  and `/admin/products` (entry-level).
- **Admin entry authorization**: anonymous → redirected to `/login`;
  authenticated non-admin/non-operator → redirected away from `/admin`;
  Super Admin and any single-permission operator → shell renders.
- **Page/action permission enforcement**: direct-URL access to
  `/admin/discount-requests`, `/admin/offers`, `/admin/orders`,
  `/admin/coupons`, `/admin/product-requests`, `/admin/operators`,
  `/admin/audit` by a profile lacking the specific permission → redirected
  (verified in code via `requirePermission`/`requireSuperAdmin`; confirm
  live).
- **RLS/IDOR on touched surfaces**: covered by `tests/database-security.mjs`
  (direct-table-write bypass denial, cross-record/IDOR checks already
  present for discount_requests/product_sellers/coupons/product_requests);
  no new `[id]`-style detail route was added in C/D that takes a
  user-suppliable record id outside those already-tested RPCs, so no new
  IDOR surface was identified requiring a new test.
- **Privileged mutation + atomic audit**: every RPC added across A/B (grant/
  revoke, approve/reject, activate/deactivate, review, coupon CRUD) writes
  `admin_audit_log` in the same transaction — verified by reading each
  function body (single `perform private.log_admin_action(...)` inside the
  same `plpgsql` block as its mutation, no function that mutates without
  one) and by the existing rollback-on-audit-failure test in
  `database-security.mjs`.
- **Discount workflow / Offer moderation / operator grant-revoke**: no
  change in C/D — still exactly the Task 4.2A/4.2B/4.3 + Checkpoint A
  behavior, covered by existing assertions.
- **Dashboard deterministic totals**: `npm run test:admin-seed` cross-checks
  every total `app/admin/page.tsx` computes (product/offer/order counts,
  order value sum, per-status breakdowns, discount/product-request status
  counts, coupon usage) against independent live queries over the same
  tables the dashboard reads — this is the mechanism for validating
  "dashboard deterministic totals" per this checkpoint's requirements. A
  further manual check: after seeding, open `/admin` as the seeded Super
  Admin and each seeded operator and confirm the visible numbers/widgets
  match `totals` printed by the script, and that each operator sees only
  the widgets `lib/admin/dashboard.ts` grants them.
- **Audit view authorization**: `/admin/audit` as a non-Super-Admin
  operator (even one holding every other permission) → redirected;
  confirmed at the RLS layer too (new `database-security.mjs` assertion:
  `operator` with all five non-admin permissions still sees 0
  `admin_audit_log` rows).
- **Deterministic seed/reset behavior**: `npm run test:admin-seed` asserts
  the dataset is fully removable (all seeded rows gone after
  `resetRoutineDataset`) and does not depend on run order beyond needing a
  freshly migrated database (it is not safe to call `seedRoutineDataset`
  twice against the same instance without a `resetRoutineDataset` between —
  `products.slug` is unique, so a second run fails cleanly on conflict
  rather than silently duplicating data).
- **Search/filter/pagination touched by C**: `/admin/audit`'s actor/
  action/target_table/date filters (GET form, server-rendered) — confirm
  each filter narrows results and "حذف فیلترها" clears them; `/admin/audit`
  and `/admin/orders` (Checkpoint B) both cap at a fixed row limit (200/100)
  with no page-2 control — acceptable at current data volume, flagged here
  rather than silently left undiscoverable.
- **Multi-seller Admin order visibility**: `npm run test:admin-seed`'s
  dataset includes 17 multi-seller orders (`multiSellerOrderCount` in its
  totals); confirm `/admin/orders` as an `orders.read` viewer lists them
  and `order_items`' existing `seller_id=auth.uid() or is_admin() or
  exists(...)` read policy (unchanged by A–D) still lets an `orders.read`
  operator actually see every line of a multi-seller order via the widened
  `order_read` policy's `exists(select 1 from orders o where o.id=order_id)`
  clause.

## Known limitations carried into this gate (not fixed here — out of scope)

- `app/admin/products` and `app/admin/products/new` remain gated only at
  the coarse Admin-entry level (`requireAdminAccess()` via the shared
  layout); the underlying `products`/`categories` tables are still written
  through the pre-Phase-4 `admin_write` RLS policy
  (`private.is_admin()`-only, unaudited). `products.write` exists as a
  permission key with no consumer. This was flagged as deferred in
  Checkpoint B and remains deferred — not named in the locked atomic-audit
  list, and converting it is a materially larger change (new RPCs for the
  full product CRUD surface, including image handling) than this gate's
  scope.
- `/admin/audit` and `/admin/orders` list views are capped (200/100 rows)
  with no pagination control — acceptable at this project's current data
  volume; would need real pagination before the row count approaches the
  cap.
- The optional large stress dataset (Checkpoint D) was not built.

## Independent review range

`011f006` (approved Task 4.3 base) → `ce1be9e` (Checkpoint D HEAD at the
time this document was written). Commit-by-commit:
`20b5f81` (Checkpoint A), `f0a1ff1` (Checkpoint B), `1043932` (B fix-forward
— request_read + scoped lint), `792e57b` (Checkpoint C), `ce1be9e`
(Checkpoint D).
