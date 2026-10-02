# Seller Profile ↔ Store Cohesion Contract

This documents the Seller Profile ↔ Store cohesion phase, built on top of
`profile-completion-v1` (`62f0401`) on branch `seller-store-cohesion`. It does
not reopen Profiles Phase 1 (`docs/profiles-phase-1-foundation.md`) and does
not introduce a new Seller system, schema, or migration.

## Account Identity vs Seller Business Identity

Two distinct identities exist on a seller's `profiles` row, and this phase
keeps them separate rather than letting one silently stand in for the other:

- **Account Identity** — `profiles.id`, `profiles.name`, `profiles.mobile`.
  Used for authentication and row ownership. Per Profiles Phase 1, `name` and
  `mobile` have no edit UI; `mobile` is additionally excluded from the DB
  update grant, so both are effectively immutable post-signup. Auth behavior
  is unchanged by this phase.
- **Seller Business Identity** — the seller's own commercial presentation
  data: `profiles.data.seller.shopName` (shop/business name),
  `profiles.phone1`/`phone2` (business contact), `profiles.about` (business
  description), `profiles.social_links` (business socials), plus
  `profiles.data.seller.specialties`/`saleType`/`minOrder` and
  `profiles.data.carExpertise`. Both `seller` and `service` user types share
  this `data.seller` shape.

## Canonical business-name source and fallback

Centralized in `lib/seller-identity.ts` (`resolveSellerBusinessIdentity`):

1. `profiles.data.seller.shopName` when present and non-blank.
2. `profiles.name` (Account Identity) otherwise.
3. Never blank.

This is the one place the fallback is computed; no other file re-implements
the shopName-or-name rule.

## Store consumers updated this phase

- **`app/seller/navigation.tsx`** and **`app/seller/page.tsx`** (seller's own
  dashboard/header): previously showed no identity at all, only a generic
  "فروشنده" badge. Now resolve and display the seller's own Business Identity
  via `resolveSellerBusinessIdentity`, reading their own `profiles` row (self
  read, already permitted by the existing `profile_read` RLS policy — no
  policy change). This is a business-presentation context.
- **`components/ProductCard.tsx`** (`ProductCard.handleAddToCart` and
  `ProductBuyPanel.handleAddToCart`): the two buyer-facing add-to-cart paths
  previously used two different hardcoded fallback strings ("فروشنده" vs
  "فروشگاه ماشین من") for the rare defensive case where no `seller_name`
  snapshot is present. Centralized to one constant,
  `STORE_SELLER_FALLBACK_LABEL`.

No other Store consumer was changed. `app/seller/orders/page.tsx` (buyer's
shipping identity shown to a fulfilling seller) and
`app/admin/product-requests/page.tsx` (seller's legal name/mobile shown to
admin for verification) are Account Identity usages in contexts where the
existing product design already expects Account Identity, not Business
Identity — these were left as-is deliberately.

## Offer integration (`save_offer`)

`save_offer` (current definition in
`supabase/migrations/202609300001_offer_timestamps.sql`) snapshots
`profiles.name` into `product_sellers.seller_name` once, at offer creation
(the insert branch only). No SQL/RPC change was made this phase — see "Known
limitation" below.

## Product Request integration (`request_identity` trigger)

`private.request_identity()` (`supabase/migrations/202609290001_security_foundation.sql`)
is a `BEFORE INSERT` trigger on `product_requests` that snapshots
`profiles.name`/`profiles.mobile` into `seller_name`/`seller_mobile` at
insert time, overwriting whatever the client sent. No SQL/RPC change was
made this phase.

## Buyer/Admin/Seller display changes

