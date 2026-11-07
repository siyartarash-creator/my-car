begin;
-- Finance fix (2026-10-21) -- the zero-sum trigger must read the WHOLE transfer, not the
-- caller's RLS-visible slice of it.
--
-- THE BUG. `private.ledger_entries_balanced_transfer()` is a DEFERRED constraint trigger on
-- public.ledger_entries (F1). A deferred constraint trigger fires at COMMIT, i.e. AFTER the
-- SECURITY DEFINER posting helper (public.post_ledger_transfer) has returned and the session's
-- `current_user` is back to the CLIENT role (`authenticated`). The trigger function was SECURITY
-- INVOKER, so its `select ... from public.ledger_entries where transfer_id = new.transfer_id`
-- ran under the `ledger_entries_read` RLS policy, which shows a caller only the legs on their own
-- account (or an admin). Every real transfer has its two legs on DIFFERENT accounts (a customer
-- and platform.penalties, a provider and platform.clearing, ...), so the trigger saw exactly ONE
-- leg, its sum was non-zero, and it raised `unbalanced_transfer` for a transfer that is in fact
-- perfectly balanced. Through PostgREST nobody could cancel a hauling request -- or complete a
-- job, or post any other transfer -- because the last thing the transaction did was the trigger
-- reading a filtered ledger. The local suites never saw it: they run as the schema owner, which
-- bypasses RLS, and the deferred trigger fires inside the same autocommit statement there.
--
-- THE FIX. One property of the checker changes: it becomes SECURITY DEFINER. Its owner is the
-- schema owner (postgres, BYPASSRLS and the table owner), so the sum is computed over the real
-- set of legs regardless of who posted and who is committing. Body, error code, trigger object,
-- deferrability and grants are UNCHANGED. This does not weaken the invariant -- it makes the
-- existing check mean what F1 said it meant: one transfer_id is always zero-sum. A genuinely
-- unbalanced insert is still refused with `unbalanced_transfer` (the suite proves it with a raw
-- owner insert that bypasses the helper).
--
-- DELIBERATELY NOT IN THIS FIX: `private.ledger_account_stays_non_negative()` (F5) and
-- `private.ledger_entries_append_only()` (F1) are also deferred triggers running as the caller.
-- The non-negative guard has the same RLS blindness; it is outside this cancel-fix's scope and is
-- reported to the owner for the next finance step rather than changed here.
--
-- NO product behaviour, signature, status, error vocabulary, RLS policy, grant or table changes.
-- Rollback: supabase/rollback/202611150000_ledger_zero_sum_trigger_security_rollback.sql restores
-- the exact previous SECURITY INVOKER body (and with it the bug, as a rollback must).

create or replace function private.ledger_entries_balanced_transfer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select coalesce(sum(signed_amount), 0) from public.ledger_entries where transfer_id = new.transfer_id) <> 0 then
    raise exception 'unbalanced_transfer';
  end if;
  return null;
end $$;
-- The checker stays private: it is a trigger function, never a client entry point. A trigger does
-- not check EXECUTE, so this revoke removes nothing it needs; it keeps the "no client role may
-- call the ledger's internals" rule F1 stated.
revoke all on function private.ledger_entries_balanced_transfer() from public, anon, authenticated;
commit;
