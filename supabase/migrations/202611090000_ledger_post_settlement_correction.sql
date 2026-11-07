begin;
-- WU-FINANCE-F3b: correcting a SETTLED entry through a reasoned, audited reversal.
-- osaa/specs/finance.md section 4 row F3b, section 2 rules 4, 5 and 8, and TD-043.
--
-- THE GAP (TD-043). An entry that must change AFTER its period was settled had nowhere
-- to go. (provider_id, period) is unique on settlement_runs, and a paid run's lines are
-- immutable, so the closed run cannot be reopened (rules 4 and 5). Editing the entry
-- would rewrite history, which the ledger forbids. Before this step there was no
-- sanctioned way to put the money right.
--
-- THE FIX. One Super-Admin RPC, public.admin_correct_settled_entry(p_entry_id,
-- p_reason, p_new_provider_amount), takes an already SETTLED entry and posts:
--   (a) its EXACT reversal: the same amount with the opposite sign, reverses_entry_id
--       pointing at the original, and no settled_in_run_id;
--   (b) when p_new_provider_amount is given, a corrected entry: a NEW row, also
--       unsettled, with no settled_in_run_id and no reverses_entry_id.
-- The original entry and the closed run are NEVER touched: no UPDATE, no line added or
-- removed, no reopening. The reversal and the correction land in the NEXT COMPUTED
-- settlement for that provider (section B below), so the money is reconciled in a
-- future run rather than by rewriting history. Cutover rule (spec section 3): no backfill.
--
-- WHICH ENTRY IS CORRECTED, AND WHY. The entry must sit on a PROFILE account
-- (kind = 'profile'). Only a profile account moves a person's balance, which is what
-- private.ceiling_decision reads and what the next run settles. An entry on a platform
-- account is refused with 'not_a_provider_entry'.
-- The reversal must negate the original exactly. F1's reversal-fidelity trigger
-- (202611040000) requires the same account_id, signed_amount = -original, the same
-- source_type and the same source_id. A commission-rate correction is therefore
-- expressed by correcting the provider's own settled 'job_provider_earnings' line.
-- Example: 20% down to 15% raises the provider's own share from 800,000 to 850,000, so
-- p_new_provider_amount is -850000 instead of -800000 (a 50,000 credit that lowers what
-- the provider owes by exactly the difference in commission).
-- p_new_provider_amount is the signed amount the PROVIDER's own line must carry after
-- the correction. The counter-leg has the opposite sign and sits on the platform account
-- that the original transfer's other leg sits on. The transfer is always zero-sum.
--
-- REASONS. The reversal's reason is the original reason || '_reversed' (the same
-- convention as F2a's private.reverse_ledger_transfer). The corrected row's reason is
-- the original reason || '_corrected'. The family prefix is kept on purpose: the
-- compute's 'like' patterns ('job_provider_earnings%', '%penalty%') still classify these
-- rows, so the next run's income_toman, penalty_toman and every report family see them.
--
-- THE HAND-COMPUTED EXAMPLE (the acceptance arithmetic, asserted in
-- tests/finance-correction.mjs). Provider A, one cash job of 1,000,000 at 20%, dated P:
--   provider lines:  job_cash_collected +1,000,000 and job_provider_earnings -800,000
--   platform lines:  job_cash_collected clearing -1,000,000 / job_provider_earnings
--                    platform.provider_earnings +800,000 / job_commission clearing
--                    -200,000 and platform.revenue +200,000
--   provider balance +200,000 (the commission, which is the debt that F2b's ceiling reads).
-- Run P: entry_count 2, cash_collected 1,000,000, income 800,000, commission 200,000,
-- penalty 0, net 200,000. Approved, then marked paid.
-- Correction on day T (today by the ledger's UTC clock; see below) of the settled
-- -800,000 line to -850,000 is TWO transfers:
--   reversal:  'job_provider_earnings_reversed'  provider +800,000 / platform.provider_earnings -800,000
--   corrected: 'job_provider_earnings_corrected' provider -850,000 / platform.provider_earnings +850,000
-- After: provider +150,000 (was +200,000, down by exactly the 50,000 difference in share),
-- platform.provider_earnings +850,000 (was +800,000), platform.revenue +200,000 (unchanged),
-- platform.clearing -1,200,000 (unchanged). The five balances sum to zero.
-- The NEXT computed run (period T) covers the two new provider legs:
--   entry_count 2, cash_collected 0, income +50,000, commission -50,000, penalty 0,
--   net -50,000, carried_forward_count 0, unsettled_before_period_count 0.
-- Note on signs: the reversal row is +800,000 and the corrected row is -850,000, so the
-- job_provider_earnings family sums to -50,000 and income_toman = -(family sum) = +50,000.
-- commission_toman = cash - income = -50,000 and net_toman = -50,000. The closed run P is
-- byte-identical.
-- WHY platform.revenue STAYS AT +200,000: A DECISION, NOT A GAP. The correction moves the
-- provider's own settled line and its counter-leg on platform.provider_earnings. A correction
-- that lowers the commission raises the provider's own share, which lowers the provider's
-- debt by exactly the difference, and that debt is what the ceiling and the next settlement
-- read. A reversal plus a re-post always nets to the provider and to the exact opposite on
-- the one account its counter-leg sits on, so the two movements are forced equal and
-- opposite: the PLATFORM's own position moves by exactly the commission difference, recorded
-- where the corrected line lives. platform.revenue keeps the 200,000 actually collected on
-- that job, which is the honest figure under the no-restatement cutover rule, and the run's
-- commission_toman for T (-50,000) is the correction's commission.
--
-- THE CLOCK. The correction's two transfers are stamped by now(), so they are always
-- dated T, today by the ledger's own UTC clock. Nothing may backdate a financial row.
-- This is the same clock rule as the F3a compute, for the same reason. The compute
-- takes its period from the caller, and the caller's period is the one the rows land in.
--
-- THE PENALTY CASE, asserted in the test too. A settled 50,000 'cancel_penalty' corrected
-- to 30,000 gives: reversal provider +50,000 / platform.penalties -50,000, and correction
-- provider -30,000 / platform.penalties +30,000. The provider's balance rises by 20,000.
-- The next run's penalty_toman is -20,000 (= -(50,000 - 30,000)) and net_toman is +20,000.
-- These are the honest arithmetic of F2a's existing reversal convention (a reversal
-- reduces the penalty family). No different sign rule is invented here.
--
-- BOTH NEW ROWS GO THROUGH public.post_ledger_transfer. F1's central helper stays the
-- only writer. The reversal-fidelity trigger, the zero-sum rule and the duplicate
-- guard all keep working, and the acting admin is the actor_profile_id of both rows.
--
-- ROW SHAPE. The reversal row has reverses_entry_id set and settled_in_run_id NULL. The
-- corrected row has reverses_entry_id NULL and settled_in_run_id NULL. The ORIGINAL row
-- is NEVER updated. F1's append-only and settled-once triggers already forbid it. This
-- step adds a loud comment here, not a weakening of those triggers.
--
-- ONCE ONLY. Reversing the same entry twice is refused by F1's unique index
-- ledger_entries_reversal_unique, through post_ledger_transfer, as 'duplicate_ledger_post'.
-- The function does NOT pre-check for an earlier reversal. The index is the one
-- enforcement, as the owner required. Reversing a reversal is refused by F1's trigger
-- ('reversal_of_reversal'). Correcting an entry that is NOT settled is refused here on
-- purpose: the pre-settlement path already exists in F2a.
--
-- THE NEXT-RUN MECHANISM (section B). The compute's entry predicate changes from
-- "dated this period" to "dated this period OR EARLIER, and still unsettled". That one
-- predicate carries (a) the reversal, (b) the correction and (c) a late entry for an
-- already-closed period into the next computed run. Honest boundaries:
--   * for a period that already has a non-draft run, the answer is still
--     'run_already_closed' and nothing is written;
--   * computing an EARLIER period than an already-closed one is not a supported
--     sequence. The closed run is never touched and its entries stay where they are.
-- A new pair of keys is returned on every compute path: carried_forward_count (lines in
-- the run whose entry is dated before the run's period) and unsettled_before_period_count
-- (unsettled entries still dated before the period). F4's screen can then surface a
-- period that carries older money instead of hiding it (TD-043's display half).
-- The serializer private.settlement_run_json is NOT edited. The keys are added around its
-- result.
--
-- WHAT IS DELIBERATELY NOT HERE: no UI and no F4 screen; no manual charge or withdraw
-- entry (TD-042 is F4's); no scheduler, no cron; no change to the ceiling, the
-- suspension, the documents or any accept path; no edit of admin_approve_settlement_run,
-- admin_mark_settlement_run_paid, private.settlement_run_json, post_ledger_transfer or
-- private.reverse_ledger_transfer. Marking a run paid still moves no money (TD-042).
-- TD-047 is still open: the compute derives commission_toman = cash_collected_toman -
-- income_toman, and this step does not change that.
--
-- No table, column, index, trigger or seed row is added. No RLS change. No UPDATE or
-- DELETE of any ledger row. No float: every amount is bigint toman.

-- === A. public.admin_correct_settled_entry =====================================
-- Refusal codes raised here: forbidden, invalid_reason, entry_not_found,
-- entry_not_settled, not_a_provider_entry, settlement_run_not_found,
-- original_transfer_not_pairable, invalid_amount, no_change. A duplicate reversal
-- surfaces from post_ledger_transfer as duplicate_ledger_post.
create function public.admin_correct_settled_entry(
  p_entry_id uuid, p_reason text, p_new_provider_amount bigint default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_original public.ledger_entries%rowtype;
  v_account public.ledger_accounts%rowtype;
  v_reason text;
  v_other_count integer;
  v_other_account_id uuid;
  v_other_amount bigint;
  v_rate_snapshot jsonb;
  v_reversal_transfer_id uuid;
  v_reversal_entry_id uuid;
  v_corrected_transfer_id uuid;
  v_corrected_entry_id uuid;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'forbidden'; end if;

  -- The reason is validated FIRST. Its limit (500 characters) is deliberately NOT the
  -- ledger's own reason limit (64 per row). The admin's reason lives in the audit row
  -- and the run's provenance, which outlive a ledger row's short label.
  if p_reason is null or btrim(p_reason) = '' or char_length(btrim(p_reason)) > 500 then
    raise exception 'invalid_reason';
  end if;
  v_reason := btrim(p_reason);

  select * into v_original from public.ledger_entries where id = p_entry_id;
  if not found then raise exception 'entry_not_found'; end if;

  -- Only a SETTLED entry is corrected here. An unsettled entry is the pre-settlement path (F2a).
  if v_original.settled_in_run_id is null then raise exception 'entry_not_settled'; end if;

  select * into v_account from public.ledger_accounts where id = v_original.account_id;
  if not found or v_account.kind <> 'profile' then raise exception 'not_a_provider_entry'; end if;

  -- No status restriction. An entry is settled whether its run is approved or paid,
  -- and a correction is legal in both states.
  if not exists (select 1 from public.settlement_runs r where r.id = v_original.settled_in_run_id) then
    raise exception 'settlement_run_not_found';
  end if;

  -- The counter-leg's account is the ONE account that the original transfer's other legs
  -- sit on. Every transfer is zero-sum, so v_other_amount = -v_original.signed_amount,
  -- and the reversal's counter-leg (-v_other_amount) equals v_original.signed_amount.
  -- Zero other accounts, or more than one, is refused rather than guessed.
  select count(distinct e.account_id)::int into v_other_count
    from public.ledger_entries e
   where e.transfer_id = v_original.transfer_id and e.account_id <> v_original.account_id;
  if v_other_count <> 1 then raise exception 'original_transfer_not_pairable'; end if;
  select e.account_id, sum(e.signed_amount)::bigint into v_other_account_id, v_other_amount
    from public.ledger_entries e
   where e.transfer_id = v_original.transfer_id and e.account_id <> v_original.account_id
   group by e.account_id;

  -- Every refusal of the correction is raised BEFORE any row is written.
  if p_new_provider_amount is not null then
    if p_new_provider_amount = 0 then raise exception 'invalid_amount'; end if;
    if p_new_provider_amount = v_original.signed_amount then raise exception 'no_change'; end if;
    -- The corrected row's counter-leg needs a platform account to sit on. A profile
    -- account there would move a second person's balance, which this function never does.
    if not exists (select 1 from public.ledger_accounts a
                    where a.id = v_other_account_id and a.kind = 'platform') then
      raise exception 'original_transfer_not_pairable';
    end if;
  end if;

  v_rate_snapshot := coalesce(v_original.rate_snapshot, '{}'::jsonb) || jsonb_build_object(
    'correction', true, 'corrects_entry_id', v_original.id, 'original_reason', v_original.reason);

  -- THE REVERSAL, through the central helper, the only writer. No pre-check of whether
  -- this entry was already reversed: F1's unique index ledger_entries_reversal_unique
  -- is the enforcement, and a second attempt is refused by post_ledger_transfer as
  -- duplicate_ledger_post. (F2a's pre-settlement helper checks for an earlier reversal
  -- first. This function deliberately does not, so the index stays the only enforcement.)
  v_reversal_transfer_id := public.post_ledger_transfer(
    v_original.source_type, v_original.source_id, v_original.reason || '_reversed',
    jsonb_build_array(
      jsonb_build_object('account_id', v_original.account_id, 'signed_amount', -v_original.signed_amount,
                         'reverses_entry_id', v_original.id),
      jsonb_build_object('account_id', v_other_account_id, 'signed_amount', -v_other_amount)),
    v_rate_snapshot);
  select r.id into v_reversal_entry_id from public.ledger_entries r
   where r.transfer_id = v_reversal_transfer_id and r.reverses_entry_id = v_original.id;

  -- THE CORRECTION, only when a new provider amount is given. A NEW row with a NEW
  -- transfer and no reverses_entry_id. Its reason cannot collide with the original's
  -- anti-duplicate key, which is what keeps F1's anti-duplicate index from firing.
  if p_new_provider_amount is not null then
    v_corrected_transfer_id := public.post_ledger_transfer(
      v_original.source_type, v_original.source_id, v_original.reason || '_corrected',
      jsonb_build_array(
        jsonb_build_object('account_id', v_original.account_id, 'signed_amount', p_new_provider_amount),
        jsonb_build_object('account_id', v_other_account_id, 'signed_amount', -p_new_provider_amount)),
      v_rate_snapshot);
    select c.id into v_corrected_entry_id from public.ledger_entries c
     where c.transfer_id = v_corrected_transfer_id and c.account_id = v_original.account_id;
  end if;

  -- The audit row, in the same transaction. private.log_admin_action is the only entry point.
  perform private.log_admin_action('correct_settled_entry', 'ledger_entries', p_entry_id::text, v_reason,
    jsonb_build_object('provider_id', v_account.profile_id, 'settled_in_run_id', v_original.settled_in_run_id,
      'original_reason', v_original.reason, 'original_amount', v_original.signed_amount,
      'reversal_entry_id', v_reversal_entry_id, 'corrected_entry_id', v_corrected_entry_id,
      'corrected_amount', p_new_provider_amount));

  -- difference is the signed change to the PROVIDER's own line: new minus original.
  -- In the 20% to 15% example it is -850,000 - (-800,000) = -50,000.
  return jsonb_build_object(
    'entry_id', v_original.id,
    'account_id', v_original.account_id,
    'provider_id', v_account.profile_id,
    'original_reason', v_original.reason,
    'original_amount', v_original.signed_amount,
    'settled_in_run_id', v_original.settled_in_run_id,
    'reversal_entry_id', v_reversal_entry_id,
    'reversal_amount', -v_original.signed_amount,
    'reversal_transfer_id', v_reversal_transfer_id,
    'correction_requested', p_new_provider_amount is not null,
    'corrected_entry_id', v_corrected_entry_id,
    'corrected_amount', p_new_provider_amount,
    'corrected_transfer_id', v_corrected_transfer_id,
    'difference', case when p_new_provider_amount is null then null
                       else p_new_provider_amount - v_original.signed_amount end,
    'reason', v_reason);
end $$;
revoke all on function public.admin_correct_settled_entry(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.admin_correct_settled_entry(uuid, text, bigint) to authenticated;

-- === B. The compute picks up what is still unsettled ===========================
-- The body is the F2c body (202611080000_ledger_commission_row.sql lines 322-426) with
-- exactly one predicate changed, plus the carried-forward keys. Nothing else moves.
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
  v_carried integer := 0;
  v_unsettled_before integer := 0;
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
    return private.settlement_run_json(v_run, 'run_already_closed', false, false, v_schedule_source, v_settle_at)
      || jsonb_build_object(
           'carried_forward_count', (select count(*)::int from public.settlement_lines l
                                      where l.run_id = v_run.id
                                        and (l.entry_created_at at time zone 'utc')::date < v_period),
           'unsettled_before_period_count', (select count(*)::int from public.ledger_entries e
                                      where e.account_id = v_account_id and e.settled_in_run_id is null
                                        and (e.created_at at time zone 'utc')::date < v_period));
  end if;

  -- The entries this compute covers: the provider's own, unsettled, dated this period
  -- OR EARLIER. A row that is still unsettled when a later period is computed is carried
  -- into that period: a late entry for a closed period, a reversal, or a correction (F3b)
  -- waits for the next computed run instead of waiting forever.
  -- Rows already marked settled are excluded by the predicate: never re-claimed, never un-marked.
  select array_agg(e.id order by e.created_at, e.id) into v_new_ids
    from public.ledger_entries e
   where e.account_id = v_account_id
     and e.settled_in_run_id is null
     and (e.created_at at time zone 'utc')::date <= v_period;

  if v_new_ids is null then
    if v_run_exists then
      -- Nothing unsettled is dated up to this period, so nothing is carried into it.
      return private.settlement_run_json(v_run, 'nothing_new', false, false, v_schedule_source, v_settle_at)
        || jsonb_build_object(
             'carried_forward_count', (select count(*)::int from public.settlement_lines l
                                        where l.run_id = v_run.id
                                          and (l.entry_created_at at time zone 'utc')::date < v_period),
             'unsettled_before_period_count', 0);
    end if;
    return private.settlement_run_json(null::public.settlement_runs, 'nothing_to_settle', false, false, v_schedule_source, v_settle_at)
      || jsonb_build_object('carried_forward_count', 0, 'unsettled_before_period_count', 0);
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

  -- Lines of THIS run whose entry is dated before this period: the money carried in.
  select count(*)::int into v_carried from public.settlement_lines l
   where l.run_id = v_run.id and (l.entry_created_at at time zone 'utc')::date < v_period;

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

  -- Unsettled entries still dated before this period, counted AFTER this run claimed its own.
  select count(*)::int into v_unsettled_before from public.ledger_entries e
   where e.account_id = v_account_id and e.settled_in_run_id is null
     and (e.created_at at time zone 'utc')::date < v_period;

  return private.settlement_run_json(v_run, 'computed', v_created, v_run_exists, v_schedule_source, v_settle_at)
    || jsonb_build_object('carried_forward_count', v_carried,
                          'unsettled_before_period_count', v_unsettled_before);
end $$;
revoke all on function public.admin_compute_settlement_run(uuid, date) from public, anon, authenticated;
grant execute on function public.admin_compute_settlement_run(uuid, date) to authenticated;

commit;
