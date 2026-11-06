begin;
-- Rollback of 202611150000_ledger_zero_sum_trigger_security.sql.
--
-- Restores the F1 body exactly: SECURITY INVOKER, same search_path, same zero-sum check, same
-- error. This intentionally restores the RLS-blind behaviour of the deferred trigger, because a
-- rollback must return the schema to its previous state -- the state in which every transfer
-- posted through PostgREST was refused as `unbalanced_transfer`. The trigger object itself is
-- not touched by either direction (only the function body changes).

create or replace function private.ledger_entries_balanced_transfer() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select coalesce(sum(signed_amount), 0) from public.ledger_entries where transfer_id = new.transfer_id) <> 0 then
    raise exception 'unbalanced_transfer';
  end if;
  return null;
end $$;
revoke all on function private.ledger_entries_balanced_transfer() from public, anon, authenticated;
commit;
