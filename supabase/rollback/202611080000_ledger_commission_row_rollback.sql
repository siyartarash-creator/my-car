begin;

-- Rollback for 202611080000_ledger_commission_row.sql (WU-FINANCE-F2c).
--
-- Restores the posting shape that F2a and F3a left in place:
--   - drops private.post_ledger_provider_earnings (the F2c helper);
--   - restores the five replaced bodies character-for-character from their source
--     migrations: private.post_ledger_job_commission and private.post_ledger_penalty
--     from 202611050000_ledger_postings.sql; public.complete_hauling_job and
--     public.onsite_job_complete from the same file; and
--     public.admin_compute_settlement_run from 202611070000_ledger_settlement.sql.
--     Each is written as `create or replace` so a second run does not error.
--   - deletes the two platform account rows this migration seeded, but ONLY those
--     that carry no ledger entries. An account with entries is a financial record
--     (ledger_entries.account_id is ON DELETE RESTRICT), so it is left in place and
--     a NOTICE says so.
--
-- It is idempotent: running it twice is safe.
--
-- It does NOT touch ledger_entries rows, ledger_settings, post_ledger_transfer or any
-- table. It writes no ledger row and moves no balance. Rows that F2c already posted
-- keep their new shape: this rollback changes the code that posts, not the history.

drop function if exists private.post_ledger_provider_earnings(uuid, uuid, text);

