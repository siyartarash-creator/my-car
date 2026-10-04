begin;
-- MY CAR Map/Navigation Phase 3, Part 4: production-scale readiness +
-- final security hardening. No PostGIS/geography calls -- runs against
-- the local PGlite test harness too.

-- --- Indexing: columns every RLS policy or admin query filters on, that
-- had no index behind them (confirmed via a live pg_indexes check against
-- STAGING before writing this). None of these are large tables yet, but
-- "it's fine today" is exactly the kind of gap that becomes a real
-- production incident once rows grow -- a plain btree is $0.
create index if not exists map_community_reports_reporter_id_idx on public.map_community_reports(reporter_id);
create index if not exists map_community_reports_status_idx on public.map_community_reports(status);
create index if not exists map_location_shares_profile_id_idx on public.map_location_shares(profile_id);
create index if not exists map_location_share_grants_grantee_profile_id_idx on public.map_location_share_grants(grantee_profile_id);
create index if not exists map_road_restrictions_feature_id_idx on public.map_road_restrictions(feature_id);

-- --- Rate limiting: both write RPCs validate input and ownership, but
-- neither had a volume cap -- an authenticated-but-malicious or buggy
-- client could otherwise flood either table. Body-only changes, same
-- exact signatures as already deployed (Phase 2/3), so no overload risk.

-- submit_community_report: max 10 reports per rolling hour per reporter.
create or replace function public.submit_community_report(
  p_category_id bigint, p_lat double precision, p_lng double precision, p_description text,
  p_event_type text default null, p_severity text default null
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare result_id bigint; recent_count integer;
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
  select count(*) into recent_count from public.map_community_reports
    where reporter_id = auth.uid() and created_at > now() - interval '1 hour';
  if recent_count >= 10 then raise exception 'rate_limited'; end if;
  insert into public.map_community_reports(reporter_id, category_id, lat, lng, description, event_type, severity)
  values (auth.uid(), p_category_id, p_lat, p_lng, p_description, p_event_type, p_severity)
  returning id into result_id;
  return result_id;
end $$;
revoke all on function public.submit_community_report(bigint, double precision, double precision, text, text, text) from public, anon;
grant execute on function public.submit_community_report(bigint, double precision, double precision, text, text, text) to authenticated;

-- create_location_share: max 10 creations per rolling hour per profile.
-- The existing "revoke the prior active share in this context" behavior
-- already prevents stale-row accumulation; this caps the creation rate
-- itself (distinct from a storage-growth concern).
create or replace function public.create_location_share(
  p_lat double precision, p_lng double precision, p_context text default 'roadside_breakdown', p_ttl_minutes integer default 120
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare result_id bigint; recent_count integer;
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  if p_lat is null or p_lng is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'invalid_coordinates';
  end if;
  if p_context not in ('roadside_breakdown', 'other') then raise exception 'invalid_context'; end if;
  if p_ttl_minutes is null or p_ttl_minutes < 1 or p_ttl_minutes > 720 then raise exception 'invalid_ttl'; end if;
  select count(*) into recent_count from public.map_location_shares
    where profile_id = auth.uid() and created_at > now() - interval '1 hour';
  if recent_count >= 10 then raise exception 'rate_limited'; end if;
  update public.map_location_shares set revoked_at = now()
    where profile_id = auth.uid() and context = p_context and revoked_at is null and expires_at > now();
  insert into public.map_location_shares(profile_id, context, lat, lng, expires_at)
  values (auth.uid(), p_context, p_lat, p_lng, now() + (p_ttl_minutes || ' minutes')::interval)
  returning id into result_id;
  return result_id;
end $$;
revoke all on function public.create_location_share(double precision, double precision, text, integer) from public, anon;
grant execute on function public.create_location_share(double precision, double precision, text, integer) to authenticated;
commit;
