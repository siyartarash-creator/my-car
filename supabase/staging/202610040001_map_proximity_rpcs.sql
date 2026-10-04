begin;
-- MY CAR Map/Navigation Phase 2, item A (part 2): DB-native proximity.
--
-- STAGING-ONLY, same reason as 202610040000_map_postgis_geography.sql --
-- these reference the geography column and ST_DWithin/ST_Distance, which
-- don't exist under the local PGlite test harness.
--
-- Both functions are SECURITY INVOKER (the default -- no "security
-- definer" here), so they run with the CALLING role's own privileges and
-- existing RLS (map_service_location_read / map_feature_read) still
-- applies underneath the explicit filters below; this is a stricter
-- public-facing projection, not a bypass. They replace the
-- bounding-box-then-haversine-in-JS approach lib/map/ai-contracts.ts used
-- before PostGIS was available -- same contract (sorted by real distance,
-- radius in meters), now computed by the database with a GiST index
-- instead of over-fetching a box and filtering client-side.
-- search_path is pinned to '' (this codebase's convention for every other
-- function) and every postgis call is schema-qualified as public.st_* --
-- postgis is installed in the public schema here (Supabase's default; the
-- security advisor flags this as a WARN recommending a dedicated schema,
-- not fixed in this pass since it's a shared-extension, project-wide
-- concern beyond Map's bounded scope, not something only Map depends on).
create or replace function public.nearby_service_locations(
  p_lat double precision, p_lng double precision, p_radius_m integer
) returns table (
  id bigint, profile_id uuid, user_type_snapshot text, name_snapshot text,
  city_snapshot text, region_snapshot text, lat double precision, lng double precision,
  distance_m double precision
) language sql stable set search_path = '' as $$
  select id, profile_id, user_type_snapshot, name_snapshot, city_snapshot, region_snapshot, lat, lng,
    public.st_distance(geog, public.st_setsrid(public.st_makepoint(p_lng, p_lat), 4326)::public.geography) as distance_m
  from public.map_service_locations
  where is_published is true
    and public.st_dwithin(geog, public.st_setsrid(public.st_makepoint(p_lng, p_lat), 4326)::public.geography, p_radius_m)
  order by distance_m;
$$;
revoke all on function public.nearby_service_locations(double precision, double precision, integer) from public;
grant execute on function public.nearby_service_locations(double precision, double precision, integer) to anon, authenticated;

-- status='verified' and the expiry check are explicit here (not left to
-- RLS alone) so this public proximity search always excludes pending and
-- expired features regardless of caller role -- an admin browsing this
-- RPC sees the same "what the public map shows" result as anyone else;
-- direct table access remains the path for admin moderation views.
create or replace function public.nearby_features(
  p_lat double precision, p_lng double precision, p_radius_m integer, p_category_slug text default null
) returns table (
  id bigint, category_id bigint, name_fa text, name_en text,
  lat double precision, lng double precision, status text, confidence numeric,
  distance_m double precision
) language sql stable set search_path = '' as $$
  select f.id, f.category_id, f.name_fa, f.name_en, f.lat, f.lng, f.status, f.confidence,
    public.st_distance(f.geog, public.st_setsrid(public.st_makepoint(p_lng, p_lat), 4326)::public.geography) as distance_m
  from public.map_features f
  join public.map_poi_categories c on c.id = f.category_id
  where f.status = 'verified'
    and (f.expires_at is null or f.expires_at > now())
    and public.st_dwithin(f.geog, public.st_setsrid(public.st_makepoint(p_lng, p_lat), 4326)::public.geography, p_radius_m)
    and (p_category_slug is null or c.slug = p_category_slug)
  order by distance_m;
$$;
revoke all on function public.nearby_features(double precision, double precision, integer, text) from public;
grant execute on function public.nearby_features(double precision, double precision, integer, text) to anon, authenticated;
commit;
