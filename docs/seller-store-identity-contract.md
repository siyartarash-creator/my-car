# Seller Profile ↔ Store Cohesion Contract

This documents the Seller Profile ↔ Store cohesion phase, reconciled onto the
authoritative Store baseline `phase-5-store-completion @
020858ed40c84f1dedf92f076921ceab03a1e43f` on branch
`phase-5-seller-store-cohesion`. It does not reopen Profiles Phase 1
(`docs/profiles-phase-1-foundation.md`) and does not introduce a new Seller
system or schema.

This phase now includes the one small SQL migration that the app-only
checkpoint (`d0df4c9`, see "Known limitation" below in its original form)
deliberately deferred: `supabase/migrations/202610030000_seller_business_identity_snapshot.sql`
updates the buyer-facing `save_offer`/`request_identity` snapshot source to
the same shopName-with-fallback rule used on the seller's own dashboard. See
"Offer integration" and "Product Request integration" below for the current
state.

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

Authoritative `save_offer` source: `supabase/migrations/202609300004_discount_requests.sql`
(the last migration in the Phase 4/5 chain that redefines the function;
`202609300005`/`202609300006` only reference it in comments). Its Task 4.2A
discount-threshold enforcement, above-threshold `discount_requests` routing,
pending-request supersession, and price-change-ambiguous rejection are all
preserved unchanged by `202610030000_seller_business_identity_snapshot.sql`,
which changes only the `seller_name` snapshot source expression inside the
INSERT branch:

```sql
select coalesce(nullif(regexp_replace(data->'seller'->>'shopName', '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''), name)
  into seller_name from public.profiles where id=auth.uid();
```

`profiles.data.seller.shopName` is used when it trims to a non-empty value
(the POSIX `[:space:]` class covers spaces, tabs, newlines, carriage returns,
and any mix of these — a shopName consisting only of such characters trims to
`''`, which `nullif` maps to `null`, falling through to `profiles.name`).
This is computed once, at offer creation (the INSERT branch only); the UPDATE
branch never re-snapshots `seller_name`, so a seller changing their shopName
later does not retroactively alter an existing Offer's stored name.

## Product Request integration (`request_identity` trigger)

`private.request_identity()` (originally defined in
`supabase/migrations/202609290001_security_foundation.sql`, redefined by
`202610030000_seller_business_identity_snapshot.sql`) is a `BEFORE INSERT`
trigger on `product_requests` that snapshots the same shopName-with-fallback
expression (above) plus `profiles.mobile` into `seller_name`/`seller_mobile`
at insert time, overwriting whatever the client sent. `seller_mobile`'s
source, the trigger's `SECURITY DEFINER` characteristics, and its grants are
unchanged.

## Buyer/Admin/Seller display changes

- **Seller** (own dashboard/header): now shows resolved Business Identity
  (this phase's change).
- **Buyer** (`app/shop`, `app/shop/[slug]`, `ProductCard`, cart, orders):
  continues to read the `product_sellers.seller_name` /
  `product_requests.seller_name` snapshot. As of
  `202610030000_seller_business_identity_snapshot.sql`, *new* snapshots
  prefer `shopName` (with the `profiles.name` fallback) over Account
  Identity; snapshots taken before that migration remain on whatever they
  were computed from at the time (see "Historical compatibility").
- **Admin** (`app/admin/product-requests/page.tsx`): unchanged — continues to
  show the seller's Account Identity (`seller_name`/`seller_mobile`
  snapshot) for request verification. This is existing, intentional behavior
  and is an Account Identity context, not a Business Identity one.

## Historical compatibility

No backfill or rewrite of existing `product_sellers.seller_name` or
`product_requests.seller_name`/`seller_mobile` rows was performed, and none
is planned. Rows written before `202610030000_seller_business_identity_snapshot.sql`
keep whatever name they were snapshotted with (`profiles.name`, since that
was the only source available at the time); only rows inserted after that
migration compute the shopName-with-fallback value. This is intentional:
snapshots are point-in-time records of what was displayed, not a live view
of the current profile.

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
- Existing and new offers/requests: the 10 deterministic
  `tests/database-security.mjs` cases for the new snapshot source (meaningful
  shopName, missing, null, empty, spaces/tabs/newlines/CR/mixed-whitespace,
  and old/partial `data.seller` shapes without `shopName`) pass, alongside
  the full Phase 4/5 discount-threshold/request/approval regression suite
  and `request_identity`/mobile/historical-row-immutability assertions — 318
  assertions passing against both empty and pre-existing-data schema
  fixtures, plus `tests/write-boundary.mjs` and `tests/profile-validation.mjs`.
  `npm run typecheck`, scoped `eslint` on every changed file, and
  `npm run build` all pass.

## Resolved this phase: buyer-facing snapshot now sources `shopName`

The limitation documented in the app-only checkpoint (`d0df4c9`) — that
buyer-facing `product_sellers.seller_name`/`product_requests.seller_name`
snapshots could not show `shopName` without a migration — is resolved by
`supabase/migrations/202610030000_seller_business_identity_snapshot.sql`
(see "Offer integration" / "Product Request integration" above). No RLS
change was needed: both `save_offer` and `request_identity()` already run
`SECURITY DEFINER` with full `profiles` read access, so the shopName lookup
happens server-side at snapshot time, not via a new cross-user read grant.

An earlier draft of this migration
(`202610021000_seller_business_identity_snapshot.sql`, authored before the
Phase 4 discount-request work landed and never applied to any shared
environment) is superseded and must not be used: it was written against a
pre-Phase-4 `save_offer` body and would have silently dropped the
Task 4.2A/4.2B discount-threshold enforcement, `discount_requests` routing,
and pending-request supersession if deployed.

## Deferred (explicitly out of scope, unchanged this phase)

- Any backfill of historical `seller_name`/`seller_mobile` (see "Historical
  compatibility").
- Public Seller Profile, Seller verification, ratings/reviews, reputation,
  Profiles Phase 2, Marketplace redesign, payout/payment architecture.
- `ProfileStatusCard.tsx`'s pre-existing inconsistency (it checks
  `data.seller.shopName` for `user_type === "seller"` but not for
  `user_type === "service"`, even though both types save into the same
  `data.seller` shape) — out of scope for this Seller-Store phase; not
  touched.
