begin;
-- MY CAR Map/Navigation Phase 3, Part 2: road-event detail, infrastructure
-- POI categories. No PostGIS/geography calls here (unlike the staging-only
-- Phase 2 files) -- this runs against the local PGlite test harness too.
--
-- Reuses the existing Phase 1 community-report -> admin-review ->
-- map_features pipeline untouched; no parallel road-event system. This
-- adds a structured side-table (same pattern as map_road_restrictions)
-- so a road_event feature can carry an event_type/severity instead of
-- only free-text description, plus canonical POI categories for fuel/
-- parking/weigh-station/terminal infrastructure (data rows, not new
-- tables -- map_features already supports any POI kind, per its own
-- Phase 1 comment).

-- Phase 1 already seeded fuel_station/ev_charging/truck_stop as inactive
-- placeholders (no real data source existed yet). Activating them here
-- (not re-inserting) avoids a slug conflict and a silently-skipped
-- activation -- "on conflict do nothing" would otherwise leave their
-- original is_active=false untouched.
update public.map_poi_categories set is_active = true
  where slug in ('fuel_station', 'ev_charging', 'truck_stop');

insert into public.map_poi_categories (slug, name_fa, name_en, icon, is_active) values
  ('petrol', 'پمپ بنزین', 'Petrol station', 'fuel', true),
  ('diesel', 'پمپ گازوئیل', 'Diesel station', 'fuel', true),
  ('cng', 'پمپ گاز CNG', 'CNG station', 'fuel', true),
  ('parking', 'پارکینگ', 'Parking', 'parking-circle', true),
  ('weigh_station', 'ایستگاه توزین', 'Weigh station', 'scale', true),
  ('terminal', 'پایانه', 'Terminal', 'bus', true),
  ('road_infrastructure', 'زیرساخت جاده‌ای', 'Road infrastructure', 'construction', true)
on conflict (slug) do nothing;

-- Structured road-event attributes, keyed 1:1 to a map_features row --
-- same side-table pattern map_road_restrictions already uses, not a
-- second canonical table for road events.
create table public.map_road_event_details (
  feature_id bigint primary key references public.map_features(id) on delete cascade,
  event_type text not null check (event_type in ('closure','accident','roadworks','hazard','other')),
  severity text not null default 'low' check (severity in ('low','medium','high','critical')),
  created_at timestamptz not null default now()
);
alter table public.map_road_event_details enable row level security;

-- Readable under the exact same visibility review_community_report's
-- feature already has (verified + not expired, or the submitter's own
-- pending one, or admin) -- this table never widens what a map_features
-- row already exposes.
grant select on public.map_road_event_details to anon, authenticated;
create policy map_road_event_detail_read on public.map_road_event_details for select to anon, authenticated using (
  exists (select 1 from public.map_features f where f.id = feature_id and (
    (f.status = 'verified' and (f.expires_at is null or f.expires_at > now()))
    or f.submitted_by = auth.uid()
    or private.is_admin()
  )));
grant insert, update, delete on public.map_road_event_details to authenticated;
create policy map_road_event_detail_admin_write on public.map_road_event_details for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- Carries event_type/severity from submission through to admin review --
-- without these, that classification would be lost between
-- submit_community_report and review_community_report (two separate
-- calls). Nullable: every pre-existing report and every non-road-event
-- report simply leaves these null.
alter table public.map_community_reports add column event_type text check (event_type is null or event_type in ('closure','accident','roadworks','hazard','other'));
alter table public.map_community_reports add column severity text check (severity is null or severity in ('low','medium','high','critical'));

-- submit_community_report: widened signature (2 new trailing optional
-- params). The old 4-param function is explicitly dropped first -- adding
-- params via a bare "create or replace" would instead create a SECOND
-- overload, which is exactly the ambiguous-overload bug the Phase 2
-- lifecycle migration had to fix for review_community_report. Every
-- existing caller (lib/map/ai-contracts.ts) calls this RPC with named
-- arguments, so adding trailing optional params is a non-breaking change
-- once the old positional-arity overload is gone.
drop function if exists public.submit_community_report(bigint, double precision, double precision, text);
create function public.submit_community_report(
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
  insert into public.map_community_reports(reporter_id, category_id, lat, lng, description, event_type, severity)
  values (auth.uid(), p_category_id, p_lat, p_lng, p_description, p_event_type, p_severity)
  returning id into result_id;
  return result_id;
end $$;
revoke all on function public.submit_community_report(bigint, double precision, double precision, text, text, text) from public, anon;
grant execute on function public.submit_community_report(bigint, double precision, double precision, text, text, text) to authenticated;

-- review_community_report: body-only change on the EXACT original
-- (bigint,text,text) signature (per the Phase 2 lifecycle migration's own
-- documented rule -- never add a parameter here). On promoting a
-- road_event report, also writes the matching map_road_event_details row
-- (event_type defaults to 'other' if the reporter didn't classify it,
-- since the column is not-null; severity keeps the table's own 'low'
-- default via the same coalesce).
create or replace function public.review_community_report(
  p_report_id bigint, p_decision text, p_note text
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare rpt record; src_id bigint; feature_id bigint; category_slug text; effective_expiry timestamptz;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  if p_decision not in ('promoted','rejected') then raise exception 'invalid_decision'; end if;
  select * into rpt from public.map_community_reports where id = p_report_id and status = 'pending';
  if rpt is null then raise exception 'report_not_found'; end if;
  if p_decision = 'promoted' then
    select id into src_id from public.map_sources where code = 'community';
    select slug into category_slug from public.map_poi_categories
      where id = coalesce(rpt.category_id, (select id from public.map_poi_categories where slug = 'other'));
    effective_expiry := case when category_slug = 'road_event' then now() + interval '12 hours' else null end;
    insert into public.map_features(category_id, source_id, name_fa, lat, lng, status, confidence, submitted_by, expires_at)
    values (coalesce(rpt.category_id, (select id from public.map_poi_categories where slug = 'other')), src_id,
      coalesce(rpt.description, 'Community report'), rpt.lat, rpt.lng, 'pending', 0.3, rpt.reporter_id, effective_expiry)
    returning id into feature_id;
    insert into public.map_feature_provenance(feature_id, action, actor, source_id, note)
    values (feature_id, 'created', auth.uid(), src_id, p_note);
    if category_slug = 'road_event' then
      insert into public.map_road_event_details(feature_id, event_type, severity)
      values (feature_id, coalesce(rpt.event_type, 'other'), coalesce(rpt.severity, 'low'));
    end if;
  end if;
  update public.map_community_reports set status = p_decision, promoted_feature_id = feature_id,
    reviewed_by = auth.uid(), reviewed_at = now() where id = p_report_id;
  return p_report_id;
end $$;
revoke all on function public.review_community_report(bigint, text, text) from public, anon, authenticated;
grant execute on function public.review_community_report(bigint, text, text) to authenticated;
commit;
