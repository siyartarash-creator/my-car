begin;
-- MY CAR Map/Navigation Phase 3 final audit corrective: automatic
-- precise-location cleanup scheduling.
--
-- STAGING-ONLY. Deliberately NOT placed in supabase/migrations/: pg_cron
-- (and its `cron` schema) is not bundled in @electric-sql/pglite, the
-- local test harness every file under supabase/migrations/ is replayed
-- through -- "create extension pg_cron" there would break the shared
-- local test suite for the whole repo, the same reason
-- 202610040000_map_postgis_geography.sql lives here instead of
-- supabase/migrations/. The function being scheduled
-- (public.cleanup_expired_location_shares(), already deployed via
-- supabase/migrations/202610090000_map_phase3_audit_corrective.sql) is
-- unaffected either way -- its own logic is already covered by
-- tests/map-phase3-audit-corrective-db.mjs; this file only adds the
-- schedule that calls it automatically.
--
-- pg_cron is a $0, Supabase-bundled extension (not a paid add-on --
-- confirmed via mcp__supabase__list_extensions: listed with a
-- default_version, no separate billing tier required to enable it). No
-- other scheduling mechanism exists in this repo (no Edge Functions, no
-- external cron) -- pg_cron is the smallest, already-available path.
--
-- Idempotent: unschedules any prior job with this exact name first, so
-- re-applying this file (e.g. after a schedule-interval change) never
-- creates a second, duplicate job.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'map_cleanup_expired_location_shares';
exception when others then
  -- pg_cron/the cron schema doesn't exist yet on a first-ever apply
  -- (raises invalid_schema_name, not undefined_table) -- harmless; the
  -- extension is created fresh immediately below in that case.
  null;
end $$;

create extension if not exists pg_cron;

-- Every 30 minutes: frequent enough that an expired/old-revoked share
-- (12h TTL cap, 24h post-revoke grace -- see
-- public.cleanup_expired_location_shares()'s own definition) doesn't sit
-- around for hours after it qualifies for deletion, without re-running
-- so often that it's doing meaningful work on an empty/near-empty table.
-- Runs as the role that owns this cron job (the database owner /
-- postgres, the same role this migration itself runs as) -- consistent
-- with cleanup_expired_location_shares() having no EXECUTE grant to
-- anon/authenticated at all (service-role/system-only, see its own
-- definition's comment).
select cron.schedule(
  'map_cleanup_expired_location_shares',
  '*/30 * * * *',
  $$select public.cleanup_expired_location_shares();$$
);
commit;
