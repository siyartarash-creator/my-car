# Phase 1: security foundation

## Identity and permission contract

- Supabase Auth is the identity authority. Browser and server use the same cookie-backed session. Server role gates and write handlers call `getUser()`; a localStorage flag, URL parameter or request user ID is never authorization.
- `profiles.id` matches the verified Auth user. An Auth trigger creates profiles atomically. Signup may choose owner/seller/service/rescuer, preserving the existing self-registration model. Signup can never grant administrator access.
- `profiles.is_admin` and `profiles.user_type` are protected from browser insertion/update. Ordinary profile edits have an explicit column grant list. Administrator provisioning is an operator-only database operation, outside the application API.
- Profiles are private to their owner and administrators. Seller names on Offers are display snapshots; seller UUIDs determine ownership. Public catalog access is limited to active products and visible, active Offers.
- The existing mobile-to-email password login remains. The fake OTP step is removed. This is **not verified phone ownership**; SMS verification/provider work is outside this phase. A hosted project requiring confirmation of the synthetic email must be resolved before signup rollout; do not disable verification implicitly.
- Existing sessions held only in the old browser storage require signing in again. Supabase cookies are the only session used after rollout.

## Product, Offer and cart contract

- Products describe the catalog. `product_sellers.id` is the Offer ID; price, discount, stock and seller identity come from that row.
- Legacy Product price/stock columns remain for data preservation but cannot determine a purchase price. No automatic conversion of legacy Product prices to Offers is performed.
- Cart v2 stores Offer IDs and quantities, with untrusted display snapshots. Old seller-name keyed carts are not imported because they cannot reliably identify an Offer. Cart storage is partitioned by the verified session user; account changes remount private client state.
- `save_offer` validates fields and derives the seller from `auth.uid()`. Sellers cannot change ownership, product identity of an existing Offer, or administrator moderation flags. Hiding an Offer retains historical order references.
- Existing malformed Offers remain stored (`NOT VALID` check) but cannot be purchased. Updated/new Offers must pass the check. Duplicate legacy seller/product Offers need operator review; new duplicates are prevented under an advisory lock.

## Writes and orders

- `/api/write/[action]` accepts only a fixed set of operations, requires a verified session, same-origin JSON requests and a 16 KiB body limit, and uses the user's Supabase client. There is no service-role bypass.
- PostgreSQL functions are the authoritative boundary, including when callers bypass Next.js and call RPC directly. Private helpers are not executable by API roles. SECURITY DEFINER functions have an empty search path and qualified application objects.
- `quote_checkout` computes prices, stock availability, shipping and coupons from the database. `place_order` repeats those checks with row locks; a supplied expected total can only reject a price change, never set a price.
- Checkout atomically creates a parent Order, a fulfillment per seller, immutable item snapshots, stock deductions and coupon usage. Offer locks are acquired in ascending ID order. Coupon row locking serializes redemption limits.
- The existing flat shipping fee of 50,000 toman and cash-on-delivery behavior are preserved. Seller shipping text is descriptive and cannot set a fee. No payment/escrow/payout claims or writes were added.
- A UUID idempotency key is unique per buyer. Same payload/key returns the original order; a changed payload/key is rejected. The client retains the pending attempt for network retries.
- Sellers read their fulfillment/address and their own items; they cannot read or update the parent order or other sellers' items. Allowed fulfillment transitions are pending → processing → shipped → delivered. Parent status is derived across all fulfillments; payment status is untouched.
- Buyer cancellation is allowed only for new unpaid/pending checkouts whose fulfillments are all pending. Stock is returned once. Coupon usage stays consumed to prevent cancellation/redeem cycling. Legacy orders without reliable Offer IDs require operator handling for cancellation.
- Legacy seller order visibility is backfilled using existing seller IDs only. Legacy totals, payment state and Offer identity are not invented or changed.
- Storage writes are owner-prefixed for avatars/request photos, administrator-only for product images. Existing public URLs still read; unscoped legacy avatar writes are no longer allowed.

## Schema provenance

