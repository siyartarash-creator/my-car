begin;

-- WU-FINANCE-F3a: the settlement run -- compute, approve, mark paid.
-- osaa/specs/finance.md section 4 row F3a, the "settlement without a scheduler"
-- paragraph, and section 2 rules 4 and 5.
--
-- WHAT THIS STEP DECIDES (the owner's requirements, not suggestions):
--   * settlement_runs holds ONE row per (provider, period). `period` is a plain
--     date; `computed_at` is a SEPARATE timestamp. The totals are stored on the
--     row. A run's status goes draft -> approved -> paid and nowhere else.
--   * The foreign key that F1 deliberately left out of ledger_entries.
--     settled_in_run_id is added here (section E). TD-030 is closed by it. F1's
--     own triggers already guarantee the column is set at most once and is never
--     changed or nulled (private.ledger_entries_guard_settled and
--     private.ledger_entries_append_only). This step does not weaken either.
--   * settlement_lines holds the entries a run includes, each referencing its
--     ledger entry. A run's totals are DERIVABLE FROM ITS OWN LINES. An entry
--     belongs to exactly one run: settlement_lines_entry_unique (section D).
--   * Compute is IDEMPOTENT: computing the same (provider, period) twice cannot
--     produce two runs.
--   * The per-person settlement schedule is DATA (section A): daily by default,
--     overridable per profile including the TIME OF DAY, and read by the compute
--     (section F). A cadence other than daily (weekly, monthly) would need a
--     product decision about which date a weekly run carries, so it is
--     deliberately NOT here and no column is invented for it.
--   * NO SCHEDULER. No cron, no pg_cron, no trigger, no job exists anywhere in
--     this step. A run exists only because an admin called
--     public.admin_compute_settlement_run. Reading a page never creates a run.
--   * The computation covers ANY unsettled period, not only today. A run computed
--     late for an earlier period records THAT period, so the daily trend is not
--     corrupted by when the button was pressed.
--   * Approve, then mark paid WITH A PAYMENT REFERENCE: the owner pays outside the
--     system. Marking paid records the fact and moves no money (section G).
--
-- THE SIGN CONVENTION AND THE TOTALS (what a run's lines mean).
-- A cash job (F2a) writes two transfers against the provider's own account. With
-- a full invoice of 1,000,000 and a 20% commission (the provider's own share,
-- v_earned, is 800,000):
--   1. reason 'job_cash_collected': provider +1,000,000, platform.clearing -1,000,000
--   2. reason 'job_commission':     provider   -800,000, platform.revenue   +800,000
-- The provider's balance is then +200,000: the commission, and a positive
-- balance is the debt that F2b's ceiling reads. A cancellation penalty posts
-- reason 'cancel_penalty' (or 'rescuer_cancel_penalty') with the payer debited
-- (provider -amount) and platform.revenue credited (+amount), as the postings
-- migration writes it. A reversal posts the same legs negated, with the original
-- reason plus the suffix '_reversed'.
-- A run's lines are the provider's OWN account legs only, so over those lines:
--   cash_collected_toman = SUM(signed_amount) where reason like 'job_cash_collected%'
--   income_toman         = -SUM(signed_amount) where reason like 'job_commission%'
--                          (the provider's own share written back to them)
--   commission_toman     = cash_collected_toman - income_toman (the platform's cut)
--   penalty_toman        = -SUM(signed_amount) where reason like '%penalty%'
--                          (positive when the provider was charged)
-- F2a debits the payer, so a penalty charged to the provider LOWERS net_toman by its
-- amount while penalty_toman reports it as a positive charged amount: net =
-- cash_collected - income - penalty, plus any unclassified line. That is the
-- deduction the owner's rule describes (spec section 1: a penalty is deducted from
-- that day's settlement), and this step RECORDS what F2a posted rather than
-- re-defining it.
--   net_toman            = SUM(signed_amount) over EVERY line of the run
--                          (positive: the provider owes the platform)
--   entry_count          = the number of lines
-- net_toman is not assumed to equal commission + penalty. A line whose reason is
-- none of the three families (a manual admin entry, say) counts in net_toman and
-- in nothing else. That is deliberate: net is what the provider owes, and every
-- ledger leg they own is part of it.
--
-- THE BALANCE SHAPE QUESTION THIS STEP INHERITS (owner decision, recorded not resolved).
-- F2a's own header (202611050000, lines 36-43) records a KNOWN OPEN QUESTION left for the
-- owner: with a zero-sum transfer, platform.revenue receives the provider's earned share
-- rather than the commission, and a cash job with no commission row leaves the provider
-- holding the full invoice. This step is, in F2a's own words, "the first consumer that
-- reads these balances": it turns the provider's legs into cash_collected / income /
-- commission / penalty / net and settles net. It does not change any posting and does not
-- decide that question. The decision (and any change to F2a's leg targets or the penalty's
-- direction) belongs to the owner before the F4 wallet shows these numbers to a provider.
--
-- THE PERIOD AND ITS CLOCK. The ledger's clock is UTC, like every timestamp in
-- this codebase (ledger_settings.ledger_cutover_at is written with
-- `now() at time zone 'utc'`). An entry's period is therefore
-- (created_at at time zone 'utc')::date. This is a deliberate choice: one clock
-- for the ledger. A business-day timezone would be a product decision, and it is
-- not this step's. A run for period P covers exactly the provider's OWN unsettled
-- entries whose period is P, by STRICT equality and not "<= P": that is what
-- keeps the daily trend honest.
--
-- IDEMPOTENCY, THREE MECHANISMS:
--   1. unique (provider_id, period) on settlement_runs: one run per day per provider.
--   2. pg_advisory_xact_lock keyed on (provider, period), taken in the compute
--      BEFORE any read of what exists. F1's header named this step as the one that
--      needs the lock.
--   3. F1's settled-once trigger, plus settlement_lines_entry_unique: an entry
--      can be claimed by at most one run, ever.
-- THE BOUNDARIES:
--   * A DRAFT run is refreshable. Computing the same (provider, period) again while
--     the run is still a draft adds the entries that became unsettled for that
--     period since the last compute and recomputes the totals. When nothing new
--     arrived, the second compute WRITES NOTHING: no row, no line, no marker, no
--     total, no timestamp.
--   * An APPROVED or PAID run is CLOSED. A compute against it writes nothing and
--     answers reason 'run_already_closed'. A late entry for a closed period stays
--     unsettled on purpose: the F4 screen must show it, and F3b or a later step
--     decides what to do with it.
--   * NO EMPTY RUN, EVER. A period with nothing to settle produces no run row. The
--     compute answers reason 'nothing_to_settle' and writes nothing.
--   * Only the provider's OWN account legs become lines. The platform, clearing and
--     revenue legs are never lines and are never marked settled.
--
-- RATE INDEPENDENCE. The compute reads ledger_entries, settlement_lines,
-- settlement_runs and the schedule resolver. It never reads a live rate row and
-- never reads a job table: a run's totals are the ledger's own numbers, recorded
-- at the moment of settlement. Changing a commission percentage later cannot move
-- a total that has already been recorded.
--
-- WHAT IS DELIBERATELY NOT IN THIS STEP:
--   * F4's screens, the wallet, the 40% banner, and the read-only unsettled-period
--     listing (TD-041). The reconciliation query stays a test constant until F4
--     (TD-031).
--   * F3b's reversal-after-settlement path. A reversal of an entry that is already
--     settled is F3b's to design.
--   * Any change to suspension, documents, the debt ceiling or the accept paths.
--     This step adds no new refusal to any of them.
--   * Any edit of an existing function body. The only change to an existing object
--     is the foreign key in section E, which is required by TD-030.
--   * Any money movement. Marking paid writes no ledger row. The actual payment is
--     an F4 admin manual ledger entry (spec section 10).

-- === A. public.settlement_schedules -- the per-person schedule, as DATA ==========
-- profile_id null is the single platform default row. A profile row overrides it
-- for that person, whatever its is_active; an inactive profile row means "no
-- automatic settlement" for that person and never falls back to the default.
create table public.settlement_schedules (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  settle_at_time time not null default '22:00',
  is_active boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);
create unique index settlement_schedules_profile_unique on public.settlement_schedules (profile_id) where profile_id is not null;
create unique index settlement_schedules_default_unique on public.settlement_schedules ((profile_id is null)) where profile_id is null;

-- Seeded default: the platform's daily settlement time of day, on the ledger's UTC clock.
insert into public.settlement_schedules (profile_id, settle_at_time, note)
  values (null, '22:00', 'the platform default daily settlement time of day, on the ledger UTC clock')
  on conflict do nothing;

-- RLS: a provider may see their own time; the default row is admin-only by construction.
-- No write grant to anyone: the time of day is edited through an admin RPC, as every
-- other panel setting is.
alter table public.settlement_schedules enable row level security;
revoke all on public.settlement_schedules from public, anon, authenticated;
grant select on public.settlement_schedules to authenticated;
create policy settlement_schedules_read on public.settlement_schedules for select to authenticated
  using (profile_id = auth.uid() or private.is_admin());

-- === B. private.settlement_schedule_for(profile) -- which row applies ==========
-- The profile's own row, whatever its is_active, when one exists. The default row
-- only when the profile has NO row at all. Same shape as
-- private.ledger_debt_ceiling_for (202611060000).
create function private.settlement_schedule_for(p_profile_id uuid) returns public.settlement_schedules
language sql stable security definer set search_path = '' as $$
  select s.* from public.settlement_schedules s
   where s.profile_id = p_profile_id
  union all
  select s.* from public.settlement_schedules s
   where s.profile_id is null
     and not exists (select 1 from public.settlement_schedules r where r.profile_id = p_profile_id)
  limit 1;
$$;
revoke all on function private.settlement_schedule_for(uuid) from public, anon, authenticated;

-- === C. public.settlement_runs -- one row per (provider, period) ==============
create table public.settlement_runs (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.profiles(id) on delete restrict,
  account_id uuid not null references public.ledger_accounts(id) on delete restrict,
  -- The period the run COVERS, a plain date. Set once at creation, immutable (C's trigger).
  period date not null,
  -- When the run was last computed. Separate from period on purpose.
  computed_at timestamptz not null default now(),
  status text not null default 'draft',
  income_toman bigint not null default 0,
  commission_toman bigint not null default 0,
  penalty_toman bigint not null default 0,
  cash_collected_toman bigint not null default 0,
  net_toman bigint not null default 0,
  entry_count integer not null default 0,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete restrict,
  paid_at timestamptz,
  paid_by uuid references public.profiles(id) on delete restrict,
  payment_reference text,
  created_at timestamptz not null default now(),
  constraint settlement_runs_provider_period_unique unique (provider_id, period),
  constraint settlement_runs_status_check check (status in ('draft', 'approved', 'paid')),
  constraint settlement_runs_entry_count_check check (entry_count >= 0),
  constraint settlement_runs_reference_check check (
    payment_reference is null
    or (btrim(payment_reference) = payment_reference and char_length(payment_reference) between 1 and 200)
  ),
  constraint settlement_runs_status_shape_check check (
    (status = 'draft'    and approved_at is null     and approved_by is null     and paid_at is null     and paid_by is null     and payment_reference is null)
    or (status = 'approved' and approved_at is not null and approved_by is not null and paid_at is null     and paid_by is null     and payment_reference is null)
    or (status = 'paid'     and approved_at is not null and approved_by is not null and paid_at is not null and paid_by is not null and payment_reference is not null)
  )
);

-- The guard. A run's identity is frozen in every status. A closed run (approved or
-- paid) is frozen in its totals too. Only a draft may be refreshed. Nothing is
-- ever deleted.
create function private.settlement_runs_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'settlement_runs_are_append_only';
  end if;
  if old.status = 'paid' then
    raise exception 'settlement_run_is_closed';
  end if;
  if new.id is distinct from old.id
     or new.created_at is distinct from old.created_at
     or new.provider_id is distinct from old.provider_id
     or new.account_id is distinct from old.account_id
     or new.period is distinct from old.period then
    raise exception 'settlement_run_is_immutable';
  end if;
  if old.status <> 'draft' and (
       new.computed_at is distinct from old.computed_at
    or new.entry_count is distinct from old.entry_count
    or new.income_toman is distinct from old.income_toman
    or new.commission_toman is distinct from old.commission_toman
    or new.penalty_toman is distinct from old.penalty_toman
    or new.cash_collected_toman is distinct from old.cash_collected_toman
    or new.net_toman is distinct from old.net_toman
  ) then
    raise exception 'settlement_run_is_closed';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status = 'approved')
         or (old.status = 'approved' and new.status = 'paid')) then
      raise exception 'invalid_run_status';
    end if;
  elsif new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by
     or new.paid_at is distinct from old.paid_at
     or new.paid_by is distinct from old.paid_by
     or new.payment_reference is distinct from old.payment_reference then
    raise exception 'settlement_run_is_immutable';
  end if;
  return new;
end $$;
revoke all on function private.settlement_runs_guard() from public, anon, authenticated;
create trigger settlement_runs_guard before update or delete on public.settlement_runs
  for each row execute function private.settlement_runs_guard();

alter table public.settlement_runs enable row level security;
revoke all on public.settlement_runs from public, anon, authenticated;
grant select on public.settlement_runs to authenticated;
create policy settlement_runs_read on public.settlement_runs for select to authenticated
  using (provider_id = auth.uid() or private.is_admin());
-- No write grant to anyone: the three RPCs below are the only writers.

-- === D. public.settlement_lines -- a frozen copy of each settled entry ======
create table public.settlement_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.settlement_runs(id) on delete restrict,
  entry_id uuid not null references public.ledger_entries(id) on delete restrict,
  account_id uuid not null references public.ledger_accounts(id) on delete restrict,
  reason text not null,
  source_type text not null,
  source_id uuid not null,
  signed_amount bigint not null check (signed_amount <> 0),
  entry_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- THIS UNIQUE CONSTRAINT IS the "an entry belongs to exactly one run" guarantee.
  -- A second run can therefore never claim an entry that a first run already settled.
  constraint settlement_lines_entry_unique unique (entry_id)
);
create index settlement_lines_run_idx on public.settlement_lines (run_id);

-- The guard. A line may be written only into a draft run, and only as a faithful
-- copy of the ledger row it settles. A line is never updated and never deleted.
create function private.settlement_lines_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_run public.settlement_runs%rowtype;
  v_entry public.ledger_entries%rowtype;
begin
  select * into v_run from public.settlement_runs
   where id = case when tg_op = 'DELETE' then old.run_id else new.run_id end;
  if not found then raise exception 'settlement_run_not_found'; end if;
  if v_run.status <> 'draft' then raise exception 'settlement_run_is_closed'; end if;
  if tg_op in ('UPDATE', 'DELETE') then raise exception 'settlement_lines_are_immutable'; end if;

  if new.account_id is distinct from v_run.account_id then
    raise exception 'settlement_line_mismatch';
  end if;
  select * into v_entry from public.ledger_entries where id = new.entry_id;
  if not found then raise exception 'settlement_line_mismatch'; end if;
  if v_entry.account_id is distinct from new.account_id
     or v_entry.signed_amount is distinct from new.signed_amount
     or v_entry.reason is distinct from new.reason
     or v_entry.source_type is distinct from new.source_type
     or v_entry.source_id is distinct from new.source_id
     or v_entry.created_at is distinct from new.entry_created_at then
    raise exception 'settlement_line_mismatch';
  end if;
  return new;
end $$;
revoke all on function private.settlement_lines_guard() from public, anon, authenticated;
create trigger settlement_lines_guard before insert or update or delete on public.settlement_lines
  for each row execute function private.settlement_lines_guard();

alter table public.settlement_lines enable row level security;
revoke all on public.settlement_lines from public, anon, authenticated;
grant select on public.settlement_lines to authenticated;
create policy settlement_lines_read on public.settlement_lines for select to authenticated
  using (exists (
    select 1 from public.settlement_runs r
     where r.id = run_id and (r.provider_id = auth.uid() or private.is_admin())
  ));
-- No write grant to anyone.

-- === E. The foreign key F1 left out -- closes TD-030 ==========================
-- F1 left settled_in_run_id without a foreign key because public.settlement_runs
-- did not exist yet. It exists now. Set-at-most-once and never-nulled are still
-- enforced by F1's own triggers (private.ledger_entries_guard_settled and
-- private.ledger_entries_append_only). This constraint adds only the referential
-- half. The column, its triggers, its indexes and every other row are untouched.
alter table public.ledger_entries
  add constraint ledger_entries_settled_in_run_fk
  foreign key (settled_in_run_id) references public.settlement_runs(id) on delete restrict;

