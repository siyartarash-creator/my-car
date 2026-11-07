begin;

-- Rollback for 202611090000_ledger_post_settlement_correction.sql (WU-FINANCE-F3b).
--
-- Restores the posting shape that F2c left in place:
--   - drops public.admin_correct_settled_entry (the F3b RPC);
--   - restores public.admin_compute_settlement_run to its post-F2c body, character for
--     character from 202611080000_ledger_commission_row.sql lines 322-426. That body has
--     no carried-forward variables, no extra keys, and "= v_period" in the predicate.
--     It is written as `create or replace` so a second run does not error.
--
-- It adds no table, no column, no index, no trigger and no seed row, so there is nothing
-- else to undo. It does NOT touch ledger_entries rows: any correction posted by the RPC
-- stays in the ledger as history. It writes no ledger row and moves no balance.
--
-- It is idempotent: running it twice is safe. After it runs, the schema is the pre-F3b
-- schema.

drop function if exists public.admin_correct_settled_entry(uuid, text, bigint);

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
  -- income_toman reads 'job_provider_earnings%' (F2c). The provider's own share is
  -- posted under that reason, and the commission now sits on platform.revenue, so a
  -- provider's own lines carry no 'job_commission' leg: reading that reason here
  -- would count 0 and push the whole share into commission_toman.
  select count(*)::int,
         coalesce(sum(l.signed_amount), 0)::bigint,
         coalesce(sum(case when l.reason like 'job_cash_collected%' then l.signed_amount else 0 end), 0)::bigint,
         coalesce(-sum(case when l.reason like 'job_provider_earnings%' then l.signed_amount else 0 end), 0)::bigint,
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

commit;
