begin;
-- Rollback for 202611040000_ledger_core.sql (finance step F1). Lives in
-- supabase/rollback/ on purpose: test:security replays every file in
-- supabase/migrations/, so a drop script must never sit there.
--
-- This migration is ADDITIVE ONLY -- it edited no existing function, added
-- no trigger on any existing job table, and changed no existing screen. So
-- there is nothing to restore here, unlike a rollback that has to put a
-- replaced function body back: every statement below is a DROP of an
-- object this migration, and only this migration, created.
--
-- Running this file after real ledger postings exist DESTROYS them (the
-- table drops take every entry and every account with them) -- this is a
-- development/staging-recovery tool, not a business operation, and must
-- never be run against a database that holds a real settlement history.
--
-- Dropping the two tables with CASCADE removes their own policies, indexes
-- and (for ledger_entries) its four triggers in the same statement, which
-- is why those are not dropped as separate statements first.

drop table if exists public.ledger_entries cascade;
drop table if exists public.ledger_settings cascade;

drop trigger if exists mycar_create_ledger_account on public.profiles;
drop function if exists private.create_ledger_account();

drop function if exists public.post_ledger_transfer(text, uuid, text, jsonb, jsonb);

drop function if exists private.ledger_entries_guard_settled();
drop function if exists private.ledger_entries_append_only();
drop function if exists private.ledger_entries_balanced_transfer();
drop function if exists private.ledger_entries_reversal_fidelity();

-- ledger_accounts last: its own policy and the two partial unique indexes
-- die with it.
drop table if exists public.ledger_accounts cascade;
commit;
