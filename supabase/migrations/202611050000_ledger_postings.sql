begin;
-- Finance step F2a (osaa/specs/finance.md section 4, row F2a) -- wires the F1
-- ledger helper, public.post_ledger_transfer, into the RPCs that own each
-- terminal transition. The architecture is F1's (section 2 of that spec); this
-- file only adds the call sites and the three private posting helpers that
-- give those call sites their two-leg shapes.
--
-- WHAT THIS STEP DOES, AND WHAT IT PROMISES:
--   - It ONLY ADDS ledger rows at terminal transitions. Every replaced RPC keeps
--     its name, its signature, its return value, its error codes and its
--     statuses. Each body below is the latest body in the repository with the
--     posting lines added and nothing else changed (the previous body's file and
--     line range is named above each function in section C, so a reviewer can
--     diff it). Customer- and provider-visible behaviour is unchanged; the only
--     new failure modes are the error codes named in section B, and they are
--     reachable only on data that should not exist (a missing ledger account, a
--     zero invoice on a cash job, an unknown payer code on a rate row).
--   - ≡ا¤┤ NO HISTORICAL BACKFILL. The owner's cutover rule (osaa/specs/finance.md
--     section 3, 2026-07-25) applies: this migration posts nothing for any job
--     that ended before it was applied, and nothing here backdates a past job.
--     The ledger starts at ledger_settings.ledger_cutover_at (F1, section E.4).
--
-- THE TWO-LEG SHAPES, and why each is a separate call:
--   post_ledger_transfer takes ONE reason per call, so one call is one reason
--   and one balanced PAIR of legs on two different accounts (F1, the header's
--   own "consequence for F2a" paragraph). A terminal cash job is therefore posted
--   as two EVENTS, each its own call:
--     1. 'job_cash_collected' -- the provider holds the platform's cash, so the
--        provider's account carries the full invoice: provider +full_invoice,
--        platform.clearing -full_invoice.
--     2. 'job_commission' -- the commission event, same source_type/source_id:
--        provider -earned_share, platform.revenue +earned_share, where
--        earned_share = full_invoice - commission. The provider's single signed
--        balance after both events is full_invoice - earned_share = commission,
--        which is the spec's stated net for a cash job.
--   A zero commission posts NO commission transfer (see section B1): a zero-amount
--   leg is refused by the ledger, and the provider's net is then the full invoice
--   that event 1 recorded. KNOWN OPEN QUESTION, for owner review before this
--   migration is applied: with these accounts and a zero-sum transfer,
--   platform.revenue receives earned_share (not commission) and, with no
--   commission row, a cash job leaves the provider holding the full invoice.
--   This step implements the spec's stated net and does not resolve that
--   question; F3a's settlement is the first consumer that reads these balances.
--
-- REASON STRINGS this step introduces (the exact contract, see section D):
--   'job_cash_collected', 'job_commission', 'cancel_penalty',
--   'rescuer_cancel_penalty', and the reversal reason '<original>_reversed'.
--
-- THE IDEMPOTENCY GUARANTEE is the anti-duplicate index
-- ledger_entries_event_leg_unique (F1, section B), not an "already posted?"
-- pre-check. Every new call site sits AFTER the RPC's own early returns
-- (if r.status = 'done' then return / if r.status = 'cancelled' then return),
-- inside the branch that performs the transition, so a retried request posts
-- nothing new. The index is what stops a duplicate that slips past an early return.
--
-- WHAT IS DELIBERATELY NOT IN THIS STEP, and which step owns it:
--   - can_accept_work(...) and the debt ceiling: F2b.
--   - Settlement runs (settlement_runs, the settled_in_run_id writer): F3a.
--   - The post-settlement correction path: F3b.
--   - The wallet and report screens: F4.
--   - ONLINE settlement: a job completed with payment_method 'online' posts
--     NOTHING in this step. No consumer exists yet for money that has not moved,
--     so this is a known, deliberate gap, recorded here rather than invented.
--   - Orders (the shop escrow path) post NOTHING in this step either. orders has
--     no escrow writer at all: escrow_status is documented as having neither a
--     reader nor a writer, so there is no event to hook. Open until the escrow
--     phase defines one.
--   - Service requests (the emdad quote path) post NOTHING in this step. The
--     service_requests table has no payment_method or cash_collected column, and
--     ledger_entries.source_type has no 'service_request' member (F1's own CHECK).
--     Open until a payment column and a source type are added by their owner.
--
-- SCHEMA CHANGE: exactly one column is added, public.return_requests
-- .ledger_refund_transfer_id, with a partial unique index (section C6). No new
-- table, no trigger, no grant of post_ledger_transfer to any role, no change to
-- any ledger table.

-- === A. private.ledger_commission -- the one shared read of the commission rate
--        and its arithmetic ===============================================
-- A pure read: it writes nothing. It exists so the arithmetic that complete_
-- hauling_job already does inline is shared by the posting helper instead of
-- copied a third time. The basis is the job price the commission is charged on
-- (for hauling, private.effective_hauling_price(r); for onsite, the accepted
-- price), because a percent commission cannot be computed without it.
-- No active 'commission' row gives commission 0 and nulls for the rate fields.
create function private.ledger_commission(p_basis_toman bigint) returns jsonb
language sql stable set search_path = '' as $$
  with rate as (
    select r.id, r.calc_mode, r.rate_percent, r.amount_toman
      from public.hauling_financial_rates r
     where r.code = 'commission' and r.is_active is true
     limit 1
  )
  select coalesce(
    (select jsonb_build_object(
       'commission', case when rate.calc_mode = 'fixed' then coalesce(rate.amount_toman, 0)
                          else round(p_basis_toman * coalesce(rate.rate_percent, 0) / 100)::bigint end,
       'rate_id', rate.id,
       'calc_mode', rate.calc_mode,
       'rate_percent', rate.rate_percent,
       'amount_toman', rate.amount_toman)
       from rate),
    jsonb_build_object('commission', 0, 'rate_id', null, 'calc_mode', null,
                       'rate_percent', null, 'amount_toman', null))
$$;
revoke all on function private.ledger_commission(bigint) from public, anon, authenticated;

-- === B. The posting helpers -- called ONLY from the SECURITY DEFINER RPCs in
--        section C, which share the owner role with post_ledger_transfer, so no
--        grant is needed (the same argument F1 makes for post_ledger_transfer) =
-- Every helper's guards raise a code from F1's vocabulary or from this step's
-- named list ('ledger_account_not_found', 'invalid_amount', 'transfer_not_found',
-- 'already_reversed'). The balance itself is never checked here: the zero-sum
-- rule and the anti-duplicate index are post_ledger_transfer's, and every helper
-- goes through it.

-- B1: the commission event, and only that event. The job price is read from the
-- request row itself (the caller does not pass it), so the commission and the
-- snapshot describe the same number the RPC just settled.
create function private.post_ledger_job_commission(p_provider_id uuid, p_request_id uuid, p_source_type text)
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

-- B2: the cash-collection event. The provider physically holds the platform's
-- cash, so the provider's account carries the full invoice and clearing offsets it.
-- No rate row is involved, so the snapshot names the event and the amount posted.
create function private.post_ledger_cash_collection(p_collector_id uuid, p_request_id uuid, p_source_type text, p_full_invoice bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_collector_account uuid;
  v_clearing_account uuid;
begin
  if p_source_type not in ('hauling_request', 'onsite_request') then raise exception 'invalid_source_type'; end if;
  if p_full_invoice is null or p_full_invoice <= 0 then raise exception 'invalid_amount'; end if;

  select a.id into v_collector_account from public.ledger_accounts a where a.profile_id = p_collector_id;
  select a.id into v_clearing_account from public.ledger_accounts a where a.code = 'platform.clearing';
  if v_collector_account is null or v_clearing_account is null then
    raise exception 'ledger_account_not_found';
  end if;

  perform public.post_ledger_transfer(p_source_type, p_request_id, 'job_cash_collected',
    jsonb_build_array(
      jsonb_build_object('account_id', v_collector_account, 'signed_amount', p_full_invoice),
      jsonb_build_object('account_id', v_clearing_account, 'signed_amount', -p_full_invoice)),
    jsonb_build_object(
      'code', 'job_cash_collected',
      'calc_mode', null,
      'rate_percent', null,
      'amount_toman', null,
      'amount_assessed_toman', p_full_invoice,
      'rate_row_id', null));
end $$;
revoke all on function private.post_ledger_cash_collection(uuid, uuid, text, bigint) from public, anon, authenticated;

-- B3: a cancellation penalty. The payer is debited and platform.revenue is credited
-- for the same amount. The caller passes the snapshot, because only the caller
-- holds the rate row (or the site_settings fallback) that produced the fee.
create function private.post_ledger_penalty(p_payer_id uuid, p_request_id uuid, p_source_type text, p_reason text, p_amount bigint, p_rate_snapshot jsonb)
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

-- B4: the refund primitive. A reversal is a MIRROR of an existing transfer, so
-- its source_type, source_id and reason are read from the original rows, never
-- from a parameter. A caller-supplied reason would be the one field the
-- reversal-fidelity trigger (F1, section C mechanism 4) checks only against the
-- original; deriving it removes the caller from that check entirely. Each reversal
-- leg names the original leg it negates (reverses_entry_id), and the write goes
-- through the same post_ledger_transfer as every other entry, so the zero-sum
-- rule and the anti-duplicate exemption for reversals stay in one place.
create function private.reverse_ledger_transfer(p_transfer_id uuid, p_rate_snapshot jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_leg record;
  v_legs jsonb := '[]'::jsonb;
  v_count int := 0;
  v_source_type text;
  v_source_id uuid;
  v_reason text;
begin
  -- Ordered by account so the legs, and therefore the reversal, are deterministic.
  for v_leg in
    select e.id, e.account_id, e.signed_amount, e.reason, e.source_type, e.source_id
      from public.ledger_entries e
     where e.transfer_id = p_transfer_id
     order by e.account_id
  loop
    -- One reversal per original leg (the reversal-unique index enforces this
    -- declaratively; this check gives the caller the specific error).
    if exists (select 1 from public.ledger_entries x where x.reverses_entry_id = v_leg.id) then
      raise exception 'already_reversed';
    end if;
    if v_count = 0 then
      v_source_type := v_leg.source_type;
      v_source_id := v_leg.source_id;
      v_reason := v_leg.reason;
    end if;
    v_count := v_count + 1;
    v_legs := v_legs || jsonb_build_array(jsonb_build_object(
      'account_id', v_leg.account_id,
      'signed_amount', -v_leg.signed_amount,
      'reverses_entry_id', v_leg.id));
  end loop;
  if v_count = 0 then raise exception 'transfer_not_found'; end if;

  return public.post_ledger_transfer(v_source_type, v_source_id, v_reason || '_reversed', v_legs,
    p_rate_snapshot || jsonb_build_object('original_reason', v_reason));
end $$;
revoke all on function private.reverse_ledger_transfer(uuid, jsonb) from public, anon, authenticated;

-- === C. The wiring. Each function below is the latest body in the repository
--        with ONLY the posting lines added. The source file and line range of
--        the previous body is named above each function. ======================

-- C1. Previous body: 202611020000_price_revisions.sql lines 315-361.
-- Added: the two posting calls inside the existing `if p_cash_collected then`
-- branch, after payment.collected. The 'commission.assessed' event is unchanged.
-- Online completion posts nothing (see the header). The DECLARE gains no
-- variable: the commission is read inside post_ledger_job_commission.
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

-- C2. Previous body: 202610160003_onsite_dispatch_rpcs.sql lines 544-571.
-- Added: the two posting calls inside the existing `if p_cash_collected then`
-- branch. The commission read is inside post_ledger_job_commission, so this body
-- needs no new variable. No 'commission.assessed' event: this RPC never had one,
-- and inventing a product event is not this step's job.
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

-- C3. Previous body: 202610140003_hauling_dispatch_rpcs.sql lines 452-490.
-- Added: a DECLARE variable for the payer, and the posting call inside the
-- existing `if fee > 0 then` branch, after penalty.assessed. The payer comes from
-- the rate row's payer; an unknown payer, or a missing party, raises
-- 'ledger_payer_unresolved' rather than guessing an account. The early return and
-- the returned fee are byte-identical to the previous body.
create or replace function public.cancel_hauling_request(p_request_id uuid, p_reason text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.hauling_requests%rowtype;
  rate public.hauling_financial_rates%rowtype;
  fee bigint := 0;
  v_payer uuid;
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
    if rate.payer = 'customer' then
      v_payer := r.requester_id;
    elsif rate.payer = 'rescuer' then
      v_payer := r.provider_id;
    else
      raise exception 'ledger_payer_unresolved';
    end if;
    if v_payer is null then raise exception 'ledger_payer_unresolved'; end if;
    perform private.post_ledger_penalty(v_payer, r.id, 'hauling_request', 'cancel_penalty', fee,
      jsonb_build_object('code', 'cancel_penalty', 'calc_mode', rate.calc_mode, 'rate_percent', rate.rate_percent,
                         'amount_toman', rate.amount_toman, 'amount_assessed_toman', fee, 'rate_row_id', rate.id));
  end if;
  return fee;
end $$;
revoke all on function public.cancel_hauling_request(uuid,text) from public, anon;
grant execute on function public.cancel_hauling_request(uuid,text) to authenticated;

-- C4. Previous body: 202610240000_suspension_covers_every_provider_action.sql lines 402-459.
-- Added: the posting call inside the existing `if fee > 0 then` branch, after
-- penalty.assessed. The payer is the rescuer who is cancelling (uid). When no
-- rescuer_cancel_penalty rate row exists, the fee comes from the site_settings
-- fallback, and the snapshot records it as calc_mode 'fixed_fallback' with
-- rate_row_id null: the value is the one used, not an id that resolves to nothing.
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
    perform private.post_ledger_penalty(uid, r.id, 'hauling_request', 'rescuer_cancel_penalty', fee,
      case when rate.id is not null then
        jsonb_build_object('code', 'rescuer_cancel_penalty', 'calc_mode', rate.calc_mode, 'rate_percent', rate.rate_percent,
                           'amount_toman', rate.amount_toman, 'amount_assessed_toman', fee, 'rate_row_id', rate.id)
      else
        jsonb_build_object('code', 'rescuer_cancel_penalty', 'calc_mode', 'fixed_fallback', 'rate_percent', null,
                           'amount_toman', fee, 'amount_assessed_toman', fee, 'rate_row_id', null)
      end);
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

-- C5. Previous body: 202611010000_returns_admin.sql lines 281-319 (the 3-argument
-- function, which is NOT replaced and keeps its grant).
-- This is an OVERLOAD. The 4th parameter has NO default on purpose: with
-- `default null`, a call with three arguments matches both signatures and
-- PostgreSQL rejects it as ambiguous, which would break every existing client
-- call. Without the default, existing calls keep resolving to the 3-argument
-- function, and the refund is opt-in through an explicit fourth argument.
-- A refund posts only when the decision is 'approved' and p_refund_transfer_id is
-- not null. The same-decision early return is unchanged, so repeating the call
-- posts nothing. The reversal runs after the decision row is written and before
-- the audit row, so the audit row records the refund in the same jsonb, and any
-- failure aborts the decision with it.
create or replace function public.admin_decide_return(p_id uuid, p_decision text, p_reason text, p_refund_transfer_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.return_requests%rowtype;
  v_decision text;
  v_refund_transfer_id uuid;
  v_audit_extra jsonb := '{}'::jsonb;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 or length(p_reason) > 2000 then
    raise exception 'reason_required';
  end if;
  v_decision := lower(btrim(coalesce(p_decision, '')));
  if v_decision not in ('approved', 'rejected') then raise exception 'invalid_decision'; end if;

  select * into v from public.return_requests where id = p_id for update;
  if not found then raise exception 'return_not_found'; end if;

  -- The SAME decision twice is a silent no-op: no write, no audit row, no
  -- timestamp drift. A DIFFERENT decision is a real reversal (below).
  if v.review_status = v_decision then return; end if;

  update public.return_requests set
    review_status = v_decision,
    review_reason = btrim(p_reason),
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    updated_at = now()
  where id = p_id;

  if v_decision = 'approved' and p_refund_transfer_id is not null then
    v_refund_transfer_id := private.reverse_ledger_transfer(p_refund_transfer_id,
      jsonb_build_object('code', 'refund_reversal', 'reverses_transfer_id', p_refund_transfer_id));
    update public.return_requests set ledger_refund_transfer_id = v_refund_transfer_id where id = p_id;
    v_audit_extra := jsonb_build_object('refund_reversal_transfer_id', v_refund_transfer_id);
  end if;

  perform private.log_admin_action(
    case when v.review_status = 'pending' then 'decide_return' else 'revise_return_decision' end,
    'return_requests', p_id::text, btrim(p_reason),
    jsonb_build_object(
      'previous', jsonb_build_object('review_status', v.review_status, 'review_reason', v.review_reason),
      'new', jsonb_build_object('review_status', v_decision, 'review_reason', btrim(p_reason))) || v_audit_extra);
end $$;
-- No delete path exists for the case row, for the admin or for anyone else,
-- by design (see the returns migration's header).
revoke all on function public.admin_decide_return(uuid, text, text, uuid) from public, anon;
grant execute on function public.admin_decide_return(uuid, text, text, uuid) to authenticated;

-- C6. The case records the reversal that refunded it. The partial unique index is
-- the WHOLE guarantee that one case can never be refunded twice: no trigger is
-- added, and no grant is made to any role for this column.
alter table public.return_requests add column if not exists ledger_refund_transfer_id uuid;
create unique index if not exists return_requests_ledger_refund_transfer_unique
  on public.return_requests (ledger_refund_transfer_id)
  where ledger_refund_transfer_id is not null;
comment on column public.return_requests.ledger_refund_transfer_id is
  'the reversal transfer (public.ledger_entries.transfer_id) that refunded this case; unique, so one case is refunded at most once';

-- === D. Marker: the exact contract this migration introduces ================
-- Reason strings introduced:
--   'job_cash_collected'        (private.post_ledger_cash_collection)
--   'job_commission'            (private.post_ledger_job_commission)
--   'cancel_penalty'            (private.post_ledger_penalty, from cancel_hauling_request)
--   'rescuer_cancel_penalty'    (private.post_ledger_penalty, from rescuer_cancel_hauling_request)
--   '<original reason>_reversed' (private.reverse_ledger_transfer, from admin_decide_return)
-- Call sites:
--   public.complete_hauling_job              -> cash collection + commission (hauling)
--   public.onsite_job_complete               -> cash collection + commission (onsite)
--   public.cancel_hauling_request            -> cancel_penalty
--   public.rescuer_cancel_hauling_request    -> rescuer_cancel_penalty
--   public.admin_decide_return (4-argument)  -> refund reversal
-- The reconciliation query in tests/ledger-core.mjs (group 14) keys on reason
-- 'job_cash_collected' alone and therefore still sees exactly one collection group
-- per terminal cash job.
commit;