-- === F. public.admin_compute_settlement_run(provider, period) ================
-- The ONLY writer of a run and of a line. It is reached only by an admin call:
-- there is no scheduler, no cron and no trigger that calls it.
-- It reads ledger_entries, settlement_lines and settlement_runs, plus the schedule
-- resolver in section B, and nothing else. It never reads a rate table or a job
-- table. See the header, "RATE INDEPENDENCE".
--
-- A named explicit period ALWAYS computes, whatever the schedule's is_active says.
-- is_active governs only the automatic (null period) case.
--
-- The lock is taken BEFORE the first read of what exists, so two concurrent
-- computes for the same (provider, period) serialize, and the second one sees the
-- first one's committed run.
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

-- === G. Approve, mark paid, and the one serializer every RPC shares ===========
-- The ONE serializer. It holds no business rule: every caller passes all six
-- parameters. A null run (the nothing_to_settle answer) serializes every run-derived
-- key as jsonb null, in the same key order.
create function private.settlement_run_json(
  p_run public.settlement_runs, p_reason text, p_created boolean, p_refreshed boolean,
  p_schedule_source text, p_settle_at_time text
) returns jsonb language plpgsql set search_path = '' as $$
begin
  if p_run is null then
    return jsonb_build_object(
      'run_id', null, 'provider_id', null, 'period', null, 'status', null,
      'created', p_created, 'refreshed', p_refreshed, 'reason', p_reason,
      'entry_count', null, 'income_toman', null, 'commission_toman', null, 'penalty_toman', null,
      'cash_collected_toman', null, 'net_toman', null, 'computed_at', null,
      'approved_at', null, 'approved_by', null, 'paid_at', null, 'paid_by', null, 'payment_reference', null,
      'schedule_source', p_schedule_source, 'settle_at_time', p_settle_at_time);
  end if;
  return jsonb_build_object(
    'run_id', p_run.id,
    'provider_id', p_run.provider_id,
    'period', to_char(p_run.period, 'YYYY-MM-DD'),
    'status', p_run.status,
    'created', p_created,
    'refreshed', p_refreshed,
    'reason', p_reason,
    'entry_count', p_run.entry_count,
    'income_toman', p_run.income_toman,
    'commission_toman', p_run.commission_toman,
    'penalty_toman', p_run.penalty_toman,
    'cash_collected_toman', p_run.cash_collected_toman,
    'net_toman', p_run.net_toman,
    'computed_at', to_char(p_run.computed_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'approved_at', to_char(p_run.approved_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'approved_by', p_run.approved_by,
    'paid_at', to_char(p_run.paid_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'paid_by', p_run.paid_by,
    'payment_reference', p_run.payment_reference,
    'schedule_source', p_schedule_source,
    'settle_at_time', p_settle_at_time);
end $$;
revoke all on function private.settlement_run_json(public.settlement_runs, text, boolean, boolean, text, text) from public, anon, authenticated;

-- Approve: draft -> approved. Only a run with at least one line may be approved.
create function public.admin_approve_settlement_run(p_run_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.settlement_runs%rowtype;
  v_schedule public.settlement_schedules%rowtype;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'forbidden'; end if;

  select * into v_run from public.settlement_runs where id = p_run_id for update;
  if not found then raise exception 'settlement_run_not_found'; end if;
  if v_run.status <> 'draft' then raise exception 'invalid_run_status'; end if;
  if v_run.entry_count = 0 then raise exception 'empty_settlement_run'; end if;

  update public.settlement_runs
     set status = 'approved', approved_at = now(), approved_by = auth.uid()
   where id = p_run_id
  returning * into v_run;

  select * into v_schedule from private.settlement_schedule_for(v_run.provider_id);
  return private.settlement_run_json(v_run, 'approved', false, false,
    case when v_schedule.profile_id is null then 'default' else 'profile' end,
    v_schedule.settle_at_time::text);
end $$;
revoke all on function public.admin_approve_settlement_run(uuid) from public, anon, authenticated;
grant execute on function public.admin_approve_settlement_run(uuid) to authenticated;

-- Mark paid: approved -> paid, with a payment reference.
-- LOUD: this function writes NO ledger row and moves NO money. The provider's balance is
-- untouched. The payment itself happens outside the system, and the admin records it as
-- an F4 manual ledger entry (spec section 10). This function only records that it happened.
create function public.admin_mark_settlement_run_paid(p_run_id uuid, p_payment_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.settlement_runs%rowtype;
  v_schedule public.settlement_schedules%rowtype;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'forbidden'; end if;
  if p_payment_reference is null or btrim(p_payment_reference) = '' or char_length(p_payment_reference) > 200 then
    raise exception 'invalid_payment_reference';
  end if;

  select * into v_run from public.settlement_runs where id = p_run_id for update;
  if not found then raise exception 'settlement_run_not_found'; end if;
  if v_run.status <> 'approved' then raise exception 'invalid_run_status'; end if;

  update public.settlement_runs
     set status = 'paid', paid_at = now(), paid_by = auth.uid(), payment_reference = btrim(p_payment_reference)
   where id = p_run_id
  returning * into v_run;

  select * into v_schedule from private.settlement_schedule_for(v_run.provider_id);
  return private.settlement_run_json(v_run, 'paid', false, false,
    case when v_schedule.profile_id is null then 'default' else 'profile' end,
    v_schedule.settle_at_time::text);
end $$;
revoke all on function public.admin_mark_settlement_run_paid(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_mark_settlement_run_paid(uuid, text) to authenticated;

commit;