- **Seller** (own dashboard/header): now shows resolved Business Identity
  (this phase's change).
- **Buyer** (`app/shop`, `app/shop/[slug]`, `ProductCard`, cart, orders):
  unchanged — continues to read the `product_sellers.seller_name` /
  `product_requests.seller_name` snapshot, which is sourced from `profiles.name`
  (Account Identity) at write time, not `shopName`. See "Known limitation."
- **Admin** (`app/admin/product-requests/page.tsx`): unchanged — continues to
  show the seller's Account Identity (`seller_name`/`seller_mobile`
  snapshot) for request verification. This is existing, intentional behavior
  and is an Account Identity context, not a Business Identity one.

## Historical compatibility

No backfill or rewrite of existing `product_sellers.seller_name` or
`product_requests.seller_name`/`seller_mobile` rows was performed. Existing
snapshot data remains valid historical data, per the no-migration/no-backfill
constraint of this phase.

## Privacy/Security

No RLS policy, grant, or trigger was changed. No new Profile field was made
public. `profiles.mobile` and `profiles.data` remain inaccessible to any role
other than the owning user or an admin, exactly as before. The business
contact fields consumed by Store (`phone1`/`phone2`) are only ever read from
the seller's own row (self-read), never exposed to buyers/other sellers by
this phase's changes.

## Backward compatibility verified

- Seller with full business profile (`shopName` set): dashboard shows the
  shop name.
- Seller without a shop name: dashboard falls back to `profiles.name`;
  never blank.
- Old `profiles.data` shapes / sellers who never touched `data.seller`:
  `resolveSellerBusinessIdentity` treats a missing `data`/`data.seller` as
  "no shopName" and falls back to `profiles.name` — no crash on
  `undefined`/`null`.
- Existing and new offers/requests: unaffected, since no SQL/RPC path was
  changed.

## Known limitation (requires a future, separately authorized migration)

Buyer-facing and existing denormalized Store surfaces
(`product_sellers.seller_name`, `product_requests.seller_name`) cannot be
made to show the seller's chosen Business Identity (`shopName`) without
either:

1. Modifying the `save_offer` SQL function (and the `request_identity`
   trigger) to snapshot `profiles.data.seller.shopName` with a
   `profiles.name` fallback instead of `profiles.name` directly — this is a
   change to an existing SQL function definition, which per this phase's
   mandate requires a migration and is **not pre-authorized**; or
2. Granting buyers/other sellers RLS read access to another user's
   `profiles` row (even a narrow projection) to resolve `shopName` live —
   this is an RLS/security change and a privacy-exposure decision, also
   **not pre-authorized**.

Per the mandate (no migration, no RLS change without explicit authorization,
no backfill), this phase leaves buyer-facing identity on the existing
`profiles.name`-sourced snapshot, which already satisfies the fallback rule
(`shopName` → `profiles.name`, never blank) in the degenerate case where
`shopName` was never consulted. This is a real, documented gap between the
seller's intended shop identity and what buyers currently see — not a
regression introduced by this phase.

**Recommendation for a future phase:** update `save_offer`'s insert branch
and `request_identity()` to call `resolveSellerBusinessIdentity`-equivalent
logic in SQL (read `profiles.data->'seller'->>'shopName'` with a
`profiles.name` fallback) when first creating a row. This requires one small,
reviewable migration, no backfill, and no RLS change (both functions already
run as `SECURITY DEFINER` with full `profiles` read access). Live resolution
via RLS is not recommended — it would require exposing a cross-user Profile
field query surface that does not currently exist.

## Deferred (explicitly out of scope, unchanged this phase)

- Rewriting `save_offer` / `request_identity` to source `shopName` (see
  above).
- Any backfill of historical `seller_name`/`seller_mobile`.
- Public Seller Profile, Seller verification, ratings/reviews, reputation,
  Profiles Phase 2, Marketplace redesign, payout/payment architecture.
- `ProfileStatusCard.tsx`'s pre-existing inconsistency (it checks
  `data.seller.shopName` for `user_type === "seller"` but not for
  `user_type === "service"`, even though both types save into the same
  `data.seller` shape) — out of scope for this Seller-Store phase; not
  touched.
