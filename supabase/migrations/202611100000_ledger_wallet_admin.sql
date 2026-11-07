begin;

-- WU-FINANCE-F4: the wallet, the settlement screen's writers, the finance settings RPCs
-- and the financial reports. osaa/specs/finance.md sections 1, 6, 7 and 10, and TD-042,
-- TD-045, TD-046, TD-047, TD-048 and TD-049.
--
-- NEW RPCs ONLY, PLUS ONE SEEDED ROW. No table, no column, no index, no trigger, no RLS
-- change, no change to any existing function. Nothing here writes a ledger row except
-- admin_manual_wallet_entry, which is the one write this step adds (section 10).
--
-- DECISIONS (recorded here, not hidden in code):
--
--   D1. THE CEILING BASIS IS THE WHOLE BALANCE. private.ceiling_decision (202611060000,
--       step 5) sums EVERY entry of the account, not only job_cash_collected rows. The
--       wallet's warning and stop figures are computed on that same balance, so the banner
--       and the gate can never disagree. collected_cash_debt_toman is still reported, as its
--       own number, and it is NOT used for the threshold comparison. The brief named the
--       collected figure as the basis; the live predicate does not use it, and this step
--       does not change the predicate.
--
--   D2. SUPER-ADMIN IS private.is_admin(). That is the one gate every finance RPC already
--       uses (202611040000 onward). This step adds no permission key.
--
--   D3. THE PLATFORM ACCOUNT IS SEEDED. platform.manual_adjustments is the counter-leg of every
--       manual charge and withdraw (section A1). It is a DATA row, exactly like the two
--       platform rows F2c seeded.
--
--   D4. A MANUAL ENTRY IS ONE BALANCED TRANSFER. admin_manual_wallet_entry posts through
--       public.post_ledger_transfer and nothing else. The helper generates its own transfer
--       id, so the ledger's transfer_id is the id the helper returns. source_id is a separate
--       uuid generated here, so the anti-duplicate index (source_type, source_id, reason,
--       account_id) never fires for two manual entries. The brief's "source_id = the transfer's
--       own uuid" cannot hold literally, because the helper mints its transfer id itself.
--
--   D5. A MANUAL ENTRY IS FOR A PROFILE ACCOUNT ONLY. Charging or withdrawing a platform account
--       would move platform money with no person behind it. That case raises
--       'not_a_profile_account', a code this step adds. The brief did not name it.
--
--   D6. THE SETTLEMENT-PERIOD SPLIT IS DROPPED. The brief asked for lines_settled and
--       lines_unsettled per run, split by "entry settled_in_run_id differs from this run". The
--       compute sets settled_in_run_id to THIS run for every line, and F1's trigger makes that
--       value set-once. So for any line of a run the split is always (all, none). It is not
--       derivable as a meaningful number, so neither key is emitted. lines_total is emitted.
--
--   D7. "CLOSED RUN WITH UNSETTLED ENTRIES" IS DEFINED AS A NON-DRAFT RUN THAT STILL HAS AN
--       UNSETTLED ENTRY OF THE SAME ACCOUNT DATED ON OR BEFORE ITS PERIOD. A run's own lines
--       are always settled to it, so "entries no longer all settled" can only mean late money
--       for a closed period, which F3b's compute then carries (TD-043).
--
--   D8. A PERIOD LIST IS CAPPED AT 60 RUNS PER ACCOUNT. The wallet list shows the newest 60
--       periods. The cap bounds the request path. The unbounded list is one call away if the
--       owner wants it.
--
--   D9. A DATE RANGE OVER 366 DAYS IS REFUSED, NOT SILENTLY SHORTENED. The brief says both
--       "clamped" and "raises 'date_range_too_wide'". This step raises, because a clamp the
--       operator cannot see would print a total that looks complete and is not. The span is
--       inclusive, so 366 days is allowed and 367 is refused.
--
--   D10. PROVIDER_DEBT IS A SNAPSHOT. It reads every cash-holding account's current figures,
--       so its date range is validated (mandatory, as the brief requires) but not applied to
--       the figures. Its source says so.
--
--   D11. THE UNSETTLED FILTER (p_only_unsettled, default false). It keeps PROFILE accounts with
--       at least one unsettled entry, the same set the settlement screen shows. Platform entries
--       are never settled, so the profile test is what keeps platform accounts out. The count and
--       the page share one filter, so the total is the number of accounts the filter returns.
--
--   D12. THE WALLET ORDER. Accounts at or over their warning line come first, then the unsettled
--       amount descending, then created_at and id. The order is computed per account, so an
--       unfiltered list reads one figures set per account.
--
--   D13. A DRAFT RUN IS COUNTED, NOT SUMMED, IN THE SETTLEMENT REPORT. A draft is recomputed from
--       the ledger on every press, so its net is not a settled figure. The total reports
--       draft_run_count and no draft net sum.
--
--   D14. F4 READS THE CEILING TABLE AT RUNTIME ONLY. No object here may hold a compile-time catalog
--       dependency on an earlier step's objects (public.ledger_debt_ceilings, private.ledger_debt_ceiling_for,
--       private.ceiling_decision, public.can_accept_work). PL/pgSQL resolves %rowtype when a function is
--       created, so the ceiling holders are plain scalars with an explicit found flag, and the table is
--       read only inside statements.
--       Each step's rollback test builds the schema WITHOUT that step, so no step may need an earlier
--       step's objects to exist in order to be created.
--
-- THE SETTLEMENT-SCHEDULE GRANT (A5). settlement_schedules has NO insert, update or delete
-- grant to authenticated. F3a (202611070000, section A) revoked all and granted select only.
-- So there is nothing to revoke, and this migration changes nothing on that table.
--
-- ORDER OF CHECKS in every writer: forbidden first, then argument validation in the order
-- written in each function, then the existence checks, then the write, then the audit row
-- in the same transaction. Every refusal is raised before any row is written.

