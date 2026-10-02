# Phase 5 — Store Completion gate

Status: **technical result — READY FOR OWNER PASS** (local verification,
2026-10-02). This closes Phase 5's technical scope only. Mehdi/Owner holds
final PASS/BLOCKED authority; no subsequent phase is started by this result.

Base branch: `phase-5-store-completion`, created from
`phase-4-admin-panel-completion` HEAD `e7c9797891971bfbd1410780d33e84714955c7b7`
("docs: add MY CAR master roadmap"), which contains the Phase 4.5 closure
checkpoint `be654cf7be57a1e84628dcf63bee3f194f4895b8`. Both commits verified
present in branch history before any Phase 5 work started.

## 1. Admin order detail / line-item UI (required work item)

Implemented: `app/admin/orders/[id]/page.tsx`. Server component, gated by
the existing `requirePermission("orders.read")` (same boundary as the list
page, no new permission key). Fetches the order by numeric id
(`.eq("id", id).single()`, `notFound()` on a non-numeric id or no row),
then `order_items` and `seller_fulfillments` by `order_id`, then resolves
seller display names via `product_sellers` the same way the existing buyer
order page does. Read-only: no mutation path, reusing `advance_fulfillment`
and `cancel_order` RPCs unchanged and untouched by this page.

No migration or RLS change was required: `order_items` visibility for an
`orders.read` holder already comes from the existing additive
`item_orders_read` policy (`202610020001_admin_order_item_read.sql`,
Phase 4 closure). This page only renders what that policy already exposes.
`app/admin/orders/page.tsx` rows now link to the detail page instead of
being static.

## 2. Admin pagination (required work item)

`app/admin/orders/page.tsx` and `app/admin/audit/page.tsx` replaced their
fixed `.limit(100)`/`.limit(200)` caps with real `?page=` pagination:
`{ count: "exact" }`, `.range(from, to)`, and a secondary `.order("id", …)`
after the primary `created_at` sort (the same stability pattern already
used by the buyer-facing `app/shop/page.tsx` catalog pagination, so no new
pattern was invented). Existing filters (`status` on orders;
`actor`/`action`/`target_table`/`from`/`to` on audit) compose with the page
param unchanged. Page numbers are clamped
(`Math.max(1, Number.parseInt(...) || 1)`), so a non-numeric, zero,
negative, or absurdly large `?page=` value degrades to page 1 or an empty
(not erroring) result — verified by tests.

Other admin lists with the same cap pattern
(`app/admin/offers/page.tsx` 200, `app/admin/discount-requests/page.tsx`
200, `app/admin/operators/page.tsx` 100) were inspected and are **not**
included in this fix: seeded/realistic current volumes (~30 offers, 11
discount requests, 4 operators) are far below their caps, and the mission
scope explicitly warns against turning Phase 5 into a generic pagination
refactor. See the triage table below for disposition.

## 3. Bounded Store gap review and triage

Buyer (catalog, product detail, cart, checkout, coupon application, order
history/detail/cancellation), Seller (dashboard, product/offer management,
stock, fulfillment advance, product-request flow), and Admin (dashboard,
products, offers, discounts, requests, coupons, orders, audit, operators)
were reviewed for structural/functional gaps (not polish). Findings:

| Gap | Disposition | Rationale |
|---|---|---|
| Admin order detail/line-item UI missing | **FIXED** | Section 1 above. |
| Admin orders/audit fixed row caps, no pagination | **FIXED** | Section 2 above. |
| Dead `/contact` link on public landing page (`app/page.tsx`, "استعلام قیمت دقیق" CTA had no `/contact` route) | **FIXED** | One-line fix: now links to `/shop`, the existing real catalog entry point. No new route/feature built. |
| `app/admin/offers`, `/admin/discount-requests` (`.limit(200)`) and `/admin/operators` (`.limit(100)`) have the same fixed-cap pattern as orders/audit | **ACCEPTED LIMITATION** | Seed/realistic volumes (~30 offers, 11 discount requests, 4 operators) are far below each cap; no evidence of a near-term Store Completion blocker. Revisit if any of these approaches its cap. |
| `app/admin/operators/page.tsx`'s query lists all `profiles`, not only operator accounts, so its 100-row cap could truncate before reaching some non-operator profiles if the user base grows | **DEFERRED TO NAMED FUTURE WORK** | Not reachable at current data volume; revisit together with the operators cap above if/when the user base approaches 100. |
| `app/admin/coupons` admin list has no `.limit()` at all (fetches all rows), unlike every other admin list | **ACCEPTED LIMITATION** | Inconsistent with other lists but not unbounded in practice (4 coupons seeded); not a Store Completion blocker. |
| Seller orders UI has one unreachable button branch gated on a fulfillment status (`"paid"`) that a `seller_fulfillments` row never actually holds (only `orders.status` can be `"paid"`; the fulfillment row itself starts `"pending"`) | **ACCEPTED LIMITATION** | Dead UI branch, not a functional defect — no transition is blocked or wrongly exposed. |
| Pre-existing `react-hooks/set-state-in-effect` lint finding in `app/page.tsx:115` (unrelated to the Phase 5 edit on the same file) | **DEFERRED TO NAMED FUTURE WORK** | Pre-existing debt, not introduced or touched by Phase 5; fixing it was out of this change's scope per the repository's own scoped-lint convention (fix only what you touch). |

