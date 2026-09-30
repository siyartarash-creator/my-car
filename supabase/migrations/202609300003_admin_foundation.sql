begin;
-- Phase 4 / Task 4.1: admin/operations security foundation.
-- profiles.is_admin remains the Super Admin bypass everywhere. This adds the
-- minimum needed for future operator actions: a fixed, explicit-grant
-- permission set (no roles/groups/hierarchy), a typed marketplace-settings
-- singleton (no generic key/value config engine), and an append-only audit
-- log written only through a private helper (no blanket triggers). Nothing
-- here wires up discount approval or offer moderation yet -- those are later
-- Phase 4 tasks that will consume this foundation.

-- === A. Operator permissions =================================================
-- Fixed permission-key set, matching known Phase 4 actions only. Deny by
-- default: no grant means no access, even for an otherwise-authenticated
-- user. Only a Super Admin can create/remove grants, and only through the
-- RPCs below -- there is no direct client write path onto this table.
create table public.operator_permissions (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  permission_key text not null check (permission_key in (
    'products.write', 'offers.moderate', 'discounts.approve', 'requests.review', 'orders.read'
  )),
  granted_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (profile_id, permission_key)
);
alter table public.operator_permissions enable row level security;
revoke all on public.operator_permissions from public, anon, authenticated;
grant select on public.operator_permissions to authenticated;
create policy operator_permissions_admin_read on public.operator_permissions for select to authenticated using (private.is_admin());

-- === B. Marketplace settings (typed singleton, not generic key/value) ========
-- One authoritative row. Each real business rule is its own typed, checked
-- column, so future rules are added as columns, not as untyped rows. No
-- client read/write access; consumed by SECURITY DEFINER functions only.
create table public.marketplace_settings (
  id smallint primary key default 1 check (id = 1),
  seller_autonomous_discount_max_percent smallint not null default 35
    check (seller_autonomous_discount_max_percent between 0 and 100),
  updated_at timestamptz not null default now()
);
alter table public.marketplace_settings enable row level security;
revoke all on public.marketplace_settings from public, anon, authenticated;
grant select on public.marketplace_settings to authenticated;
create policy marketplace_settings_admin_read on public.marketplace_settings for select to authenticated using (private.is_admin());
insert into public.marketplace_settings (id) values (1);

-- === C. Admin audit log (append-only) ========================================
-- Clients cannot write this table directly and cannot supply their own actor
-- id -- private.log_admin_action() derives the actor from auth.uid() and is
-- the only insert path. No update/delete grant to anyone at the application
-- layer, so records cannot be casually altered or removed once written.
create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles(id),
  action text not null,
  target_table text not null,
  target_id text,
  reason text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated;
grant select on public.admin_audit_log to authenticated;
create policy admin_audit_log_admin_read on public.admin_audit_log for select to authenticated using (private.is_admin());

create or replace function private.log_admin_action(
  p_action text, p_target_table text, p_target_id text, p_reason text default null, p_metadata jsonb default null
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare new_id bigint;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if coalesce(length(p_action),0) = 0 or coalesce(length(p_target_table),0) = 0 then raise exception 'invalid_audit_entry'; end if;
  insert into public.admin_audit_log(actor_id, action, target_table, target_id, reason, metadata)
  values (auth.uid(), p_action, p_target_table, p_target_id, p_reason, p_metadata)
  returning id into new_id;
  return new_id;
end $$;
-- Internal helper only: no EXECUTE grant to any client role. Only other
-- SECURITY DEFINER functions call it, using their own (definer) privilege.
revoke all on function private.log_admin_action(text,text,text,text,jsonb) from public, anon, authenticated;

-- === Permission check helper, mirroring the private/public is_admin() shape ==
create or replace function private.has_permission(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin() or exists(
    select 1 from public.operator_permissions
    where profile_id = auth.uid() and permission_key = p_key
  );
$$;
create or replace function public.has_permission(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$ select private.has_permission(p_key); $$;
revoke all on function private.has_permission(text), public.has_permission(text) from public;
grant execute on function private.has_permission(text), public.has_permission(text) to anon, authenticated;

-- === Permission grant/revoke RPCs (Super Admin only) =========================
create or replace function public.admin_grant_permission(p_profile_id uuid, p_permission_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  if p_profile_id is null or p_permission_key is null then raise exception 'invalid_request'; end if;
  if not exists(select 1 from public.profiles where id = p_profile_id) then raise exception 'profile_not_found'; end if;
  insert into public.operator_permissions(profile_id, permission_key, granted_by)
  values (p_profile_id, p_permission_key, auth.uid())
  on conflict (profile_id, permission_key) do nothing;
  perform private.log_admin_action('grant_permission', 'operator_permissions', p_profile_id::text, null,
    jsonb_build_object('permission_key', p_permission_key));
end $$;

create or replace function public.admin_revoke_permission(p_profile_id uuid, p_permission_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  if p_profile_id is null or p_permission_key is null then raise exception 'invalid_request'; end if;
  delete from public.operator_permissions where profile_id = p_profile_id and permission_key = p_permission_key;
  perform private.log_admin_action('revoke_permission', 'operator_permissions', p_profile_id::text, null,
    jsonb_build_object('permission_key', p_permission_key));
end $$;

revoke all on function public.admin_grant_permission(uuid,text), public.admin_revoke_permission(uuid,text) from public, anon;
grant execute on function public.admin_grant_permission(uuid,text), public.admin_revoke_permission(uuid,text) to authenticated;
commit;
