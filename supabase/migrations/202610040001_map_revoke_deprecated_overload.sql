begin;
-- Persists an already-applied STAGING fix: review_community_report_deprecated_unused
-- is a renamed leftover from a Phase 2 overload bug (see
-- supabase/migrations/202610040000_map_phase2_lifecycle.sql's comment and
-- supabase/staging/202610040001_map_proximity_rpcs.sql for the full story).
-- It was renamed out of the way rather than dropped (DROP FUNCTION needs
-- interactive operator confirmation this environment can't give), and its
-- EXECUTE grants were revoked from public/anon/authenticated on STAGING.
--
-- This function was never created by any file in this directory -- it
-- only exists as an artifact of ad hoc STAGING fixes -- so a fresh local
-- PGlite replay never creates it either. The guard makes this migration a
-- safe no-op there, and an idempotent (already-revoked-or-not) REVOKE on
-- any environment where the function does exist.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'review_community_report_deprecated_unused'
      and pg_get_function_identity_arguments(p.oid) = 'bigint, text, text, timestamp with time zone'
  ) then
    revoke all on function public.review_community_report_deprecated_unused(bigint, text, text, timestamptz)
      from public, anon, authenticated;
  end if;
end $$;
commit;