No gap found in: seller fulfillment advancement (`advance_fulfillment` RPC,
real transitions, real UI controls), cart (quantity/stock handling, link to
checkout), checkout (quote/place_order RPC flow, coupon apply/remove with
visible discount, COD-only confirmed with no premature payment-method
selector), or seller stock/price management (`save_offer` RPC via the
existing per-offer edit page).

## 4. Order/payment modeling — future non-COD compatibility review

Reviewed `supabase/migrations/202609290002_checkout.sql`. `orders.payment_method`
and `orders.payment_status` are free-form `text` columns (payment_status
further constrained only by `payment_status` not being a fixed enum in the
observed baseline check), not a boolean `is_cod` flag and not a narrow
enum — so introducing a second payment method later is additive (a new
string value plus new handling code), not a breaking schema change. No
code path assumes synchronous settlement beyond what COD actually requires:
`place_order` sets `status='pending'`, `payment_status='pending'` at
creation and never assumes payment completes within the request. No
schema or code change was made here — current modeling already
accommodates the future boundary without speculative abstraction.

Documented future boundary, grounded in this schema:

```
Payment Attempt -> Provider Reference -> Async Result/Webhook/Poll -> Authoritative Payment State
```

A future provider integration would add: a `payment_attempts`-style table
(provider, provider_reference, status) distinct from `orders`; a webhook/poll
handler that is the only writer of `payment_status` transitions for
non-COD orders; and `place_order` would stop assuming immediate
`payment_status='pending'`→(buyer action elsewhere) and instead branch on
payment method at creation. None of this is implemented or scaffolded in
Phase 5 — no real provider, no webhook endpoint, no new table.

## 5. SMS / phone-verification boundary

Reviewed `app/login/page.tsx` and `app/register/page.tsx`: both build a
synthetic Supabase Auth email as `` `${mobile}@mycar.local` `` directly from
the user-submitted mobile string (regex-validated `^09\d{9}$`), with no SMS
or OTP step. No UI text claims or implies verified phone ownership was
found anywhere in `app/` (searched for "verified"/"تایید" near
phone/mobile wording — the only match is Supabase's unrelated generic
email-confirmation error string). The invariant

```
Mobile identifier != verified phone ownership
```

was already documented in `docs/phase-1.md` and the Master Roadmap before
Phase 5, and is preserved unchanged: no code in this phase creates or
relies on an assumption of verified phone ownership for authorization.
No SMS/OTP provider, delivery, or production phone verification was
implemented, per explicit exclusion.

## 6. Concurrency verification

No Phase 5 change touches locking, advisory-lock, or stock/order
consistency code (`private.checkout`, `place_order`, `cancel_order`,
`advance_fulfillment` are all untouched). The existing Gate 1 suite,
`tests/postgres-concurrency.ps1`, already proportionally verifies exactly
the properties the mission calls for against a real local PostgreSQL 17
instance: last-unit oversell prevention, concurrent order creation with
exact stock decrement, concurrent global and per-user coupon caps,
idempotent checkout replay, conflicting-idempotency-key handling,
reverse-order lock acquisition without deadlock, an explicit two-session
lock-wait proof on the same offer row, and concurrent cancellation
restoring stock exactly once (no double-restock).

