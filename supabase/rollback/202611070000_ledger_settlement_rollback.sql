begin;

-- Rollback for 202611070000_ledger_settlement.sql (WU-FINANCE-F3a).
--
-- Restores the schema to exactly what it is without that migration:
--   - drops the foreign key that section E added. The COLUMN is not dropped: it is
--     F1's column (202611040000) and it survives this rollback;
--   - drops the three public RPCs;
-- Drop order, by two rules that point in opposite directions:
--   (a) a function whose parameter or return type is a table's composite type must
--       be dropped BEFORE that table, or the table drop fails. The serializer
--       (private.settlement_run_json, its first parameter is public.settlement_runs)
--       and the schedule resolver (private.settlement_schedule_for, which returns
--       public.settlement_schedules) are dropped BEFORE the tables;
--   (b) a trigger function cannot be dropped while its trigger exists. The two
--       GUARD functions (private.settlement_runs_guard, private.settlement_lines_guard)
--       are dropped AFTER the tables, because a trigger depends on its function and
--       DROP TABLE takes their triggers with it.
--   The tables go lines before runs, because lines reference runs.
-- It is idempotent: running it twice is safe.
--
-- It does NOT touch ledger_entries rows, ledger_accounts, ledger_settings or
-- post_ledger_transfer. It writes no ledger row and moves no balance.

-- The foreign key first: it refers to settlement_runs, which is dropped below.
alter table public.ledger_entries drop constraint if exists ledger_entries_settled_in_run_fk;

drop function if exists public.admin_mark_settlement_run_paid(uuid, text);
drop function if exists public.admin_approve_settlement_run(uuid);
drop function if exists public.admin_compute_settlement_run(uuid, date);

drop function if exists private.settlement_run_json(public.settlement_runs, text, boolean, boolean, text, text);
drop function if exists private.settlement_schedule_for(uuid);

drop table if exists public.settlement_lines;
drop table if exists public.settlement_runs;
drop table if exists public.settlement_schedules;

drop function if exists private.settlement_lines_guard();
drop function if exists private.settlement_runs_guard();

commit;
