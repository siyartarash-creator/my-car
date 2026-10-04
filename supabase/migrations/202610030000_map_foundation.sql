begin;
-- MY CAR Map/Navigation Phase 1, Part 1: permanent geospatial foundation.
--
-- Coordinates: WGS84 degrees, columns always ordered (lat, lng) in SQL and
-- (lng, lat) in any GeoJSON-shaped payload returned to the client -- GeoJSON
-- order is the one place this project deliberately breaks the (lat,lng)
-- convention, so every boundary that crosses it must say so explicitly.
-- PostGIS is NOT enabled here: the local test harness (tests/database-
-- security.mjs) replays every migration through @electric-sql/pglite, which
-- does not bundle the postgis extension, so "create extension postgis" would
-- break database-security tests for the whole repo, not just Map. Proximity
-- uses a plain haversine calculation on double precision lat/lng until a
-- STAGING-verified Postgres confirms postgis is available, at which point an
-- additive migration can add geography(Point,4326) + GiST index without
-- touching these columns or any RLS/contract built on top of them.
create table public.map_sources (
  id bigint generated always as identity primary key,
  code text not null unique,
  kind text not null check (kind in ('admin','csv','excel','bulk','community','external_api','myc_service','synthetic_fixture')),
  label text not null,
  created_at timestamptz not null default now()
);