-- === A1. The counter-leg of every manual charge and withdraw ====================
insert into public.ledger_accounts (kind, code) values
  ('platform', 'platform.manual_adjustments')
on conflict do nothing;

-- === A0. Private helpers (not client-callable) ================================
-- The figures of ONE account, read-only. No lock, no write, no settlement run is created or
-- computed here. Every wallet and report figure about an account comes from this function.
create function private.wallet_account_figures(p_account_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_account public.ledger_accounts%rowtype;
  v_profile_name text;
  v_role text;
  v_ceiling_found boolean := false;
  v_ceiling_toman bigint;
  v_warn_percent numeric;
  v_stop_percent numeric;
  v_ceiling_active boolean;
  v_has_ceiling boolean := false;
  v_balance bigint := 0;
  v_collected bigint := 0;
  v_unsettled bigint := 0;
  v_unsettled_count integer := 0;
  v_settled_count integer := 0;
  v_unsettled_periods integer := 0;
  v_closed_with_unsettled integer := 0;
  v_pending_corrections integer := 0;
  v_warn_threshold bigint := null;
  v_stop_threshold bigint := null;
  v_at_warn boolean := false;
  v_at_stop boolean := false;
begin
  select * into v_account from public.ledger_accounts where id = p_account_id;
  if not found then raise exception 'account_not_found'; end if;

  if v_account.profile_id is not null then
    select p.name, p.user_type into v_profile_name, v_role
      from public.profiles p where p.id = v_account.profile_id;
  end if;

  -- The ceiling scope is the same one private.ceiling_decision uses: a profile of a
  -- cash-holding role, with its own active row (or the '*' default when it has none).
  -- The role's own row, whatever its is_active; the '*' default row only when the role has NO row.
  -- Same answer as private.ledger_debt_ceiling_for (202611060000), read here as scalars so that no
  -- record field is ever read on a path where nothing was assigned.
  if v_account.kind = 'profile' and v_role in ('rescuer', 'service') then
    select c.ceiling_toman, c.warn_at_percent, c.stop_at_percent, c.is_active
      into v_ceiling_toman, v_warn_percent, v_stop_percent, v_ceiling_active
      from public.ledger_debt_ceilings c
     where c.role = v_role;
    if not found then
      select c.ceiling_toman, c.warn_at_percent, c.stop_at_percent, c.is_active
        into v_ceiling_toman, v_warn_percent, v_stop_percent, v_ceiling_active
        from public.ledger_debt_ceilings c
       where c.role = '*';
    end if;
    v_ceiling_found := found and coalesce(v_ceiling_active, false);
  end if;
  v_has_ceiling := v_ceiling_found;

  select coalesce(sum(e.signed_amount), 0)::bigint,
         coalesce(sum(case when starts_with(e.reason, 'job_cash_collected') then e.signed_amount else 0 end), 0)::bigint,
         coalesce(sum(case when e.settled_in_run_id is null then e.signed_amount else 0 end), 0)::bigint,
         (count(*) filter (where e.settled_in_run_id is null))::int,
         (count(*) filter (where e.settled_in_run_id is not null))::int
    into v_balance, v_collected, v_unsettled, v_unsettled_count, v_settled_count
    from public.ledger_entries e
   where e.account_id = p_account_id;

  if v_account.kind = 'profile' then
    select (count(distinct (e.created_at at time zone 'utc')::date))::int into v_unsettled_periods
      from public.ledger_entries e
     where e.account_id = p_account_id and e.settled_in_run_id is null;

    select (count(*))::int into v_closed_with_unsettled
      from public.settlement_runs r
     where r.account_id = p_account_id
       and r.status <> 'draft'
       and exists (
         select 1 from public.ledger_entries e
          where e.account_id = p_account_id
            and e.settled_in_run_id is null
            and (e.created_at at time zone 'utc')::date <= r.period);

    select (count(*))::int into v_pending_corrections
      from public.ledger_entries e
     where e.account_id = p_account_id
       and e.settled_in_run_id is null
       and (e.reverses_entry_id is not null or right(e.reason, 10) = '_corrected');
  end if;

  -- The thresholds, with the predicate's own exact arithmetic: debt * 100 >= ceiling * percent,
  -- no division, no float. 40% warns and 39.99% does not; 95% stops and 94.99% does not.
  -- The stop threshold uses the same rounding as private.ceiling_decision (step 6).
  if v_has_ceiling then
    v_warn_threshold := round(v_ceiling_toman * v_warn_percent / 100)::bigint;
    v_stop_threshold := round(v_ceiling_toman * v_stop_percent / 100)::bigint;
    v_at_warn := v_balance * 100 >= v_ceiling_toman * v_warn_percent;
    v_at_stop := v_balance * 100 >= v_ceiling_toman * v_stop_percent;
  end if;

  return jsonb_build_object(
    'account_id', v_account.id,
    'kind', v_account.kind,
    'profile_id', v_account.profile_id,
    'code', v_account.code,
    'display_name', coalesce(v_profile_name, v_account.code),
    'user_type', v_role,
    'is_active', v_account.is_active,
    'balance_toman', v_balance,
    'collected_cash_debt_toman', v_collected,
    'unsettled_debt_toman', case when v_account.kind = 'profile' then v_unsettled else null end,
    'unsettled_entry_count', case when v_account.kind = 'profile' then v_unsettled_count else null end,
    'settled_entry_count', case when v_account.kind = 'profile' then v_settled_count else null end,
    'unsettled_periods_count', case when v_account.kind = 'profile' then v_unsettled_periods else null end,
    'closed_runs_with_unsettled_entries', case when v_account.kind = 'profile' then v_closed_with_unsettled else null end,
    'pending_corrections_count', case when v_account.kind = 'profile' then v_pending_corrections else null end,
    'ceiling_basis', case when v_has_ceiling then 'balance_toman' else null end,
    'ceiling_toman', case when v_has_ceiling then v_ceiling_toman else null end,
    'warn_at_percent', case when v_has_ceiling then v_warn_percent else null end,
    'stop_at_percent', case when v_has_ceiling then v_stop_percent else null end,
    'warn_threshold_toman', v_warn_threshold,
    'stop_threshold_toman', v_stop_threshold,
    'at_warn', v_at_warn,
    'at_stop', v_at_stop);
end $$;
revoke all on function private.wallet_account_figures(uuid) from public, anon, authenticated;

-- The figures above, plus the account's settlement periods, newest first, capped (D8).
create function private.wallet_account_summary(p_account_id uuid, p_period_limit integer default 60)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_figures jsonb;
  v_periods jsonb;
begin
  v_figures := private.wallet_account_figures(p_account_id);

  select coalesce(jsonb_agg(x.j order by x.period desc, x.run_created desc), '[]'::jsonb) into v_periods
    from (
      select r.period, r.created_at as run_created, jsonb_build_object(
        'run_id', r.id,
        'period', to_char(r.period, 'YYYY-MM-DD'),
        'status', r.status,
        'entry_count', r.entry_count,
        'cash_collected_toman', r.cash_collected_toman,
        'income_toman', r.income_toman,
        'commission_toman', r.commission_toman,
        'penalty_toman', r.penalty_toman,
        'net_toman', r.net_toman,
        'computed_at', to_char(r.computed_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'approved_at', to_char(r.approved_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'paid_at', to_char(r.paid_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'payment_reference', r.payment_reference,
        'carried_forward_count', (select count(*)::int from public.settlement_lines l
                                   where l.run_id = r.id and (l.entry_created_at at time zone 'utc')::date < r.period),
        'lines_total', (select count(*)::int from public.settlement_lines l where l.run_id = r.id),
        'unsettled_entries_before_period', (select count(*)::int from public.ledger_entries e
                                   where e.account_id = p_account_id and e.settled_in_run_id is null
                                     and (e.created_at at time zone 'utc')::date < r.period)
      ) as j
        from public.settlement_runs r
       where r.account_id = p_account_id
       order by r.period desc, r.created_at desc
       limit greatest(coalesce(p_period_limit, 60), 0)
    ) x;

  return v_figures || jsonb_build_object('settlement_periods', v_periods);
end $$;
revoke all on function private.wallet_account_summary(uuid, integer) from public, anon, authenticated;

-- === A2. public.admin_wallet_accounts =========================================
-- READ ONLY. No lock, no write, no settlement run is created or computed.
create function public.admin_wallet_accounts(p_search text default null, p_limit integer default 50, p_offset integer default 0, p_only_unsettled boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_items jsonb := '[]'::jsonb;
  v_account_id uuid;
  v_only_unsettled boolean := coalesce(p_only_unsettled, false);
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'forbidden'; end if;

  -- One filter for the count and the page (D11), so the total is the filtered set's size.
  select count(*)::int into v_total
    from public.ledger_accounts a
    left join public.profiles p on p.id = a.profile_id
   where (v_search is null
      or strpos(lower(coalesce(p.name, '')), lower(v_search)) > 0
      or strpos(lower(coalesce(a.code, '')), lower(v_search)) > 0)
     and (not v_only_unsettled or (a.kind = 'profile' and exists (
           select 1 from public.ledger_entries e where e.account_id = a.id and e.settled_in_run_id is null)));

  -- The order (D12): at or over the warning line first, then the unsettled amount descending,
  -- then created_at and id. The figures are read per account so the sort can use them.
  for v_account_id in
    select s.id
      from (
        select a.id, a.created_at,
               (fig.f->>'at_warn')::boolean or (fig.f->>'at_stop')::boolean as attention,
               coalesce((fig.f->>'unsettled_debt_toman')::bigint, 0) as owed
          from public.ledger_accounts a
          left join public.profiles p on p.id = a.profile_id
          cross join lateral (select private.wallet_account_figures(a.id) as f) fig
         where (v_search is null
            or strpos(lower(coalesce(p.name, '')), lower(v_search)) > 0
            or strpos(lower(coalesce(a.code, '')), lower(v_search)) > 0)
           and (not v_only_unsettled or (a.kind = 'profile' and exists (
                 select 1 from public.ledger_entries e where e.account_id = a.id and e.settled_in_run_id is null)))
      ) s
     order by s.attention desc, s.owed desc, s.created_at, s.id
     limit v_limit offset v_offset
  loop
    v_items := v_items || jsonb_build_array(private.wallet_account_summary(v_account_id));
  end loop;

  return jsonb_build_object(
    'generated_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'items', v_items);
end $$;
revoke all on function public.admin_wallet_accounts(text, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.admin_wallet_accounts(text, integer, integer, boolean) to authenticated;

-- === A3. public.admin_wallet_statement ========================================
-- READ ONLY. A mandatory date range: the entries whose UTC date falls inside it, inclusive.
create function public.admin_wallet_statement(p_account_id uuid, p_from date, p_to date, p_limit integer default 100, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_start timestamptz;
  v_end timestamptz;
  v_account jsonb;
  v_total integer;
  v_items jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'forbidden'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'invalid_date_range'; end if;
  if p_to - p_from > 365 then raise exception 'date_range_too_wide'; end if;

  v_start := p_from::timestamp at time zone 'utc';
  v_end := (p_to + 1)::timestamp at time zone 'utc';

  -- Raises account_not_found for an unknown account.
  v_account := private.wallet_account_figures(p_account_id);

  select count(*)::int into v_total
    from public.ledger_entries e
   where e.account_id = p_account_id and e.created_at >= v_start and e.created_at < v_end;

  select coalesce(jsonb_agg(i.j order by i.created_at, i.entry_id), '[]'::jsonb) into v_items
    from (
      select e.created_at, e.id as entry_id, jsonb_build_object(
        'entry_id', e.id,
        'created_at', to_char(e.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'reason', e.reason,
        'signed_amount', e.signed_amount,
        'source_type', e.source_type,
        'source_id', e.source_id,
        'transfer_id', e.transfer_id,
        'settled_in_run_id', e.settled_in_run_id,
        'settlement_period', to_char(r.period, 'YYYY-MM-DD'),
        'settlement_status', case when e.settled_in_run_id is null then 'unsettled' else r.status end,
        'settlement_reference', r.payment_reference,
        'reverses_entry_id', e.reverses_entry_id,
        'actor_name', ap.name) as j
        from public.ledger_entries e
        left join public.settlement_runs r on r.id = e.settled_in_run_id
        left join public.profiles ap on ap.id = e.actor_profile_id
       where e.account_id = p_account_id and e.created_at >= v_start and e.created_at < v_end
       order by e.created_at, e.id
       limit v_limit offset v_offset
    ) i;

  return jsonb_build_object(
    'account', v_account,
    'from', to_char(p_from, 'YYYY-MM-DD'),
    'to', to_char(p_to, 'YYYY-MM-DD'),
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'items', v_items);
end $$;
revoke all on function public.admin_wallet_statement(uuid, date, date, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_wallet_statement(uuid, date, date, integer, integer) to authenticated;

-- === A4. public.admin_manual_wallet_entry =====================================
-- THE ONE WRITE OF THIS STEP. One balanced transfer through the central helper, and one audit
-- row in the same transaction. A charge raises the account's balance (money the person owes);
-- a withdraw lowers it. This entry is what clears a paid settlement's debt (TD-042).
create function public.admin_manual_wallet_entry(p_account_id uuid, p_direction text, p_amount_toman bigint, p_reason text, p_tracking_reference text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_tracking text := btrim(coalesce(p_tracking_reference, ''));
  v_kind public.ledger_accounts%rowtype;
  v_manual_account_id uuid;
  v_source_id uuid := gen_random_uuid();
  v_signed bigint;
  v_reason_code text;
  v_balance_before bigint;
  v_balance_after bigint;
  v_legs jsonb;
  v_snapshot jsonb;
  v_transfer_id uuid;
  v_entry_ids jsonb;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'forbidden'; end if;
  if p_direction is null or p_direction not in ('charge', 'withdraw') then raise exception 'invalid_direction'; end if;
  if p_amount_toman is null or p_amount_toman <= 0 then raise exception 'invalid_amount'; end if;
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then raise exception 'invalid_reason'; end if;
  if char_length(v_tracking) < 1 or char_length(v_tracking) > 200 then raise exception 'invalid_tracking_reference'; end if;

  select * into v_kind from public.ledger_accounts where id = p_account_id;
  if not found then raise exception 'account_not_found'; end if;
  if v_kind.kind <> 'profile' then raise exception 'not_a_profile_account'; end if;

  select a.id into v_manual_account_id from public.ledger_accounts a where a.code = 'platform.manual_adjustments';
  if v_manual_account_id is null then raise exception 'platform_account_missing'; end if;

  v_signed := case when p_direction = 'charge' then p_amount_toman else -p_amount_toman end;
  v_reason_code := case when p_direction = 'charge' then 'admin_charge' else 'admin_withdraw' end;

  select coalesce(sum(e.signed_amount), 0)::bigint into v_balance_before
    from public.ledger_entries e where e.account_id = p_account_id;

  v_legs := jsonb_build_array(
    jsonb_build_object('account_id', p_account_id, 'signed_amount', v_signed),
    jsonb_build_object('account_id', v_manual_account_id, 'signed_amount', -v_signed));
  v_snapshot := jsonb_build_object(
    'tracking_reference', v_tracking,
    'direction', p_direction,
    'reason', v_reason,
    'source', 'admin_manual_wallet_entry');

  v_transfer_id := public.post_ledger_transfer('manual', v_source_id, v_reason_code, v_legs, v_snapshot);

  select coalesce(sum(e.signed_amount), 0)::bigint into v_balance_after
    from public.ledger_entries e where e.account_id = p_account_id;

  select coalesce(jsonb_agg(e.id order by e.id), '[]'::jsonb) into v_entry_ids
    from public.ledger_entries e where e.transfer_id = v_transfer_id;

  perform private.log_admin_action(
    case when p_direction = 'charge' then 'manual_wallet_charge' else 'manual_wallet_withdraw' end,
    'ledger_accounts', p_account_id::text, v_reason,
    jsonb_build_object(
      'previous', v_balance_before,
      'new', v_balance_after,
      'tracking_reference', v_tracking,
      'amount_toman', p_amount_toman,
      'transfer_id', v_transfer_id,
      'direction', p_direction));

  return jsonb_build_object(
    'transfer_id', v_transfer_id,
    'account_id', p_account_id,
    'direction', p_direction,
    'amount_toman', p_amount_toman,
    'balance_before_toman', v_balance_before,
    'balance_after_toman', v_balance_after,
    'tracking_reference', v_tracking,
    'entry_ids', v_entry_ids);
end $$;
revoke all on function public.admin_manual_wallet_entry(uuid, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.admin_manual_wallet_entry(uuid, text, bigint, text, text) to authenticated;

-- === A5. public.admin_upsert_settlement_schedule (TD-045) =====================
-- profile_id null edits the DEFAULT row. Only one row can have a null profile_id (the unique
-- index settlement_schedules_default_unique), so 'ambiguous_default_schedule' is defensive.
-- A profile edits its own single override row, and inserts it when none exists.
create function public.admin_upsert_settlement_schedule(p_profile_id uuid, p_settle_at_time time, p_is_active boolean, p_note text, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row public.settlement_schedules%rowtype;
  v_found boolean;
  v_default_count integer;
  v_id uuid;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'forbidden'; end if;
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then raise exception 'invalid_reason'; end if;
  if p_is_active is null then raise exception 'invalid_request'; end if;
  if p_settle_at_time is null then raise exception 'invalid_time'; end if;
  if p_note is not null and char_length(p_note) > 500 then raise exception 'invalid_note'; end if;
  if p_profile_id is not null and not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'invalid_profile';
  end if;

  if p_profile_id is null then
    select count(*)::int into v_default_count from public.settlement_schedules where profile_id is null;
    if v_default_count > 1 then raise exception 'ambiguous_default_schedule'; end if;
    select * into v_row from public.settlement_schedules where profile_id is null for update;
  else
    select * into v_row from public.settlement_schedules where profile_id = p_profile_id for update;
  end if;
  v_found := found;

  if v_found then
    if v_row.settle_at_time = p_settle_at_time and v_row.is_active = p_is_active
       and v_row.note is not distinct from v_note then
      return v_row.id;
    end if;
    update public.settlement_schedules
       set settle_at_time = p_settle_at_time, is_active = p_is_active, note = v_note
     where id = v_row.id;
    v_id := v_row.id;
  else
    if p_profile_id is null then raise exception 'default_schedule_missing'; end if;
    insert into public.settlement_schedules (profile_id, settle_at_time, is_active, note)
      values (p_profile_id, p_settle_at_time, p_is_active, v_note)
      returning id into v_id;
  end if;

  perform private.log_admin_action('upsert_settlement_schedule', 'settlement_schedules', v_id::text, v_reason,
    jsonb_build_object(
      'previous', case when v_found then jsonb_build_object(
                    'profile_id', v_row.profile_id, 'settle_at_time', v_row.settle_at_time::text,
                    'is_active', v_row.is_active, 'note', v_row.note) else null end,
      'new', jsonb_build_object(
                    'profile_id', p_profile_id, 'settle_at_time', p_settle_at_time::text,
                    'is_active', p_is_active, 'note', v_note)));
  return v_id;
end $$;
revoke all on function public.admin_upsert_settlement_schedule(uuid, time, boolean, text, text) from public, anon, authenticated;
grant execute on function public.admin_upsert_settlement_schedule(uuid, time, boolean, text, text) to authenticated;

-- === A6. public.admin_upsert_ledger_debt_ceiling (TD-045) =====================
-- Edits the DATA that private.ceiling_decision reads. It does not touch the decision, the
-- predicate, or any accept path. The '*' row is the default AMOUNT, never a cap on every role.
create function public.admin_upsert_ledger_debt_ceiling(p_role text, p_ceiling_toman bigint, p_warn_at_percent numeric, p_stop_at_percent numeric, p_is_active boolean, p_reason text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_old_ceiling bigint;
  v_old_warn numeric;
  v_old_stop numeric;
  v_old_active boolean;
  v_found boolean;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'forbidden'; end if;
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then raise exception 'invalid_reason'; end if;
  if p_role is null or p_role not in ('rescuer', 'service', '*') then raise exception 'invalid_role'; end if;
  if p_ceiling_toman is null or p_ceiling_toman < 0 then raise exception 'invalid_ceiling'; end if;
  if p_warn_at_percent is null or p_stop_at_percent is null
     or p_warn_at_percent <= 0 or p_warn_at_percent > 100
     or p_stop_at_percent <= 0 or p_stop_at_percent > 100 then
    raise exception 'invalid_percent';
  end if;
  if p_stop_at_percent <= p_warn_at_percent then raise exception 'invalid_percent_order'; end if;
  if p_is_active is null then raise exception 'invalid_request'; end if;

  select ceiling_toman, warn_at_percent, stop_at_percent, is_active
    into v_old_ceiling, v_old_warn, v_old_stop, v_old_active
    from public.ledger_debt_ceilings where role = p_role for update;
  v_found := found;

  if v_found then
    if v_old_ceiling = p_ceiling_toman and v_old_warn = p_warn_at_percent
       and v_old_stop = p_stop_at_percent and v_old_active = p_is_active then
      return p_role;
    end if;
    update public.ledger_debt_ceilings
       set ceiling_toman = p_ceiling_toman, warn_at_percent = p_warn_at_percent,
           stop_at_percent = p_stop_at_percent, is_active = p_is_active, updated_at = now()
     where role = p_role;
  else
    insert into public.ledger_debt_ceilings (role, ceiling_toman, warn_at_percent, stop_at_percent, is_active)
      values (p_role, p_ceiling_toman, p_warn_at_percent, p_stop_at_percent, p_is_active);
  end if;

  perform private.log_admin_action('upsert_ledger_debt_ceiling', 'ledger_debt_ceilings', p_role, v_reason,
    jsonb_build_object(
      'previous', case when v_found then jsonb_build_object(
                    'ceiling_toman', v_old_ceiling, 'warn_at_percent', v_old_warn,
                    'stop_at_percent', v_old_stop, 'is_active', v_old_active) else null end,
      'new', jsonb_build_object(
                    'ceiling_toman', p_ceiling_toman, 'warn_at_percent', p_warn_at_percent,
                    'stop_at_percent', p_stop_at_percent, 'is_active', p_is_active)));
  return p_role;
end $$;
revoke all on function public.admin_upsert_ledger_debt_ceiling(text, bigint, numeric, numeric, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_upsert_ledger_debt_ceiling(text, bigint, numeric, numeric, boolean, text) to authenticated;

-- === A7. public.admin_finance_report (spec section 6) =========================
-- Every kind requires a date range (D9, D10). Every answer carries kind, from, to,
-- granularity, total, rows and a source object naming the tables and columns it read.
create function public.admin_finance_report(p_kind text, p_from date, p_to date, p_granularity text default 'day')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_total jsonb;
  v_total_num bigint := 0;
  v_rows jsonb := '[]'::jsonb;
  v_source jsonb;
  v_acc record;
  v_fig jsonb;
  v_pending_count integer := 0;
  v_pending_sum bigint := 0;
  v_paid bigint := 0;
  v_approved bigint := 0;
  v_draft_runs integer := 0;
  v_debt_collected bigint := 0;
  v_debt_unsettled bigint := 0;
  v_debt_warn integer := 0;
  v_debt_stop integer := 0;
  v_debt_count integer := 0;
  v_breakdown jsonb;
  v_trend_commission bigint := 0;
  v_trend_settled bigint := 0;
  v_trend_pending bigint := 0;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'forbidden'; end if;
  if p_kind is null or p_kind not in ('commission', 'settlement', 'provider_debt', 'penalties', 'breakdown', 'daily_trend') then
    raise exception 'invalid_report_kind';
  end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'invalid_date_range'; end if;
  if p_to - p_from > 365 then raise exception 'date_range_too_wide'; end if;
  if p_granularity is null or p_granularity not in ('day', 'week', 'month') then raise exception 'invalid_granularity'; end if;

  v_start := p_from::timestamp at time zone 'utc';
  v_end := (p_to + 1)::timestamp at time zone 'utc';

  if p_kind = 'commission' then
    -- The commission ACCOUNT itself. Never a subtraction, never the run's derived commission_toman.
    select coalesce(jsonb_agg(jsonb_build_object('bucket', x.bucket, 'label', x.bucket, 'value', x.value, 'entry_count', x.n) order by x.bucket), '[]'::jsonb),
           coalesce(sum(x.value), 0)::bigint
      into v_rows, v_total_num
      from (
        select to_char(date_trunc(p_granularity, e.created_at at time zone 'utc'), 'YYYY-MM-DD') as bucket,
               sum(e.signed_amount)::bigint as value, count(*)::int as n
          from public.ledger_entries e
          join public.ledger_accounts a on a.id = e.account_id and a.code = 'platform.revenue'
         where e.created_at >= v_start and e.created_at < v_end
         group by 1
      ) x;
    v_total := to_jsonb(v_total_num);
    v_source := jsonb_build_object(
      'tables', jsonb_build_array('ledger_entries', 'ledger_accounts'),
      'columns', jsonb_build_array('ledger_entries.signed_amount', 'ledger_entries.created_at', 'ledger_accounts.code'),
      'account', 'platform.revenue',
      'note', 'sums the platform.revenue account itself, bucketed by ledger_entries.created_at');

  elsif p_kind = 'settlement' then
    select coalesce(jsonb_agg(jsonb_build_object('bucket', x.bucket, 'status', x.status, 'runs', x.runs, 'net_toman', x.net)
                              order by x.bucket, x.status), '[]'::jsonb)
      into v_rows
      from (
        select to_char(date_trunc(p_granularity, r.period::timestamp), 'YYYY-MM-DD') as bucket, r.status,
               count(*)::int as runs, coalesce(sum(r.net_toman), 0)::bigint as net
          from public.settlement_runs r
         where r.period >= p_from and r.period <= p_to
         group by 1, 2
      ) x;

    select coalesce(sum(case when r.status = 'paid' then r.net_toman end), 0)::bigint,
           coalesce(sum(case when r.status = 'approved' then r.net_toman end), 0)::bigint,
           (count(*) filter (where r.status = 'draft'))::int
      into v_paid, v_approved, v_draft_runs
      from public.settlement_runs r
     where r.period >= p_from and r.period <= p_to;

    -- Pending: unsettled PROFILE entries inside the range. Platform entries are never settled
    -- (they are not lines), so they are excluded here.
    select count(*)::int, coalesce(sum(e.signed_amount), 0)::bigint
      into v_pending_count, v_pending_sum
      from public.ledger_entries e
      join public.ledger_accounts a on a.id = e.account_id and a.kind = 'profile'
     where e.settled_in_run_id is null and e.created_at >= v_start and e.created_at < v_end;

    v_total := jsonb_build_object(
      'paid_net_toman', v_paid, 'approved_net_toman', v_approved, 'draft_run_count', v_draft_runs,
      'pending_entry_count', v_pending_count, 'pending_entries_toman', v_pending_sum);
    v_source := jsonb_build_object(
      'tables', jsonb_build_array('settlement_runs', 'ledger_entries', 'ledger_accounts'),
      'columns', jsonb_build_array('settlement_runs.status', 'settlement_runs.net_toman', 'settlement_runs.period',
                                   'ledger_entries.signed_amount', 'ledger_entries.settled_in_run_id', 'ledger_entries.created_at'),
      'note', 'runs are bucketed by settlement_runs.period; pending is unsettled profile-account entries by created_at',
      'draft_note', 'the draft net is excluded from this total because a draft run is a recomputable snapshot, not a settled amount. Draft runs are counted in draft_run_count only.');

  elsif p_kind = 'provider_debt' then
    -- A SNAPSHOT (D10). The range is validated but not applied to these figures.
    for v_acc in
      select a.id
        from public.ledger_accounts a
        join public.profiles p on p.id = a.profile_id
       where a.kind = 'profile' and p.user_type in ('rescuer', 'service')
       order by a.created_at, a.id
    loop
      v_fig := private.wallet_account_figures(v_acc.id);
      v_rows := v_rows || jsonb_build_array(v_fig);
      v_debt_count := v_debt_count + 1;
      v_debt_collected := v_debt_collected + (v_fig->>'collected_cash_debt_toman')::bigint;
      v_debt_unsettled := v_debt_unsettled + (v_fig->>'unsettled_debt_toman')::bigint;
      if (v_fig->>'at_warn')::boolean then v_debt_warn := v_debt_warn + 1; end if;
      if (v_fig->>'at_stop')::boolean then v_debt_stop := v_debt_stop + 1; end if;
    end loop;
    v_total := jsonb_build_object(
      'providers', v_debt_count, 'collected_cash_debt_toman', v_debt_collected,
      'unsettled_debt_toman', v_debt_unsettled, 'at_warn_count', v_debt_warn, 'at_stop_count', v_debt_stop);
    v_source := jsonb_build_object(
      'tables', jsonb_build_array('ledger_accounts', 'ledger_entries', 'profiles', 'ledger_debt_ceilings', 'settlement_runs'),
      'columns', jsonb_build_array('ledger_entries.signed_amount', 'ledger_entries.reason', 'ledger_entries.settled_in_run_id',
                                   'profiles.user_type', 'ledger_debt_ceilings.ceiling_toman', 'ledger_debt_ceilings.warn_at_percent',
                                   'ledger_debt_ceilings.stop_at_percent'),
      'snapshot', true,
      'note', 'a SNAPSHOT of the current balances, not bucketed. The date range is validated but does not filter these figures.');

  elsif p_kind = 'penalties' then
    select coalesce(jsonb_agg(jsonb_build_object('reason', x.reason, 'role', x.role, 'value', x.value, 'entry_count', x.n)
                              order by x.reason, x.role), '[]'::jsonb),
           coalesce(sum(x.value), 0)::bigint
      into v_rows, v_total_num
      from (
        select e.reason, coalesce(p.user_type, 'unknown') as role,
               sum(e.signed_amount)::bigint as value, count(*)::int as n
          from public.ledger_entries e
          join public.ledger_accounts a on a.id = e.account_id and a.code = 'platform.penalties'
          left join public.profiles p on p.id = e.actor_profile_id
         where e.created_at >= v_start and e.created_at < v_end
         group by 1, 2
      ) x;
    v_total := to_jsonb(v_total_num);
    v_source := jsonb_build_object(
      'tables', jsonb_build_array('ledger_entries', 'ledger_accounts', 'profiles'),
      'columns', jsonb_build_array('ledger_entries.signed_amount', 'ledger_entries.reason', 'ledger_entries.created_at',
                                   'ledger_entries.actor_profile_id', 'profiles.user_type'),
      'account', 'platform.penalties',
      'note', 'rows are the penalty reason and the role of the actor who posted it');

  elsif p_kind = 'breakdown' then
    with base as (
      select p.user_type as role, p.city as city, coalesce(st.title, e.source_type) as service_type, e.signed_amount
        from public.ledger_entries e
        join public.ledger_accounts a on a.id = e.account_id and a.kind = 'profile'
        join public.profiles p on p.id = a.profile_id
        left join public.onsite_requests r on e.source_type = 'onsite_request' and r.id = e.source_id
        left join public.onsite_service_types st on st.id = r.service_type_id
       where e.created_at >= v_start and e.created_at < v_end
    )
    select jsonb_build_object(
      'by_role', (select coalesce(jsonb_agg(jsonb_build_object('key', g.k, 'value', g.v, 'entry_count', g.n) order by g.k), '[]'::jsonb)
                    from (select coalesce(b.role, 'unknown') as k, sum(b.signed_amount)::bigint as v, count(*)::int as n
                            from base b group by 1) g),
      'by_city', (select coalesce(jsonb_agg(jsonb_build_object('key', g.k, 'value', g.v, 'entry_count', g.n) order by g.k), '[]'::jsonb)
                    from (select coalesce(b.city, 'unknown') as k, sum(b.signed_amount)::bigint as v, count(*)::int as n
                            from base b group by 1) g),
      'by_service_type', (select coalesce(jsonb_agg(jsonb_build_object('key', g.k, 'value', g.v, 'entry_count', g.n) order by g.k), '[]'::jsonb)
                    from (select coalesce(b.service_type, 'unknown') as k, sum(b.signed_amount)::bigint as v, count(*)::int as n
                            from base b group by 1) g)),
           coalesce(sum(b.signed_amount), 0)::bigint
      into v_breakdown, v_total_num
      from base b;
    v_rows := v_breakdown;
    v_total := to_jsonb(v_total_num);
    v_source := jsonb_build_object(
      'tables', jsonb_build_array('ledger_entries', 'ledger_accounts', 'profiles', 'onsite_requests', 'onsite_service_types'),
      'columns', jsonb_build_array('ledger_entries.signed_amount', 'ledger_entries.created_at', 'ledger_entries.source_type',
                                   'ledger_entries.source_id', 'profiles.user_type', 'profiles.city',
                                   'onsite_requests.service_type_id', 'onsite_service_types.title'),
      'note', 'profile accounts only. The city is profiles.city. The service type is the onsite service title, or the source type for other jobs.');

  elsif p_kind = 'daily_trend' then
    with days as (
      select d::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as g(d)
    ),
    c as (
      select (e.created_at at time zone 'utc')::date as day, sum(e.signed_amount)::bigint as v
        from public.ledger_entries e
        join public.ledger_accounts a on a.id = e.account_id and a.code = 'platform.revenue'
       where e.created_at >= v_start and e.created_at < v_end
       group by 1
    ),
    s as (
      select r.period as day, sum(r.net_toman)::bigint as v
        from public.settlement_runs r
       where r.status = 'paid' and r.period >= p_from and r.period <= p_to
       group by 1
    ),
    q as (
      select (e.created_at at time zone 'utc')::date as day, sum(e.signed_amount)::bigint as v
        from public.ledger_entries e
        join public.ledger_accounts a on a.id = e.account_id and a.kind = 'profile'
       where e.settled_in_run_id is null and e.created_at >= v_start and e.created_at < v_end
       group by 1
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'day', to_char(days.day, 'YYYY-MM-DD'),
             'commission_toman', coalesce(c.v, 0),
             'settled_net_toman', coalesce(s.v, 0),
             'pending_net_toman', coalesce(q.v, 0)) order by days.day), '[]'::jsonb),
           coalesce(sum(coalesce(c.v, 0)), 0)::bigint,
           coalesce(sum(coalesce(s.v, 0)), 0)::bigint,
           coalesce(sum(coalesce(q.v, 0)), 0)::bigint
      into v_rows, v_trend_commission, v_trend_settled, v_trend_pending
      from days
      left join c on c.day = days.day
      left join s on s.day = days.day
      left join q on q.day = days.day;
    v_total := jsonb_build_object(
      'commission_toman', v_trend_commission, 'settled_net_toman', v_trend_settled, 'pending_net_toman', v_trend_pending);
    v_source := jsonb_build_object(
      'tables', jsonb_build_array('ledger_entries', 'ledger_accounts', 'settlement_runs'),
      'columns', jsonb_build_array('ledger_entries.signed_amount', 'ledger_entries.created_at', 'ledger_entries.settled_in_run_id',
                                   'settlement_runs.net_toman', 'settlement_runs.period', 'settlement_runs.status'),
      'note', 'one row per UTC day in the range; a day with no rows reports zeros, never an invented value');
  end if;

  return jsonb_build_object(
    'kind', p_kind,
    'from', to_char(p_from, 'YYYY-MM-DD'),
    'to', to_char(p_to, 'YYYY-MM-DD'),
    'granularity', p_granularity,
    'total', v_total,
    'rows', v_rows,
    'source', v_source);
end $$;
revoke all on function public.admin_finance_report(text, date, date, text) from public, anon, authenticated;
grant execute on function public.admin_finance_report(text, date, date, text) to authenticated;

commit;
