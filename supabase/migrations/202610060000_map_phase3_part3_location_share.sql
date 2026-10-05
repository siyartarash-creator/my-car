begin;
-- MY CAR Map/Navigation Phase 3, Part 3: roadside Map-side location
-- handoff. No PostGIS/geography calls -- runs against the local PGlite
-- test harness too.
--
-- Scope boundary: this is the Map-owned primitive -- a profile can share
-- its current location (opt-in, explicit RPC call, nothing creates a
-- share automatically) and later grant a specific other profile read
-- access to it. It is NOT a roadside dispatch/ticket/matching system --
-- deciding WHO should be matched to a breakdown report is a separate
-- domain's business logic (reported as a cross-domain dependency, not
-- built here). Map's job is the location-handoff contract those domains
-- can call into once they exist.
--
-- Privacy: default OFF (nothing auto-creates a row), minimum data (lat/
-- lng/context only, no route/trail), short bounded TTL (capped at 12h),
-- fully revocable, and a grant is visible to its grantee only while the
-- underlying share is still active (not revoked, not expired).
create table public.map_location_shares (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  context text not null default 'roadside_breakdown' check (context in ('roadside_breakdown', 'other')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
alter table public.map_location_shares enable row level security;

create table public.map_location_share_grants (
  id bigint generated always as identity primary key,
  share_id bigint not null references public.map_location_shares(id) on delete cascade,
  grantee_profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (share_id, grantee_profile_id)
);
alter table public.map_location_share_grants enable row level security;

-- A grantee only sees the share while it is active (not revoked, not
-- expired) -- revoking or letting a share expire removes a grantee's
-- access without needing to touch the grant row itself. The owner/admin
-- can still see it afterward (their own audit trail).
grant select on public.map_location_shares to authenticated;
create policy map_location_share_read on public.map_location_shares for select to authenticated using (
  profile_id = auth.uid()
  or private.is_admin()
  or (
    revoked_at is null and expires_at > now()
    -- map_location_share_grants has its own "id" column, so the bare
    -- "id" the EXISTS subquery would otherwise see resolves to THAT
    -- table, not this one -- map_location_shares.id is required here,
    -- not cosmetic.
    and exists (select 1 from public.map_location_share_grants g where g.share_id = map_location_shares.id and g.grantee_profile_id = auth.uid())
  ));
-- No direct insert/update/delete grant -- every write goes through the
-- three security-definer RPCs below, so TTL/ownership/validation can
-- never be bypassed by a direct table write.

-- Cross-table RLS guard: map_location_shares' own read policy (above)
-- queries map_location_share_grants directly. If this table's policy
-- queried map_location_shares back the same way, the two would recurse
-- into each other forever ("infinite recursion detected in policy").
-- private.owns_location_share() breaks the cycle the same way
-- private.is_admin() already does for every other table in this
-- codebase: a security-definer function (owned by the migration role,
-- which bypasses RLS) does the lookup once, instead of a second
-- RLS-evaluated query back into map_location_shares.
create function private.owns_location_share(p_share_id bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.map_location_shares where id = p_share_id and profile_id = auth.uid());
$$;
revoke all on function private.owns_location_share(bigint) from public;
grant execute on function private.owns_location_share(bigint) to authenticated;

grant select on public.map_location_share_grants to authenticated;
create policy map_location_share_grant_read on public.map_location_share_grants for select to authenticated using (
  grantee_profile_id = auth.uid()
  or private.owns_location_share(share_id)
  or private.is_admin());

-- create_location_share: the one opt-in entry point. At most one active
-- share per (profile, context) -- creating a new one revokes any prior
-- active share in the same context, so stale shares never accumulate.
-- TTL is caller-chosen but capped at 12h server-side (minimum necessary
-- retention, not an unbounded or caller-controlled-without-limit window).
create function public.create_location_share(
  p_lat double precision, p_lng double precision, p_context text default 'roadside_breakdown', p_ttl_minutes integer default 120
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare result_id bigint;
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  if p_lat is null or p_lng is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'invalid_coordinates';
  end if;
  if p_context not in ('roadside_breakdown', 'other') then raise exception 'invalid_context'; end if;
  if p_ttl_minutes is null or p_ttl_minutes < 1 or p_ttl_minutes > 720 then raise exception 'invalid_ttl'; end if;
  update public.map_location_shares set revoked_at = now()
    where profile_id = auth.uid() and context = p_context and revoked_at is null and expires_at > now();
  insert into public.map_location_shares(profile_id, context, lat, lng, expires_at)
  values (auth.uid(), p_context, p_lat, p_lng, now() + (p_ttl_minutes || ' minutes')::interval)
  returning id into result_id;
  return result_id;
end $$;
revoke all on function public.create_location_share(double precision, double precision, text, integer) from public, anon;
grant execute on function public.create_location_share(double precision, double precision, text, integer) to authenticated;

-- revoke_location_share: owner-only, idempotent-safe (raises if already
-- revoked/not found/not owned, rather than silently no-oping, so a caller
-- always knows whether the revoke actually took effect).
create function public.revoke_location_share(p_share_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  update public.map_location_shares set revoked_at = now()
    where id = p_share_id and profile_id = auth.uid() and revoked_at is null;
  if not found then raise exception 'share_not_found_not_owner_or_already_revoked'; end if;
end $$;
revoke all on function public.revoke_location_share(bigint) from public, anon;
grant execute on function public.revoke_location_share(bigint) to authenticated;

-- grant_location_share_access: owner-only, and only while the share is
-- still active -- this is the Map-side half of "temporary location
-- handoff"; a responder-matching domain would call this once it decides
-- who the owner is handing their location to (see the cross-domain note
-- in this migration's header).
create function public.grant_location_share_access(p_share_id bigint, p_grantee_profile_id uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare result_id bigint;
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  if p_grantee_profile_id = auth.uid() then raise exception 'cannot_grant_to_self'; end if;
  if not exists (
    select 1 from public.map_location_shares
    where id = p_share_id and profile_id = auth.uid() and revoked_at is null and expires_at > now()
  ) then
    raise exception 'share_not_found_not_owner_or_inactive';
  end if;
  if not exists (select 1 from public.profiles where id = p_grantee_profile_id) then
    raise exception 'grantee_not_found';
  end if;
  insert into public.map_location_share_grants(share_id, grantee_profile_id)
  values (p_share_id, p_grantee_profile_id)
  on conflict (share_id, grantee_profile_id) do nothing
  returning id into result_id;
  return result_id;
end $$;
revoke all on function public.grant_location_share_access(bigint, uuid) from public, anon;
grant execute on function public.grant_location_share_access(bigint, uuid) to authenticated;
commit;