This suite was **not re-run** in this session: it requires standing up an
empty, dedicated local PostgreSQL 17 database/role (`mycar_gate1`) outside
the PGlite-based suites already run for this gate, and no code it exercises
changed in Phase 5. Re-running an unchanged, already-passing concurrency
suite at that setup cost would not produce new evidence — consistent with
this repository's own "do not re-run unchanged foundational security tests
without a code change that could affect them" convention
(`.claude/skills/my-car-admin`). Documented here rather than re-asserted:
**no new concurrency-sensitive code was introduced; the existing Gate 1
suite's last verified result stands and was not invalidated by this
phase's changes.**

## 7. Data durability check

Local-only inventory task, not Production Readiness. `supabase/config.toml`
contains only `project_id = "my-car"` and `db.major_version = 17` — no
linked hosted Supabase project reference, environment, or backup
configuration is present in this repository to inspect locally.

**Result: NOT VERIFIED — REQUIRES FUTURE HOSTED CHECK.** Per mission
section 13, this is not a Phase 5 blocker.

## 8. Security

No migration, RLS policy, permission key, or SECURITY DEFINER RPC was
added or modified in Phase 5. The new/changed surfaces are: a new
read-only admin page (`app/admin/orders/[id]/page.tsx`) reusing the
existing `requirePermission("orders.read")` guard and the existing
`item_orders_read` RLS policy from Phase 4.5, and pagination added to two
existing read-only list pages with no guard change. An independent
reviewer (fresh context, no prior involvement in the implementation)
examined auth-before-data ordering, IDOR exposure, invalid/out-of-range id
handling, pagination input clamping, and write-capability absence.
**Result: PASS, no findings.**

No regression: `node tests/database-security.mjs` reproduces the exact
Phase 4.5 baseline (302 security/transaction assertions × 2 schema forms,
15 HTTP-to-PostgreSQL integration assertions), unchanged because no
migration was added.

## 9. Tests

- `npm run typecheck` — PASS.
- `npm run build` — PASS (new route `/admin/orders/[id]` registered;
  pre-existing middleware-deprecation warning only).
- Scoped lint (`app/admin/orders/page.tsx`, `app/admin/orders/[id]/page.tsx`,
  `app/admin/audit/page.tsx`, `tests/admin-local-functional.mjs`) — PASS,
  clean. (One pre-existing, unrelated lint finding on a different line of
  `app/page.tsx` was left untouched — see triage table.)
- `node tests/database-security.mjs` — PASS, 302×2 + 15×2, no regression.
- `node tests/write-boundary.mjs` — PASS, 31 assertions.
- `npm run test:admin-seed` — PASS, 17 cross-checks + 4 reset checks.
- `node tests/admin-local-functional.mjs` — **PASS, 186 assertions**
  (up from the Phase 4.5 baseline of 172), including new Phase 5 coverage:
  order-detail access granted for `orders.read` and Super Admin, denied
  (redirect to `/admin`) for every other single permission; real seeded
  order and line-item content rendered; `notFound()` for a non-existent id
  and for a non-numeric id; orders/audit pagination past the last page
  returns an empty result rather than erroring; pagination composes with
  an existing filter (`status`, `target_table`) without error. The test
  harness's fake query builder was extended (not rebuilt) with
  `.range()`, `.in()`, and `count: "exact"` support, and a `notFound()`
  mock was added to its `next/navigation` shim, per this repository's
  "extend, don't rebuild" testing convention.
- Gate 1 PostgreSQL concurrency suite (`tests/postgres-concurrency.ps1`) —
  not re-run; see section 6.

## 10. Deferred / out of scope (unchanged from mission exclusions)

Real payment gateway/settlement, real SMS/OTP, Production deployment/launch,
Automotive AI Assistant, Vehicle Domain Foundation, service history,
roadside assistance, vehicle services, academy, automotive news/content,
heavy-vehicle features, multi-currency, multi-language, multi-tenancy,
speculative scale optimization, seller payout execution, PII/retention
implementation, production observability, and admin bulk/export remain
deferred exactly as the roadmap already states. No exclusion was entered.

## 11. Working tree

Dirty paths at closure, before any commit: the files listed in section 9's
lint list plus `app/admin/orders/[id]/page.tsx` (new),
`app/page.tsx`, `docs/MY_CAR_MASTER_ROADMAP.md` (updated at closure), and
this document. `supabase/.temp/` remains untracked local runtime metadata,
excluded as always.

## 12. Cost

$0. No paid API, subscription, hosted service, or external spend was used.
