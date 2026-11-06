begin;

-- Rollback for 202611100000_ledger_wallet_admin.sql (WU-FINANCE-F4).
--
-- Drops the six public RPCs and the two private helpers that the F4 migration added, and
-- removes the one seeded platform account row (platform.manual_adjustments).
--
-- It adds no table, column, index, trigger or RLS change, so there is nothing else to undo.
-- It does NOT touch any ledger_entries row, and it does NOT touch settlement_runs,
-- settlement_lines, settlement_schedules or ledger_debt_ceilings: their data is history.
--
-- THE SEEDED ROW. Plain delete, on purpose. If any manual charge or withdraw was ever posted
-- to platform.manual_adjustments, the ledger's foreign key (ledger_entries.account_id,
-- on delete restrict) refuses the delete, and the rollback fails loudly. Silently skipping
-- the delete would leave a platform account that the schema says is gone. Entries are never
-- deleted, so a rollback after real manual entries is correctly refused.
--
-- It is idempotent: the drops use if exists, and the delete matches zero rows on a second run.
-- After it runs, the schema is the pre-F4 schema.

drop function if exists public.admin_finance_report(text, date, date, text);
drop function if exists public.admin_upsert_ledger_debt_ceiling(text, bigint, numeric, numeric, boolean, text);
drop function if exists public.admin_upsert_settlement_schedule(uuid, time, boolean, text, text);
drop function if exists public.admin_manual_wallet_entry(uuid, text, bigint, text, text);
drop function if exists public.admin_wallet_statement(uuid, date, date, integer, integer);
drop function if exists public.admin_wallet_accounts(text, integer, integer, boolean);
drop function if exists private.wallet_account_summary(uuid, integer);
drop function if exists private.wallet_account_figures(uuid);

delete from public.ledger_accounts where code = 'platform.manual_adjustments';

commit;
