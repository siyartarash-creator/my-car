begin;
-- MY CAR Map/Navigation Phase 3 independent audit corrective patch.
-- No PostGIS/geography calls -- runs against the local PGlite test
-- harness too. Items 3, 6, 9 of the audit (retention/deletion, atomic
-- rate limiting, RLS performance); items 1/2/4/5/7/8 are TypeScript/UI/
-- test-script changes with no schema impact, covered elsewhere in this
-- commit.

-- =======================================================================
-- Item 3: precise-location retention is now enforceable, not just
-- documented. Expiry alone (checked only at read time by RLS) never
-- physically removed coordinates -- an expired-but-not-yet-cleaned-up row
-- still held real lat/lng in the table indefinitely.
-- =======================================================================

-- delete_location_share: owner-only hard delete. FK ON DELETE CASCADE on
-- map_location_share_grants.share_id already removes every grant for
-- this share as part of the same statement -- no separate cleanup step
-- needed for grants.
create function public.delete_location_share(p_share_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  delete from public.map_location_shares where id = p_share_id and profile_id = auth.uid();
  if not found then raise exception 'share_not_found_or_not_owner'; end if;
end $$;
revoke all on function public.delete_location_share(bigint) from public, anon;
grant execute on function public.delete_location_share(bigint) to authenticated;

-- cleanup_expired_location_shares: hard-deletes rows past their own
-- expiry, plus revoked rows older than 24h (minimum necessary retention
-- for both paths, not just the expired one). No EXECUTE grant to anon/
-- authenticated at all -- this is a system-maintenance function, callable
-- only by the service role / postgres (e.g. a future pg_cron schedule or
-- a manual admin-console call), never by an app client. That's a
-- deliberate, enforceable deletion path today; it is NOT currently wired
-- to an automatic schedule (no pg_cron job created by this migration --
-- scheduling one is an infrastructure decision this patch doesn't make
-- unilaterally). See the Part 4 audit checkpoint for this as a named
-- remaining limitation.
create function public.cleanup_expired_location_shares() returns integer
language plpgsql security definer set search_path = '' as $$
declare deleted_count integer;
begin
  delete from public.map_location_shares
    where expires_at < now() or (revoked_at is not null and revoked_at < now() - interval '24 hours');
  get diagnostics deleted_count = row_count;
  return deleted_count;
end $$;
revoke all on function public.cleanup_expired_location_shares() from public, anon, authenticated;

-- =======================================================================
-- Item 6: atomic rate limiting. The Part 4 rate limit (select count(*) ...
-- then insert, as two separate statements) is raceable -- two concurrent
-- requests can both read the same pre-insert count and both pass the
-- check before either's insert is visible to the other, letting the
-- limit be bypassed. A single atomic UPSERT-and-increment closes that
-- window: Postgres serializes concurrent INSERT ... ON CONFLICT DO
-- UPDATE statements targeting the same key via the row's own lock, so
-- the returned count is always correct regardless of concurrency.
--
-- Fixed hourly window (date_trunc('hour', now())), not a rolling window
-- -- a fixed window has a well-defined, atomically-checkable key
-- (profile_id, action, window_start), while "rolling last 60 minutes"
-- inherently needs a COUNT over a row range, which is exactly the
-- raceable shape being replaced. This is a behavior change from Part 4's
-- rolling window, clearly defined here rather than left implicit.
-- =======================================================================
create table private.map_rate_limits (
  profile_id uuid not null,
  action text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (profile_id, action, window_start)
);
-- Internal bookkeeping table, not exposed through PostgREST at all (no
-- grants to anon/authenticated) -- only the security-definer function
-- below ever touches it, the same posture as every other table in the
-- `private` schema.

-- check_rate_limit: atomically increments this caller's counter for
-- (action, current hour) and raises if the new count exceeds p_limit.
-- Called as the first step inside each rate-limited RPC's body, after
-- input validation (so malformed requests don't consume a quota slot).
create function private.check_rate_limit(p_action text, p_limit integer) returns void
language plpgsql security definer set search_path = '' as $$
declare current_count integer;
begin
  insert into private.map_rate_limits(profile_id, action, window_start, count)
  values (auth.uid(), p_action, date_trunc('hour', now()), 1)
  on conflict (profile_id, action, window_start) do update set count = private.map_rate_limits.count + 1
  returning count into current_count;
  if current_count > p_limit then raise exception 'rate_limited'; end if;
end $$;
revoke all on function private.check_rate_limit(text, integer) from public;
-- No grant needed to anon/authenticated -- this is called internally by
-- other security-definer functions (which run with this function's
-- owner's privileges), never invoked directly by a client.

-- submit_community_report: same exact signature as Part 4
-- (202610080000), body replaced to use the atomic check instead of
-- select-count-then-insert.
create or replace function public.submit_community_report(
  p_category_id bigint, p_lat double precision, p_lng double precision, p_description text,
  p_event_type text default null, p_severity text default null
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare result_id bigint;
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  if p_lat is null or p_lng is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'invalid_coordinates';
  end if;
  if coalesce(length(p_description), 0) > 1000 then raise exception 'invalid_report'; end if;
  if p_category_id is not null and not exists (select 1 from public.map_poi_categories where id = p_category_id) then
    raise exception 'invalid_category';
  end if;
  if p_event_type is not null and p_event_type not in ('closure','accident','roadworks','hazard','other') then
    raise exception 'invalid_event_type';
  end if;
  if p_severity is not null and p_severity not in ('low','medium','high','critical') then
    raise exception 'invalid_severity';
  end if;
  perform private.check_rate_limit('submit_community_report', 10);
  insert into public.map_community_reports(reporter_id, category_id, lat, lng, description, event_type, severity)
  values (auth.uid(), p_category_id, p_lat, p_lng, p_description, p_event_type, p_severity)
  returning id into result_id;
  return result_id;
end $$;
revoke all on function public.submit_community_report(bigint, double precision, double precision, text, text, text) from public, anon;
grant execute on function public.submit_community_report(bigint, double precision, double precision, text, text, text) to authenticated;

-- create_location_share: same exact signature as Part 3, body replaced.
create or replace function public.create_location_share(
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
  perform private.check_rate_limit('create_location_share', 10);
  update public.map_location_shares set revoked_at = now()
    where profile_id = auth.uid() and context = p_context and revoked_at is null and expires_at > now();
  insert into public.map_location_shares(profile_id, context, lat, lng, expires_at)
  values (auth.uid(), p_context, p_lat, p_lng, now() + (p_ttl_minutes || ' minutes')::interval)
  returning id into result_id;
  return result_id;
end $$;
revoke all on function public.create_location_share(double precision, double precision, text, integer) from public, anon;
grant execute on function public.create_location_share(double precision, double precision, text, integer) to authenticated;

-- =======================================================================
-- Item 9: RLS performance -- wrap auth.uid() as (select auth.uid()) in
-- the two Part 3 location-sharing read policies, so Postgres evaluates
-- it once per statement (an InitPlan) instead of once per row
-- considered. Authorization logic is unchanged -- same roles, same
-- conditions, same result set; only the evaluation shape of auth.uid()
-- itself changes.
-- =======================================================================
drop policy if exists map_location_share_read on public.map_location_shares;
create policy map_location_share_read on public.map_location_shares for select to authenticated using (
  profile_id = (select auth.uid())
  or private.is_admin()
  or (
    revoked_at is null and expires_at > now()
    and exists (select 1 from public.map_location_share_grants g where g.share_id = map_location_shares.id and g.grantee_profile_id = (select auth.uid()))
  ));

drop policy if exists map_location_share_grant_read on public.map_location_share_grants;
create policy map_location_share_grant_read on public.map_location_share_grants for select to authenticated using (
  grantee_profile_id = (select auth.uid())
  or private.owns_location_share(share_id)
  or private.is_admin());
commit;
