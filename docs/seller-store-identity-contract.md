# Seller Profile ↔ Store Cohesion Contract

This documents the Seller Profile ↔ Store cohesion phase, built on top of
`profile-completion-v1` (`62f0401`) on branch `seller-store-cohesion`. It does
not reopen Profiles Phase 1 (`docs/profiles-phase-1-foundation.md`) and does
not introduce a new Seller system or schema.

**Update (migration `202610021000_seller_business_identity_snapshot.sql`,
Main-Manager-authorized continuation):** `save_offer`'s insert branch and the
`request_identity` trigger now snapshot the Business Identity fallback
(`shopName` → `profiles.name`) instead of `profiles.name` directly, for
**new** offers/requests only. This closes the "Known limitation" originally
documented below for new rows; historical rows remain untouched. No RLS,
grant, or trigger-binding change was made — only the `seller_name` source
expression inside the two existing `SECURITY DEFINER` function bodies.

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

`save_offer`'s insert branch (migration `202610021000_seller_business_identity_snapshot.sql`,
superseding `202609300001_offer_timestamps.sql`'s snapshot source only) now
computes:

```sql
select coalesce(nullif(btrim(data->'seller'->>'shopName'), ''), name)
  into seller_name from public.profiles where id=auth.uid();
```

i.e. the same shopName → account-name fallback as
`resolveSellerBusinessIdentity`, evaluated once at insert time and persisted
into `product_sellers.seller_name`, exactly as before. The `UPDATE` branch
(editing an existing offer) still never touches `seller_name` — unchanged
behavior, not a regression: an offer's seller identity is fixed at creation,
same as prior to this phase.

## Product Request integration (`request_identity` trigger)

`private.request_identity()` (migration `202610021000_seller_business_identity_snapshot.sql`,
superseding the body defined in `202609290001_security_foundation.sql`) is
still the same `BEFORE INSERT` trigger on `product_requests`, with only its
`seller_name` source changed to the same fallback expression as `save_offer`.
`seller_mobile` is unchanged — still sourced from `profiles.mobile` (Account
Identity), since the mission does not authorize widening business contact
exposure and no business "contact mobile" concept exists in the schema.

## Buyer/Admin/Seller display changes

- **Seller** (own dashboard/header): shows resolved Business Identity (prior
  phase change, unaffected by the migration).
- **Buyer** (`app/shop`, `app/shop/[slug]`, `ProductCard`, cart, orders):
  for **new** offers created after this migration, now sees the seller's
  `shopName` (falling back to account name) via the existing
  `product_sellers.seller_name` column — no app code change was needed, since
  buyer-facing code already just displays that column. **Existing/historical**
  offers keep their original `profiles.name`-sourced snapshot, unchanged.
- **Admin** (`app/admin/product-requests/page.tsx`): unchanged — continues to
  show `product_requests.seller_name`/`seller_mobile`. For **new** requests,
  `seller_name` now reflects the Business Identity fallback (same column, same
  display code); `seller_mobile` is still the Account mobile, as before. This
  remains an acceptable Account/Business mix for admin verification purposes
  — no admin-facing code changed.

## Historical compatibility

No backfill or rewrite of existing `product_sellers.seller_name` or
`product_requests.seller_name`/`seller_mobile` rows was performed, before or
after the migration. Existing snapshot data remains valid historical data.
Only rows inserted after the migration is applied compute `seller_name` via
the new fallback expression.

## Privacy/Security

No RLS policy, grant, or trigger binding was added, dropped, or weakened by
the migration — `revoke`/`grant` statements for `save_offer` and
`request_identity` are byte-for-byte identical to the prior migrations (see
migration file comment). Both functions remain `SECURITY DEFINER` with
`search_path = ''`, owned and invoked exactly as before; only the
`seller_name` source expression inside each function body changed. No new
Profile field was made public; `profiles.mobile` and `profiles.data` remain
inaccessible to any role other than the owning user or an admin. The
`data->'seller'->>'shopName'` read happens only inside the existing
`SECURITY DEFINER` functions (which already had full `profiles` access) —
no new cross-user read path was created for buyers/other sellers.

## Migration identifier

`supabase/migrations/202610021000_seller_business_identity_snapshot.sql` —
authorized by Main Manager as a bounded continuation of this same phase (not
a new phase). Backward compatibility verified for: seller with `shopName` set
(new offer/request snapshots use it), seller without `shopName` (falls back
to account name), old/partial `profiles.data` shapes including `null` `data`
and a whitespace-only `shopName` (fallback still resolves, no error), and
historical rows (left untouched). See
`tests/database-security.mjs` for the regression coverage added for this
migration (93 assertions, up from 84, on both empty and pre-existing-data
schema replays).

## Backward compatibility verified

- Seller with full business profile (`shopName` set): dashboard shows the
  shop name.
- Seller without a shop name: dashboard falls back to `profiles.name`;
  never blank.
- Old `profiles.data` shapes / sellers who never touched `data.seller`:
  `resolveSellerBusinessIdentity` treats a missing `data`/`data.seller` as
  "no shopName" and falls back to `profiles.name` — no crash on
  `undefined`/`null`.
- Existing and new offers/requests: unaffected by the application-side phase;
  **new** offers/requests after migration `202610021000` now also get the
  `shopName`-first snapshot (see "Offer integration"/"Product Request
  integration" above); existing rows are untouched.

## Known limitations

- **Resolved this continuation:** buyer-facing `product_sellers.seller_name`
  and `product_requests.seller_name` now reflect the seller's Business
  Identity for rows created after migration `202610021000` — this closed the
  gap originally documented here (modifying `save_offer`/`request_identity`
  was the recommended fix, now applied under explicit Main Manager
  authorization).
- **Still deferred:** live/historical resolution is not retrofitted —
  pre-migration `product_sellers`/`product_requests` rows keep their original
  `profiles.name`-sourced snapshot forever, by design (no backfill
  authorized). A seller who changes their `shopName` after an offer/request
  already exists will not see existing rows update — this matches the
  pre-existing behavior for `profiles.name` changes (also never backfilled)
  and is not a new limitation introduced by this migration.
- **Still out of scope:** any live cross-user Profile read (would require an
  RLS change) and any UPDATE-branch re-snapshot of `save_offer` (editing an
  offer still never touches `seller_name`, unchanged from before this
  migration).

## Deferred (explicitly out of scope)

- Any backfill of historical `seller_name`/`seller_mobile` (migration
  `202610021000` changes only what new INSERTs compute).
- Any RLS change to let buyers/other sellers read another user's `profiles`
  row live.
- Re-snapshotting `seller_name` on `save_offer`'s `UPDATE` branch (editing an
  existing offer).
- Public Seller Profile, Seller verification, ratings/reviews, reputation,
  Profiles Phase 2, Marketplace redesign, payout/payment architecture.
- `ProfileStatusCard.tsx`'s pre-existing inconsistency (it checks
  `data.seller.shopName` for `user_type === "seller"` but not for
  `user_type === "service"`, even though both types save into the same
  `data.seller` shape) — out of scope for this Seller-Store phase; not
  touched.
