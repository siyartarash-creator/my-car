begin;
-- Rollback for 202611050000_ledger_postings.sql (finance step F2a).
-- Restores the schema to exactly its state without this migration. Idempotent:
-- every drop is `if exists`, and every restored body is `create or replace`, so
-- running this file twice is safe. It does NOT touch ledger_entries,
-- ledger_accounts, ledger_settings or post_ledger_transfer -- F1 is not this
-- migration's to undo (see 202611040000_ledger_core_rollback.sql for that).
--
-- Order: restore the four replaced RPC bodies first (so nothing calls a helper
-- that is about to be dropped), then drop the 4-argument overload, the helpers,
-- and the return_requests column with its index.

-- Restore 1: public.complete_hauling_job, verbatim from
-- 202611020000_price_revisions.sql lines 315-361.
create or replace function public.complete_hauling_job(p_request_id uuid, p_cash_collected boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.hauling_requests%rowtype;
  rate public.hauling_financial_rates%rowtype;
  commission bigint := 0;
  v_price bigint;
begin
  if uid is null then raise exception 'unauthorized'; end if;
  select * into r from public.hauling_requests where id = p_request_id for update;
  if not found then raise exception 'request_not_found'; end if;
  if r.provider_id <> uid then raise exception 'forbidden'; end if;
  if r.status = 'done' then return; end if;                          -- idempotent
  if r.status <> 'in_progress' then raise exception 'invalid_transition'; end if;
  if p_cash_collected is true and coalesce(r.payment_method, 'cash') <> 'cash' then
    raise exception 'payment_method_mismatch';
  end if;
  v_price := private.effective_hauling_price(r);
  select * into rate from public.hauling_financial_rates where code = 'commission' and is_active is true limit 1;
  if rate.id is not null then
    commission := case when rate.calc_mode = 'fixed' then coalesce(rate.amount_toman, 0)
                       else round(v_price * coalesce(rate.rate_percent, 0) / 100) end;
  end if;
  update public.hauling_requests
    set status = 'done', completed_at = now(), cash_collected = p_cash_collected, updated_at = now()
  where id = r.id;
  perform private.log_hauling_event(r.id, 'job.completed', uid,
    jsonb_build_object('accepted_price_toman', v_price, 'payment_method', r.payment_method,
                       'cash_collected', p_cash_collected));
  if p_cash_collected then
    perform private.log_hauling_event(r.id, 'payment.collected', uid,
      jsonb_build_object('amount_toman', v_price, 'method', 'cash', 'collected_by', uid));
  else
    -- Online/wallet settlement is a later phase; the debt is recorded now the
    -- moment it exists, instead of being inferred backwards later.
    perform private.log_hauling_event(r.id, 'payment.deferred_online', uid,
      jsonb_build_object('amount_toman', v_price, 'method', r.payment_method));
  end if;
  if rate.id is not null then
    perform private.log_hauling_event(r.id, 'commission.assessed', uid,
      jsonb_build_object('code', 'commission', 'amount_toman', commission, 'payer', rate.payer,
                         'basis_toman', v_price));
  end if;
end $$;
revoke all on function public.complete_hauling_job(uuid, boolean) from public, anon;
grant execute on function public.complete_hauling_job(uuid, boolean) to authenticated;

-- Restore 2: public.onsite_job_complete, verbatim from
-- 202610160003_onsite_dispatch_rpcs.sql lines 544-571.
create or replace function public.onsite_job_complete(p_request_id uuid, p_cash_collected boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.onsite_requests%rowtype;
begin
  if uid is null then raise exception 'unauthorized'; end if;
  select * into r from public.onsite_requests where id = p_request_id for update;
  if not found then raise exception 'request_not_found'; end if;
  if r.provider_id <> uid then raise exception 'forbidden'; end if;
  if r.status = 'done' then return; end if;                          -- idempotent
  if r.status <> 'in_progress' then raise exception 'invalid_transition'; end if;
  if p_cash_collected is true and coalesce(r.payment_method, 'cash') <> 'cash' then
    raise exception 'payment_method_mismatch';
  end if;
  update public.onsite_requests
    set status = 'done', completed_at = now(), cash_collected = p_cash_collected, updated_at = now()
  where id = r.id;
  perform private.log_onsite_event(r.id, 'job.completed', uid,
    jsonb_build_object('accepted_price_toman', r.accepted_price_toman, 'payment_method', r.payment_method,
                       'cash_collected', p_cash_collected));
  if p_cash_collected then
    perform private.log_onsite_event(r.id, 'payment.collected', uid,
      jsonb_build_object('amount_toman', r.accepted_price_toman, 'method', 'cash', 'collected_by', uid));
  end if;
end $$;
revoke all on function public.onsite_job_complete(uuid,boolean) from public, anon;
grant execute on function public.onsite_job_complete(uuid,boolean) to authenticated;

-- Restore 3: public.cancel_hauling_request, verbatim from
-- 202610140003_hauling_dispatch_rpcs.sql lines 452-490.
create or replace function public.cancel_hauling_request(p_request_id uuid, p_reason text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.hauling_requests%rowtype;
  rate public.hauling_financial_rates%rowtype;
  fee bigint := 0;
begin
  if uid is null then raise exception 'unauthorized'; end if;
  select * into r from public.hauling_requests where id = p_request_id for update;
  if not found then raise exception 'request_not_found'; end if;
  -- Same NULL trap as get_dispatch_status: a request that has not been accepted
  -- yet has provider_id IS NULL, so <> would let a stranger cancel it.
  if r.requester_id is distinct from uid and r.provider_id is distinct from uid then raise exception 'forbidden'; end if;
  if r.status = 'cancelled' then return coalesce(r.cancel_fee_toman, 0); end if;
  if r.status not in ('created', 'priced', 'dispatching', 'accepted', 'en_route', 'arrived') then
    raise exception 'cannot_cancel';
  end if;
  select * into rate from public.hauling_financial_rates where code = 'cancel_penalty' and is_active is true limit 1;
  if rate.id is not null
     and (rate.free_window_minutes is null
          or now() > r.created_at + (rate.free_window_minutes || ' minutes')::interval) then
    fee := case when rate.calc_mode = 'fixed' then coalesce(rate.amount_toman, 0)
                else round(r.quoted_price_toman * coalesce(rate.rate_percent, 0) / 100) end;
  end if;
  update public.hauling_requests
    set status = 'cancelled', cancelled_at = now(), cancelled_by = uid, cancel_reason = p_reason,
        cancel_fee_toman = fee, updated_at = now()
  where id = r.id;
  update public.hauling_dispatch_offers set response = 'expired', responded_at = now()
  where request_id = r.id and response = 'pending';
  perform private.log_hauling_event(r.id, 'request.cancelled', uid,
    jsonb_build_object('reason', p_reason, 'cancel_fee_toman', fee, 'by_requester', r.requester_id = uid));
  if fee > 0 then
    perform private.log_hauling_event(r.id, 'penalty.assessed', uid,
      jsonb_build_object('code', 'cancel_penalty', 'amount_toman', fee, 'payer', rate.payer));
  end if;
  return fee;
end $$;
revoke all on function public.cancel_hauling_request(uuid,text) from public, anon;
grant execute on function public.cancel_hauling_request(uuid,text) to authenticated;

-- Restore 4: public.rescuer_cancel_hauling_request, verbatim from
-- 202610240000_suspension_covers_every_provider_action.sql lines 402-459. That
-- source carries no GRANT line in this range; `create or replace` keeps the
-- function's existing ACL, and this migration never changes it.
create or replace function public.rescuer_cancel_hauling_request(p_request_id uuid, p_reason text default null::text) returns bigint
language plpgsql security definer set search_path = '' as $function$
declare
  uid uuid := auth.uid();
  r public.hauling_requests%rowtype;
  rate public.hauling_financial_rates%rowtype;
  fee bigint := 0;
  cfg text;
begin
  if uid is null then raise exception 'unauthorized'; end if;
  if private.is_suspended(uid) then raise exception 'account_suspended'; end if;
  select * into r from public.hauling_requests where id = p_request_id for update;
  if not found then raise exception 'request_not_found'; end if;
  if r.provider_id is distinct from uid then raise exception 'forbidden'; end if;
  -- Already cancelled: report the recorded fee, assess nothing new.
  if r.status = 'cancelled' then return coalesce(r.cancel_fee_toman, 0); end if;
  if r.status not in ('accepted', 'en_route', 'arrived') then raise exception 'cannot_cancel'; end if;

  select * into rate from public.hauling_financial_rates
    where code = 'rescuer_cancel_penalty' and is_active is true limit 1;
  if rate.id is not null then
    fee := case when rate.calc_mode = 'fixed' then coalesce(rate.amount_toman, 0)
                else round(r.accepted_price_toman * coalesce(rate.rate_percent, 0) / 100) end;
  else
    -- No rate row yet: the owner-editable default, still data, still not code.
    select value into cfg from public.site_settings where key = 'emdad.rescuer_cancel_penalty_toman';
    fee := greatest(coalesce(nullif(regexp_replace(coalesce(cfg, ''), '[^0-9]', '', 'g'), '')::bigint, 200000), 0);
  end if;

  update public.hauling_requests
    set status = 'cancelled', cancelled_at = now(), cancelled_by = uid, cancel_reason = p_reason,
        cancel_fee_toman = fee, updated_at = now()
  where id = r.id;
  update public.hauling_dispatch_offers set response = 'expired', responded_at = now()
    where request_id = r.id and response = 'pending';

  perform private.log_hauling_event(r.id, 'request.cancelled', uid,
    jsonb_build_object('reason', p_reason, 'cancel_fee_toman', fee, 'by_rescuer', true));
  -- Owner decision #7: the penalty AND the negative score, both recorded on the
  -- one event that already carries the amount, so the daily settlement and the
  -- admin panel read the same fact instead of re-deriving it.
  if fee > 0 then
    perform private.log_hauling_event(r.id, 'penalty.assessed', uid,
      jsonb_build_object('code', 'rescuer_cancel_penalty', 'amount_toman', fee, 'payer', 'rescuer'));
  end if;
  update public.profiles
    set rescuer_negative_score = coalesce(rescuer_negative_score, 0) - 1,
        rescuer_cancellations = coalesce(rescuer_cancellations, 0) + 1
  where id = uid;
  perform private.log_hauling_event(r.id, 'rescuer.negative_score', uid,
    jsonb_build_object('delta', -1, 'reason', 'rescuer_cancel'));
  return fee;
end $function$
;

-- Drop the 4-argument overload only. The 3-argument public.admin_decide_return
-- (202611010000) was never replaced, and it survives this rollback unchanged.
drop function if exists public.admin_decide_return(uuid, text, text, uuid);

-- Drop the return_requests column and its partial unique index.
drop index if exists public.return_requests_ledger_refund_transfer_unique;
alter table public.return_requests drop column if exists ledger_refund_transfer_id;

-- Drop the private helpers. Each signature is named exactly.
drop function if exists private.reverse_ledger_transfer(uuid, jsonb);
drop function if exists private.post_ledger_penalty(uuid, uuid, text, text, bigint, jsonb);
drop function if exists private.post_ledger_cash_collection(uuid, uuid, text, bigint);
drop function if exists private.post_ledger_job_commission(uuid, uuid, text);
drop function if exists private.ledger_commission(bigint);
commit;