create or replace function private.post_ledger_job_commission(p_provider_id uuid, p_request_id uuid, p_source_type text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_hauling public.hauling_requests%rowtype;
  v_onsite public.onsite_requests%rowtype;
  v_full bigint;
  v_rate jsonb;
  v_commission bigint;
  v_earned bigint;
  v_provider_account uuid;
  v_revenue_account uuid;
begin
  if p_source_type = 'hauling_request' then
    select * into v_hauling from public.hauling_requests where id = p_request_id;
    v_full := private.effective_hauling_price(v_hauling);
  elsif p_source_type = 'onsite_request' then
    select * into v_onsite from public.onsite_requests where id = p_request_id;
    v_full := v_onsite.accepted_price_toman;
  else
    raise exception 'invalid_source_type';
  end if;
  if v_full is null or v_full <= 0 then raise exception 'invalid_amount'; end if;

  v_rate := private.ledger_commission(v_full);
  v_commission := (v_rate ->> 'commission')::bigint;
  -- A ZERO commission posts no commission transfer at all. This is the honest
  -- representation of a zero commission: the ledger refuses a zero-amount leg,
  -- so there is no transfer that says "zero". The same early return covers a
  -- commission equal to the whole invoice (earned_share 0), where the provider's
  -- net is already the commission after the collection event.
  if v_commission = 0 then return; end if;
  v_earned := v_full - v_commission;
  -- A commission larger than the job price is a rate-configuration error, not a
  -- state this ledger may record: `earned_share` would go negative and the
  -- commission event would CREDIT the provider, leaving a net that is not the
  -- commission. Fail loud instead of posting a silently wrong pair.
  if v_earned < 0 then raise exception 'invalid_commission'; end if;
  if v_earned = 0 then return; end if;

  select a.id into v_provider_account from public.ledger_accounts a where a.profile_id = p_provider_id;
  select a.id into v_revenue_account from public.ledger_accounts a where a.code = 'platform.revenue';
  if v_provider_account is null or v_revenue_account is null then
    raise exception 'ledger_account_not_found';
  end if;

  perform public.post_ledger_transfer(p_source_type, p_request_id, 'job_commission',
    jsonb_build_array(
      jsonb_build_object('account_id', v_provider_account, 'signed_amount', -v_earned),
      jsonb_build_object('account_id', v_revenue_account, 'signed_amount', v_earned)),
    jsonb_build_object(
      'code', 'commission',
      'calc_mode', v_rate -> 'calc_mode',
      'rate_percent', v_rate -> 'rate_percent',
      'amount_toman', v_rate -> 'amount_toman',
      'basis_toman', v_full,
      'commission_toman', v_commission,
      'job_price_toman', v_full,
      'rate_row_id', v_rate -> 'rate_id'));
end $$;
revoke all on function private.post_ledger_job_commission(uuid, uuid, text) from public, anon, authenticated;

create or replace function private.post_ledger_penalty(p_payer_id uuid, p_request_id uuid, p_source_type text, p_reason text, p_amount bigint, p_rate_snapshot jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_payer_account uuid;
  v_revenue_account uuid;
begin
  if p_source_type not in ('hauling_request', 'onsite_request') then raise exception 'invalid_source_type'; end if;
  if p_reason not in ('cancel_penalty', 'rescuer_cancel_penalty') then raise exception 'invalid_reason'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;

  select a.id into v_payer_account from public.ledger_accounts a where a.profile_id = p_payer_id;
  select a.id into v_revenue_account from public.ledger_accounts a where a.code = 'platform.revenue';
  if v_payer_account is null or v_revenue_account is null then
    raise exception 'ledger_account_not_found';
  end if;

  perform public.post_ledger_transfer(p_source_type, p_request_id, p_reason,
    jsonb_build_array(
      jsonb_build_object('account_id', v_payer_account, 'signed_amount', -p_amount),
      jsonb_build_object('account_id', v_revenue_account, 'signed_amount', p_amount)),
    p_rate_snapshot);
end $$;
revoke all on function private.post_ledger_penalty(uuid, uuid, text, text, bigint, jsonb) from public, anon, authenticated;

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
    perform private.post_ledger_cash_collection(uid, r.id, 'hauling_request', v_price);
    perform private.post_ledger_job_commission(uid, r.id, 'hauling_request');
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
    perform private.post_ledger_cash_collection(uid, r.id, 'onsite_request', r.accepted_price_toman);
    perform private.post_ledger_job_commission(uid, r.id, 'onsite_request');
  end if;
end $$;
revoke all on function public.onsite_job_complete(uuid,boolean) from public, anon;
grant execute on function public.onsite_job_complete(uuid,boolean) to authenticated;

create or replace function public.admin_compute_settlement_run(p_provider_id uuid, p_period date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_account_id uuid;
  v_schedule public.settlement_schedules%rowtype;
  v_schedule_source text;
  v_settle_at text;
  v_period date;
  v_run public.settlement_runs%rowtype;
  v_run_exists boolean;
  v_new_ids uuid[];
  v_created boolean := false;
  v_entry_count integer;
  v_net bigint;
  v_cash bigint;
  v_income bigint;
  v_penalty bigint;
  v_commission bigint;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'forbidden'; end if;

  select a.id into v_account_id from public.ledger_accounts a where a.profile_id = p_provider_id;
  if v_account_id is null then raise exception 'ledger_account_not_found'; end if;

  select * into v_schedule from private.settlement_schedule_for(p_provider_id);
  if not found then raise exception 'settlement_schedule_missing'; end if;
  v_schedule_source := case when v_schedule.profile_id is null then 'default' else 'profile' end;
  v_settle_at := v_schedule.settle_at_time::text;

  if p_period is null then
    if not v_schedule.is_active then raise exception 'settlement_schedule_inactive'; end if;
    -- Before today's time of day, the last COMPLETED day is the period.
    v_period := case when (now() at time zone 'utc')::time >= v_schedule.settle_at_time
                     then (now() at time zone 'utc')::date
                     else (now() at time zone 'utc')::date - 1 end;
  else
    v_period := p_period;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('settlement_run:' || p_provider_id::text || ':' || v_period::text, 0));

  select * into v_run from public.settlement_runs r where r.provider_id = p_provider_id and r.period = v_period;
  v_run_exists := found;
  if v_run_exists and v_run.status <> 'draft' then
    return private.settlement_run_json(v_run, 'run_already_closed', false, false, v_schedule_source, v_settle_at);
  end if;

  -- The entries this compute covers: the provider's own, unsettled, dated this period.
  -- Rows already marked settled are excluded by the predicate: never re-claimed, never un-marked.
  select array_agg(e.id order by e.created_at, e.id) into v_new_ids
    from public.ledger_entries e
   where e.account_id = v_account_id
     and e.settled_in_run_id is null
     and (e.created_at at time zone 'utc')::date = v_period;

  if v_new_ids is null then
    if v_run_exists then
      return private.settlement_run_json(v_run, 'nothing_new', false, false, v_schedule_source, v_settle_at);
    end if;
    return private.settlement_run_json(null::public.settlement_runs, 'nothing_to_settle', false, false, v_schedule_source, v_settle_at);
  end if;

  if not v_run_exists then
    insert into public.settlement_runs (provider_id, account_id, period, status)
      values (p_provider_id, v_account_id, v_period, 'draft')
      returning * into v_run;
    v_created := true;
  end if;

  insert into public.settlement_lines (run_id, entry_id, account_id, reason, source_type, source_id, signed_amount, entry_created_at)
    select v_run.id, e.id, e.account_id, e.reason, e.source_type, e.source_id, e.signed_amount, e.created_at
      from public.ledger_entries e
     where e.id = any(v_new_ids);

  update public.ledger_entries set settled_in_run_id = v_run.id
   where id = any(v_new_ids) and settled_in_run_id is null;

  -- The totals are recomputed FROM THE RUN'S OWN LINES, never from the ledger or a rate.
  select count(*)::int,
         coalesce(sum(l.signed_amount), 0)::bigint,
         coalesce(sum(case when l.reason like 'job_cash_collected%' then l.signed_amount else 0 end), 0)::bigint,
         coalesce(-sum(case when l.reason like 'job_commission%' then l.signed_amount else 0 end), 0)::bigint,
         coalesce(-sum(case when l.reason like '%penalty%' then l.signed_amount else 0 end), 0)::bigint
    into v_entry_count, v_net, v_cash, v_income, v_penalty
    from public.settlement_lines l
   where l.run_id = v_run.id;
  v_commission := v_cash - v_income;

  update public.settlement_runs
     set computed_at = now(),
         entry_count = v_entry_count,
         net_toman = v_net,
         cash_collected_toman = v_cash,
         income_toman = v_income,
         penalty_toman = v_penalty,
         commission_toman = v_commission
   where id = v_run.id
  returning * into v_run;

  return private.settlement_run_json(v_run, 'computed', v_created, v_run_exists, v_schedule_source, v_settle_at);
end $$;
revoke all on function public.admin_compute_settlement_run(uuid, date) from public, anon, authenticated;
grant execute on function public.admin_compute_settlement_run(uuid, date) to authenticated;


-- Remove the two seeded accounts, but only where nothing references them.
delete from public.ledger_accounts a
 where a.code in ('platform.provider_earnings', 'platform.penalties')
   and not exists (select 1 from public.ledger_entries e where e.account_id = a.id);

do $$
begin
  if exists (select 1 from public.ledger_accounts a
              where a.code in ('platform.provider_earnings', 'platform.penalties')) then
    raise notice 'ledger rollback 202611080000: platform.provider_earnings and/or platform.penalties carry ledger entries and were left in place';
  end if;
end $$;

commit;