create table public.map_poi_categories (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name_fa text not null,
  name_en text,
  icon text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Canonical geo feature / POI. One shared table for every category instead
-- of a table per POI type; new POI kinds are normally a map_poi_categories
-- row (data), not a schema migration.
create table public.map_features (
  id bigint generated always as identity primary key,
  category_id bigint not null references public.map_poi_categories(id),
  source_id bigint not null references public.map_sources(id),
  external_ref text,
  name_fa text not null check (length(btrim(name_fa)) between 1 and 200),
  name_en text,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  status text not null default 'pending' check (status in ('pending','verified','rejected','disputed','expired')),
  confidence numeric check (confidence is null or confidence between 0 and 1),
  dedup_key text,
  submitted_by uuid references public.profiles(id),
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index map_features_category_idx on public.map_features(category_id);
create index map_features_status_idx on public.map_features(status);
create index map_features_bbox_idx on public.map_features(lat, lng);

-- Append-only provenance/audit trail. Never updated or deleted by clients.
create table public.map_feature_provenance (
  id bigint generated always as identity primary key,
  feature_id bigint not null references public.map_features(id) on delete cascade,
  action text not null check (action in ('created','validated','normalized','promoted','rejected','disputed','expired','updated')),
  actor uuid references public.profiles(id),
  source_id bigint references public.map_sources(id),
  note text,
  created_at timestamptz not null default now()
);

-- Structural foundation only: safety-critical, so no routing logic reads
-- this table in Phase 1. Reserved for the truck/road restriction extension.
create table public.map_road_restrictions (
  id bigint generated always as identity primary key,
  feature_id bigint not null references public.map_features(id) on delete cascade,
  restriction_type text not null check (restriction_type in ('height','weight','width','length','vehicle_class','other')),
  max_value numeric,
  unit text,
  vehicle_types text[],
  note text,
  created_at timestamptz not null default now()
);

-- MY CAR service markers. A marker exists ONLY for a profile that is itself
-- registered in MY CAR as a service/rescuer -- this is a snapshot of a few
-- public-safe profile fields (same pattern product_requests.seller_name
-- uses), never a raw profiles row, and it only appears once that profile
-- opts in via publish_service_location().
create table public.map_service_locations (
  id bigint generated always as identity primary key,
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  user_type_snapshot text not null,
  name_snapshot text not null,
  city_snapshot text,
  region_snapshot text,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Pending community submissions. Never writes map_features directly --
-- promotion is an explicit admin decision via review_community_report().
create table public.map_community_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles(id),
  category_id bigint references public.map_poi_categories(id),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  description text check (description is null or length(description) <= 1000),
  status text not null default 'pending' check (status in ('pending','reviewed','promoted','rejected')),
  promoted_feature_id bigint references public.map_features(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

do $$ declare t text;
begin
  foreach t in array array['map_sources','map_poi_categories','map_features','map_feature_provenance',
    'map_road_restrictions','map_service_locations','map_community_reports'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- map_sources / map_poi_categories: admin-managed reference data.
grant select on public.map_poi_categories to anon, authenticated;
create policy map_poi_category_read on public.map_poi_categories for select to anon, authenticated using (is_active or private.is_admin());
grant insert, update, delete on public.map_poi_categories to authenticated;
create policy map_poi_category_admin_write on public.map_poi_categories for all to authenticated using (private.is_admin()) with check (private.is_admin());

grant select on public.map_sources to authenticated;
create policy map_source_read on public.map_sources for select to authenticated using (private.is_admin());
grant insert, update, delete on public.map_sources to authenticated;
create policy map_source_admin_write on public.map_sources for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- map_features: public can see only verified features (or their own
-- pending submission, or everything if admin). Writes go through admin
-- direct edit (same convention as categories/products) or ingestion RPCs.
grant select on public.map_features to anon, authenticated;
create policy map_feature_read on public.map_features for select to anon, authenticated using (
  status = 'verified' or submitted_by = auth.uid() or private.is_admin());
grant insert, update, delete on public.map_features to authenticated;
create policy map_feature_admin_write on public.map_features for all to authenticated using (private.is_admin()) with check (private.is_admin());

grant select on public.map_feature_provenance to authenticated;
create policy map_feature_provenance_read on public.map_feature_provenance for select to authenticated using (private.is_admin());

grant select on public.map_road_restrictions to anon, authenticated;
create policy map_road_restriction_read on public.map_road_restrictions for select to anon, authenticated using (
  exists (select 1 from public.map_features f where f.id = feature_id and f.status = 'verified') or private.is_admin());
grant insert, update, delete on public.map_road_restrictions to authenticated;
create policy map_road_restriction_admin_write on public.map_road_restrictions for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- map_service_locations: visible when published, to its owner, or to admin.
-- No direct insert/update grant -- only publish_service_location() /
-- unpublish_service_location() (both security definer) may write a row,
-- so a client can never forge another profile's marker or coordinates.
grant select on public.map_service_locations to anon, authenticated;
create policy map_service_location_read on public.map_service_locations for select to anon, authenticated using (
  is_published or profile_id = auth.uid() or private.is_admin());
grant update, delete on public.map_service_locations to authenticated;
create policy map_service_location_admin_write on public.map_service_locations for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- map_community_reports: reporter sees their own; writes only through
-- submit_community_report() / review_community_report().
grant select on public.map_community_reports to authenticated;
create policy map_community_report_read on public.map_community_reports for select to authenticated using (
  reporter_id = auth.uid() or private.is_admin());
grant update, delete on public.map_community_reports to authenticated;
create policy map_community_report_admin_write on public.map_community_reports for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- publish_service_location: a registered service/rescuer profile opts its
-- own location into the Map. Explicit opt-in, no background tracking, no
-- route history -- Phase 1 stores only the current published point.
create function public.publish_service_location(p_lat double precision, p_lng double precision) returns bigint
language plpgsql security definer set search_path = '' as $$
declare result_id bigint; prof record;
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  if p_lat is null or p_lng is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'invalid_coordinates';
  end if;
  select user_type, name, city, region into prof from public.profiles where id = auth.uid();
  if prof.user_type not in ('service','rescuer') then raise exception 'not_a_registered_service'; end if;
  insert into public.map_service_locations(profile_id, user_type_snapshot, name_snapshot, city_snapshot, region_snapshot, lat, lng, is_published, updated_at)
  values (auth.uid(), prof.user_type, prof.name, prof.city, prof.region, p_lat, p_lng, true, now())
  on conflict (profile_id) do update set
    user_type_snapshot = excluded.user_type_snapshot, name_snapshot = excluded.name_snapshot,
    city_snapshot = excluded.city_snapshot, region_snapshot = excluded.region_snapshot,
    lat = excluded.lat, lng = excluded.lng, is_published = true, updated_at = now()
  returning id into result_id;
  return result_id;
end $$;
revoke all on function public.publish_service_location(double precision, double precision) from public, anon;
grant execute on function public.publish_service_location(double precision, double precision) to authenticated;

create function public.unpublish_service_location() returns void
language sql security definer set search_path = '' as $$
  update public.map_service_locations set is_published = false, updated_at = now() where profile_id = auth.uid();
$$;
revoke all on function public.unpublish_service_location() from public, anon;
grant execute on function public.unpublish_service_location() to authenticated;

-- submit_community_report: the only way a non-admin can propose map data.
-- This never writes map_features -- community input always lands as a
-- pending report requiring an explicit admin decision.
create function public.submit_community_report(p_category_id bigint, p_lat double precision, p_lng double precision, p_description text) returns bigint
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
  insert into public.map_community_reports(reporter_id, category_id, lat, lng, description)
  values (auth.uid(), p_category_id, p_lat, p_lng, p_description)
  returning id into result_id;
  return result_id;
end $$;
revoke all on function public.submit_community_report(bigint, double precision, double precision, text) from public, anon;
grant execute on function public.submit_community_report(bigint, double precision, double precision, text) to authenticated;

-- review_community_report: admin-only. Promotion still lands as a
-- 'pending' canonical feature -- an admin reviewing a report is a
-- moderation decision, not a field verification, so it does not skip the
-- feature's own verification step.
create function public.review_community_report(p_report_id bigint, p_decision text, p_note text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare rpt record; src_id bigint; feature_id bigint;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  if p_decision not in ('promoted','rejected') then raise exception 'invalid_decision'; end if;
  select * into rpt from public.map_community_reports where id = p_report_id and status = 'pending';
  if rpt is null then raise exception 'report_not_found'; end if;
  if p_decision = 'promoted' then
    select id into src_id from public.map_sources where code = 'community';
    insert into public.map_features(category_id, source_id, name_fa, lat, lng, status, confidence, submitted_by)
    values (coalesce(rpt.category_id, (select id from public.map_poi_categories where slug = 'other')), src_id,
      coalesce(rpt.description, 'Community report'), rpt.lat, rpt.lng, 'pending', 0.3, rpt.reporter_id)
    returning id into feature_id;
    insert into public.map_feature_provenance(feature_id, action, actor, source_id, note)
    values (feature_id, 'created', auth.uid(), src_id, p_note);
  end if;
  update public.map_community_reports set status = p_decision, promoted_feature_id = feature_id,
    reviewed_by = auth.uid(), reviewed_at = now() where id = p_report_id;
  return p_report_id;
end $$;
revoke all on function public.review_community_report(bigint, text, text) from public, anon;
grant execute on function public.review_community_report(bigint, text, text) to authenticated;

-- Seed data: POI taxonomy and the sources this Phase 1 foundation needs to
-- refer to. Future POI kinds should normally be a new row here, not a
-- migration. truck_stop/ev_charging/fuel_station are seeded inactive --
-- structurally present, not activated (Phase 1 forbids activating them).
insert into public.map_poi_categories (slug, name_fa, name_en, icon, is_active) values
  ('repair_shop', 'تعمیرگاه', 'Repair shop', 'wrench', true),
  ('parts_store', 'فروشگاه قطعات', 'Parts store', 'store', true),
  ('rescue_point', 'نقطه امداد', 'Rescue point', 'life-buoy', true),
  ('landmark', 'نقطه مرجع', 'Landmark', 'map-pin', true),
  ('other', 'سایر', 'Other', 'dot', true),
  ('fuel_station', 'پمپ بنزین', 'Fuel station', 'fuel', false),
  ('ev_charging', 'شارژ خودرو برقی', 'EV charging', 'bolt', false),
  ('truck_stop', 'توقفگاه کامیون', 'Truck stop', 'truck', false);

insert into public.map_sources (code, kind, label) values
  ('admin_manual', 'admin', 'Manual admin entry'),
  ('community', 'community', 'Community report promotion'),
  ('myc_service', 'myc_service', 'MY CAR registered service self-publish'),
  ('synthetic_fixture', 'synthetic_fixture', 'Phase 1 synthetic fixture dataset (no real dataset supplied yet)');
commit;
