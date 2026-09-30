---
name: my-car-admin
description: Conventions for adding to or changing the My Car Admin panel (Admin Core + modules). Load before touching anything under app/admin, lib/admin, or an admin-facing SECURITY DEFINER RPC/migration.
---

# My Car Admin conventions

Admin Core is a thin, stable shell. Future modules (Finance, Users,
Automotive Services, AI, Social, Heavy Vehicles, Navigation/Logistics) ADD
module code; they do not rewrite Admin Core, the auth helpers, or the shell.

## Module-addition checklist

1. Add an `AdminModule` entry to `lib/admin/modules.ts` — `key`, `label`,
   `items` (each with `href`, `label`, `icon`, `permission`). Set
   `superAdminOnly: true` only for modules that must never appear for a
   permission-holding non-admin operator (e.g. operator management itself).
2. If the module needs a new permission key, add it to the
   `permission_key` CHECK constraint on `operator_permissions` in a new
   migration AND to `PERMISSION_KEYS`/`PERMISSION_LABELS` in
   `lib/admin/permissions.ts` in the same change. Never add a key
   speculatively — only when a page/action in this change actually checks it.
3. Gate the page with `requirePermission("<key>")` (or `requireAdminAccess()`
   for entry-level-only pages, or `requireSuperAdmin()` for
   privilege-management surfaces) from `lib/auth-server.ts`. The nav's
   `permission` field is UX only — it must match what the page itself
   enforces, or it will mislead operators about what they can actually do.
4. Reuse the shared admin UI primitives already in `app/admin/**` (loading /
   error / empty states, table/list row styling, RTL layout) before writing
   new ones.

## Registry contract

`lib/admin/modules.ts` is UI metadata only — it decides what the sidebar
shows. It is NEVER an authorization boundary. Hiding a link does not protect
the page or action behind it; the server guard does that. Assume any
authenticated profile can reach any admin URL directly and must be denied
there if unauthorized.

## Permission naming

`<module>.<verb>` (e.g. `offers.moderate`, `discounts.approve`,
`products.write`, `requests.review`, `orders.read`). No roles, no hierarchy,
no wildcard/glob permissions.

## Server authorization is required

Every protected page: call `requireAdminAccess()` / `requirePermission(key)`
/ `requireSuperAdmin()` (`lib/auth-server.ts`) before rendering or acting.
Never rely on client-side `profiles.is_admin` or permission checks for
security — only for optional, non-authoritative UX (e.g. hiding a button
while a request is in flight). A removed client check should never be
replaced with a new one; replace it with the server boundary instead.

## DB/RPC authorization is required

Every privileged mutation is a `SECURITY DEFINER` function that:
- re-derives the actor from `auth.uid()`, never a client-supplied id;
- calls `private.has_permission('<key>')` (Super Admin always bypasses);
- takes no permission/role parameter from the client;
- has no direct-table-write path around it (the table has no INSERT/UPDATE
  grant to `anon`/`authenticated`).

## Transactional audit rule

For the mutation classes listed in the project brief (permission
grant/revoke, discount approve/reject, Offer activate/deactivate, product
approval/moderation, coupon create/update/delete, other privileged
state-changing admin ops): the business mutation and
`private.log_admin_action(...)` call MUST be in the same PL/pgSQL function
and the same transaction. Never issue the audit write as a separate
client-side call after the mutation succeeds — a failure between the two
would leave an unaudited privileged change. See
`supabase/migrations/202609300005_discount_approval.sql` and
`202609300006_offer_moderation.sql` for the reference shape.

## RTL checklist

- Root admin layout sets `dir="rtl"`.
- Icons/badges before label text read correctly right-to-left; verify with a
  long Persian label, not just short placeholder text.
- Don't hardcode `left`/`right` Tailwind utilities where a logical
  (`ms-`/`me-`/`ps-`/`pe-`) or flex-direction-aware layout would flip
  correctly under RTL instead.

## Reuse before rewrite

Before writing a new component: (1) check the nearest existing My Car
admin/seller component, (2) adapt it, (3) adapt a validated external
reference pattern (below) only if neither exists, (4) write new code last.

## External references (MIT, validated — see docs/third-party-reuse.md)

- `Kiranism/next-shadcn-dashboard-starter` — Next.js admin organization,
  tables, filters/pagination, forms, navigation patterns.
- `satnaing/shadcn-admin` — RTL sidebar, dialogs, sheets, directional UI
  techniques.

Never import Clerk, a foreign Auth/RBAC system, or multi-tenant/organization
assumptions from either. Adapt visual/structural patterns only; My Car's own
Supabase Auth, RLS, SECURITY DEFINER RPCs, and permission model are
authoritative and are never replaced.

## Testing checklist

For any admin change, prove (via the PGlite harness in
`tests/database-security.mjs`, extending its existing `as(uid, fn)` role
pattern rather than rebuilding it):
- Super Admin access; a permitted operator's access; an operator with no
  relevant permission denied; anonymous denied; an ordinary buyer/seller
  denied unless explicitly granted.
- The specific permission a page/action checks — not just coarse admin
  entry.
- Grant/revoke (if touched) remains atomically audited.
- No direct-table-write or cross-record (IDOR) bypass of the RPC.

Do not re-run unchanged foundational security tests without a code change
that could affect them.
