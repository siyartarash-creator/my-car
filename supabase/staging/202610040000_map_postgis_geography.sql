begin;
-- MY CAR Map/Navigation Phase 1 closure: additive PostGIS upgrade.
--
-- STAGING-ONLY. Deliberately NOT placed in supabase/migrations/: the local
-- test harness (tests/database-security.mjs, tests/map-*.mjs) replays every
-- file in that directory through @electric-sql/pglite, which does not
-- bundle the postgis extension -- "create extension postgis" there would
-- break the shared local security/map test suite for the whole repo, not
-- just this upgrade. This file is meant to be applied directly to a
-- confirmed non-production STAGING Postgres (e.g. via the Supabase MCP
-- apply_migration tool, or `supabase db push` against that project), after
-- 202610030000_map_foundation.sql and 202610030001_map_ingestion.sql have
-- already been applied there.
--
-- APPLIED to STAGING on 2026-10-04 (Phase 2, item A), authorized by Mehdi.
-- Verified post-apply: pg_extension shows postgis 3.3.7 installed; the
-- geog columns and both GiST indexes exist on the hosted project. See
-- supabase/staging/202610040001_map_proximity_rpcs.sql for the DB-native
-- proximity RPCs this enables.
--
-- Purely additive: adds a generated geography column + GiST index derived
-- from the existing lat/lng columns on map_features and
-- map_service_locations. Nothing here changes those columns, their check
-- constraints, RLS policies, or any existing RPC -- lib/map/ai-contracts.ts
-- and the Map UI keep working unmodified against lat/lng. A later, separate
-- change can opt specific proximity queries into ST_DWithin(geog, ...) once
-- this is live; that is a performance follow-up, not required by Phase 1.
create extension if not exists postgis;

alter table public.map_features
  add column if not exists geog geography(point, 4326)
    generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored;
create index if not exists map_features_geog_gix on public.map_features using gist (geog);

alter table public.map_service_locations
  add column if not exists geog geography(point, 4326)
    generated always as (
      case when lat is not null and lng is not null then st_setsrid(st_makepoint(lng, lat), 4326)::geography end
    ) stored;
create index if not exists map_service_locations_geog_gix on public.map_service_locations using gist (geog);
commit;
