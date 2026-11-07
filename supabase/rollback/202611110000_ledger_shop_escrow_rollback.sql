begin;

-- Rollback for 202611110000_ledger_shop_escrow.sql (WU-FINANCE-F5).
--
-- Drops the four public RPCs, the private helpers, the two triggers and the guard that the F5 migration added,
-- the module_release_windows table with its seeded row, the platform.shop account row, the allows_negative
-- column, and the orders.delivered_at column. It returns the orders.escrow_status column to its pre-F5 default
-- (none -- see the note at the bottom of this file).
--
-- It does NOT touch any ledger_entries row, any existing function body, any settlement table, or any account
-- other than platform.shop. Ledger history is never deleted: if any wallet payment ever posted to platform.shop,
-- the ledger's foreign key (ledger_entries.account_id, on delete restrict) refuses the account delete, and the
-- rollback fails loudly. That is correct: a rollback after real shop money is refused, not forced.
--
-- ESCROW DEFAULT. The migration dropped the default 'held' and set every NON-WALLET row to NULL (its D6). The
-- rollback restores the default to what it was (nothing) and leaves the rows the migration cleared at NULL, which
-- is the pre-F5 state for every row that was never paid by a wallet -- the only kind that existed before it.
--
-- It is idempotent: the drops use if exists, the delete matches zero rows on a second run, and every update and
-- default change is a no-op when already in the pre-F5 state.

-- The guard first: its trigger, then its function.
drop trigger if exists ledger_entries_non_negative_guard on public.ledger_entries;
drop function if exists private.ledger_account_stays_non_negative();

-- The default-flag trigger, then the functions it used.
drop trigger if exists mycar_ledger_account_negative_default on public.ledger_accounts;
drop function if exists private.set_ledger_account_negative_default();
drop function if exists private.ledger_account_role_default(uuid);

-- The public RPCs.
drop function if exists public.admin_upsert_module_release_window(text, integer, text, text);
drop function if exists public.admin_refund_order_escrow(bigint, text, uuid);
drop function if exists public.admin_release_order_escrow(bigint, text);
drop function if exists public.pay_order_from_wallet(bigint, uuid);

-- The release-window helpers, then the table that holds the data (its policy goes with it).
drop function if exists private.module_release_window_days();
drop function if exists private.module_release_window_for(text);
drop table if exists public.module_release_windows;

-- The shop account. Plain delete: after this rollback no money path references it.
delete from public.ledger_accounts where code = 'platform.shop';

-- The ledger column.
alter table public.ledger_accounts drop column if exists allows_negative;

-- The delivery stamp: its trigger, its function, then the column.
drop trigger if exists mycar_orders_stamp_delivered_at on public.orders;
drop function if exists private.orders_stamp_delivered_at();
alter table public.orders drop column if exists delivered_at;

-- The escrow default. Pre-F5, the column is nullable with NO default (202610100002 dropped it), and no row in a
-- pre-F5 database holds 'held' (the same migration's backfill left every row NULL). So the rollback returns the
-- column to exactly that state: default dropped, and the rows the migration's own backfill set to NULL stay NULL.
-- It deliberately does NOT write 'held' back: that value is this step's payment state, and re-introducing it
-- would invent escrow data the pre-F5 schema never had.
alter table public.orders alter column escrow_status drop default;

commit;
