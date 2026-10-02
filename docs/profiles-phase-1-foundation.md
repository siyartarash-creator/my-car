# Profiles Phase 1 — Foundation Completion

This documents the Profile system as completed in this phase, on top of the
`profile-completion-v1` checkpoint (`9f594f9`). It does not replace or
re-validate `docs/phase-1.md` (security foundation); it records the
Profile-specific decisions made in this phase.

## Architecture (unchanged)

One unified `public.profiles` table with a JSONB `data` column, one unified
`/profile` route that renders role-specific forms (`owner`, `seller`,
`service`, `rescuer`) based on `profiles.user_type`. No parallel Profile
system, role-specific tables, or new generic schema were introduced.

## Name / mobile policy

`name` and `mobile` are **not exposed as editable fields** anywhere in the
`/profile` UI — the form only edits `phone1`/`phone2` (secondary contact
numbers), address, avatar, and role-specific data. This matches the
database grant (`grant update (...) on public.profiles`), which already
excludes `mobile` entirely; `name` is grantable at the DB layer but the
application UI never offers it for editing in this phase, so no
presentation change was needed. No RLS/grant/trigger changes were made.

Changing `name` or `mobile` will require an intentionally designed
identity-verification / re-authentication mechanism in a later phase. That
mechanism is out of scope here.

## Privacy policy

The following fields remain private (never exposed via any public page or
API in this phase): `mobile`, full street address, `plate`, `vin`, precise
`lat`/`lng`. No public Profile page, public Seller page, or generic
per-field ACL system was introduced. No public RLS policy was changed.

Potential future public-safe fields (business/display name, city, province,
coarse region, service info, business description, working hours, a chosen
public contact method, future verification status) remain **unexposed**
until a future phase explicitly reviews and authorizes a safe public
projection.

## Owner / Driver

- Preserved the existing single-vehicle `data.car` structure
  (`brandId`, `modelId`, `trimId`, `year`, `fuel`, `mileage`, `plate`, `vin`).
- Added `data.car.displayName` — optional, max 40 chars, trimmed, validated
  in `lib/profile-validation.ts`. Backward-compatible: absent on existing
  rows, no migration.
- Added `data.car.photoUrl` — optional single vehicle photo. Reuses the
  existing owner-scoped `avatars` Storage bucket/policy (write restricted to
  the user's own `auth.uid()`-prefixed path; bucket is already public-read
  for all objects, same as the existing avatar photo). Upload path:
  `<user_id>/vehicle-<timestamp>.<ext>`. Replace and remove are supported
  via `components/SingleImagePicker.tsx`. No new bucket, no gallery, no new
  Vehicle entity/table.

## Service Provider

- Verified existing shop/business name, address, contact, working hours,
  service/vehicle expertise, experience, warranty, mobile-service flag,
  about, and social fields round-trip correctly through `data.seller` /
  `data.serviceExpertise` / `data.carExpertise`.
- Added `data.seller.photoUrl` — one business/shop image, same
  owner-scoped `avatars` bucket pattern, path
  `<user_id>/business-<timestamp>.<ext>`. Replace/remove supported. No
  gallery, no new Storage infrastructure.
- No public Service Provider page was created.

## Roadside Rescuer

Existing rescue types, supported vehicles, radius, experience, working
hours, contact, address, and about fields were verified to round-trip
through `data.rescuer`. No rescuer image was added — deferred by default
per mission guidance (no immediate self-view value proven that would
justify new UI beyond this phase's bounded scope). No realtime presence,
dispatch, matching, ETA, or geospatial search was added or implied.

## Seller

Seller Profile was **not expanded**. Current `SellerForm` fields
(`shopName`, `specialties`, `saleType`, `minOrder`, `carExpertise`, `about`,
address/contact/social) were preserved as-is; no image was added to Seller
(the image addition in this phase is Service Provider-only, per mission
scope). Repository evidence confirms Seller Profile data (`data.seller`) is
not currently consumed by the Store/catalog pages — Store listings price
and display Offers independently of this Profile data.

**Follow-up (not executed in this phase): Seller Profile ↔ Store
Reconnection.** Deciding which Seller Profile fields (if any) should feed
Store/Offer display is a product/architecture decision for a later phase.

## Vehicle field naming compatibility review

Reviewed `data.car` key names (`brandId`, `modelId`, `trimId`, `year`,
`fuel`, `mileage`, `plate`, `vin`, now `displayName`) against common
automotive-data naming (brand/model/trim/year/VIN/plate/mileage/display
name). The existing keys are already coherent with that convention; no
renaming or normalization was necessary, and none was performed. This
review does not authorize any Automotive AI integration.

## JSONB / backward compatibility

`profiles.data JSONB` continues to hold all role-specific and vehicle data.
Only additive keys (`car.displayName`, `car.photoUrl`,
`seller.photoUrl`) were introduced. Existing saved records remain valid;
missing keys are treated as absent (falsy), not as errors. No migration was
added or required.

## Location

`AddressForm`'s optional `lat`/`lng` capture was preserved as-is (browser
geolocation, stored in `address_data`). No maps, discovery, nearest-provider
search, or geospatial query system was added.

## Storage

Verified bucket/policy state in `supabase/migrations/202609290001_security_foundation.sql`:
the `avatars` bucket is public-read for all authenticated/anon roles and
write-restricted per-object to the path prefix matching `auth.uid()`. This
phase's vehicle photo and business image reuse that exact bucket and
ownership rule — no new bucket, no new Storage policy, no security change.

Known limitation (shared with the pre-existing avatar upload pattern):
replacing/removing an image does not delete the previous object from
Storage, since each upload uses a timestamped filename. This is
pre-existing behavior (see `components/AvatarPicker.tsx`), not newly
introduced, and remains out of scope to fix in this phase.

## Deferred to later phases

Public Profile pages, Marketplace/Store discovery or search, ratings and
reviews, verification workflows, multi-vehicle support, a Vehicle
table/entity, maintenance history, booking/scheduling, realtime presence or
dispatch, routing/ETA, notification infrastructure, Automotive AI
integration, Seller ↔ Store reconnection, and a name/mobile
re-authentication mechanism.