`supabase/schema/observed-public.json` contains filtered application metadata and the supplied inventory's SHA-256, without customer rows, keys or function bodies. The supplied inventory is **not a full pg_dump**: sequence settings, function bodies, schema/default privileges and service configuration were not included.

The baseline migration reconstructs an empty application schema from known columns/constraints/indexes, or validates an existing schema before making security changes. It does not reconstruct managed Supabase Auth/Storage. The old `is_admin` body is replaced explicitly, not claimed to have been exported. Future changes go in new migrations.

## Validation and rollout gate

Run `npm run test:security`, `npm run typecheck`, `npm run lint`, and `npm run build`.

The security suite uses embedded PostgreSQL (PGlite) with minimal Auth/Storage stubs. It exercises migrations against an empty schema and a permissive existing schema, actual grants/RLS, forgery and ownership attacks, coupons, idempotency, fulfillment isolation, cancellation and forced transaction rollback. HTTP tests exercise origin/auth/body checks and error sanitization with mocked Supabase transport. Last-unit competition uses PGlite's serialized connection; it is not an independent-session PostgreSQL concurrency test.

Before hosted rollout, in a staging copy:

1. Take a restorable backup and verify migration/schema drift. Review current administrator flags: the old profile permissions allowed self-escalation, so existing flags cannot be assumed legitimate.
2. Review malformed/duplicate Offers, unassigned legacy order items, existing Storage buckets and Auth email-confirmation configuration. Keep credentials in the operator's existing trusted tooling; do not paste them into chats or commit them.
3. Apply the three migrations in timestamp order. The baseline rejects unexpected public tables/column types. Security migration rejects unexpected Storage object policies. Resolve drift explicitly rather than deleting guards.
4. Exercise real signup/signin/signout, expired-session refresh, account switching, owner/seller/admin access, avatar/request uploads, two-seller checkout, duplicate submission, simultaneous last-stock and last-coupon claims using separate database sessions, seller advancement and buyer cancellation.
5. Run `supabase/tests/post-deploy-check.sql`; all returned checks must be true. Check grants and default privileges separately against the hosted configuration.
6. Schedule a coordinated application/database deployment: old browser checkout writes are intentionally denied after the security migration. Do not deploy only half of this change. Verify again after rollout.

Live migrations change permissions and order behavior. They require the project owner's explicit rollout approval and operator access. Nothing in the implementation/test commands connects to or modifies the hosted database.

Rollback: retain a pre-deployment database backup and the old application revision, but do not blindly restore the old permissive policies. Stop writes, assess orders created since rollout, and use a forward repair or a coordinated database restore. Reverting only the application would re-enable a client path the database intentionally denies.

## Local checkpoint validation (2026-09-29)

- Resumed from the existing Phase 1 implementation on `phase-1-security-foundation`; original comparison base is `5387f75`. Foundation checkpoint: `8b5cc8e`.
- Offline security suite: 84 database assertions and 15 HTTP-to-database assertions for each of empty/existing schemas, plus 31 HTTP/session boundary assertions (229 total). The integration suite executes the real route and SQL functions; Auth and Supabase transport remain test substitutes.
- TypeScript and production build passed. Build used loopback Supabase URL and a non-secret placeholder key; this local build output must not be deployed.
- Full lint identified 24 inherited errors and 3 warnings against the original baseline. The new test helper's lint error was corrected; targeted tests/session lint passes. Full-project lint is not green.
- Diff reviewed for scope and artifacts: no environment files, credentials, build output, temporary scripts or dependency directories are tracked. The observed schema inventory is deliberate provenance; equivalent ACL records are grouped losslessly (930 KB reduced to 157 KB). The separate old-schema SQL fixture is intentional upgrade-test input, not an accidental duplicate migration. Lockfile changes support the pinned offline test dependency.
- No hosted connection or production mutation was performed by this work. Remote state cannot be independently attested without accessing it.
- Phase 1 is not yet closed: real staging Auth/Storage/browser workflows, independent PostgreSQL-session concurrency tests, and hosted configuration/drift checks remain rollout gates. The inherited lint debt is recorded rather than silently treated as a passing check. No Phase 2 work has started.
