begin;
-- Phase 4 / Admin Panel Completion, Checkpoint A: Admin Core entry boundary.
-- Consumes the Task 4.1 foundation (202609300003): operator_permissions,
-- private.has_permission(), private.log_admin_action(). Adds only what the
-- locked architecture (AGENTS.md/CLAUDE.md Admin Panel Completion brief,
-- section 3) requires for /admin shell entry:
--   A profile may enter the Admin shell if it is Super Admin, OR it holds at
--   least one operator_permissions grant. Each protected page/action still
--   enforces its own specific permission via has_permission(key) -- this is
--   only the coarse "may the shell open at all" check.
--
-- No new table, no new permission keys, no RBAC/role engine: the existing
-- fixed permission-key CHECK constraint and Super Admin bypass are reused
-- as-is.

-- === A. has_any_permission(): coarse Admin-entry check ========================
-- operator_permissions previously granted SELECT only to Super Admin
-- (operator_permissions_admin_read). An operator could not read their own
-- grants, so entry gating goes through a SECURITY DEFINER function instead of
-- a direct table read -- consistent with private.has_permission()'s own
-- shape, and avoids widening the table's RLS surface for this.
create or replace function private.has_any_permission() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin() or exists(
    select 1 from public.operator_permissions where profile_id = auth.uid()
  );
$$;
create or replace function public.has_any_permission() returns boolean
language sql stable security definer set search_path = '' as $$ select private.has_any_permission(); $$;
revoke all on function private.has_any_permission(), public.has_any_permission() from public;
grant execute on function private.has_any_permission(), public.has_any_permission() to anon, authenticated;

-- === B. effective permission listing: operator management UI =================
-- Super-Admin-only operator management (locked decision, section 7) needs to
-- "clearly display effective permission state" for arbitrary profiles, which
-- the existing operator_permissions_admin_read policy already allows a Super
-- Admin to select directly. Nothing to add there.
--
-- An operator themselves, however, has no read path onto their own grants at
-- all today (only Super Admin can SELECT operator_permissions), which the
-- Admin Core navigation needs for permission-aware UX (never a security
-- boundary -- the server guards on the RPC/page are the boundary). Add a
-- narrow self-read policy: a profile may see only its own grant rows.
create policy operator_permissions_self_read on public.operator_permissions
  for select to authenticated using (profile_id = auth.uid());
commit;
