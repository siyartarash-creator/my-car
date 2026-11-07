begin;

-- WU-FINANCE-F2b: the debt ceiling. osaa/specs/finance.md section 2 rule 6 and
-- section 4 row F2b. A cash-holding provider (a rescuer or an on-site service
-- provider) may hold only a bounded amount of the platform's cash in hand. Once
-- that amount reaches the stop threshold, the provider may not take on another
-- job until a settlement (F3a) brings the balance back down.
--
-- THE RULE. The ceiling is PER PROFILE and defaults to 5,000,000 toman. Two
-- percentages of it are used: a warning at 40% used (the wallet shows a
-- banner, F4) and a stop at 95% used (5% remaining). Both thresholds and the
-- ceiling itself are DATA, in public.ledger_debt_ceilings (section A), never
-- constants in a function. The owner will edit them from the admin panel (F4),
-- so no number in the predicate below may be a literal.
--
-- THE SIGN CONVENTION. A cash job posts 'job_cash_collected' as provider
-- +full_invoice and platform.clearing -full_invoice (the provider physically
-- holds the platform's cash), then 'job_commission' as provider -earned and
-- platform.revenue +earned. A provider who has collected cash therefore has a
-- POSITIVE signed balance, and that positive balance IS the debt. Balance =
-- SUM(signed_amount) over public.ledger_entries for the provider's account. A
-- provider who has never collected cash has a balance of zero or less and is
-- never blocked by this step.
--
-- THE ONE DECISION. private.ceiling_decision(uuid) (section C0) is the only place
-- in the database that decides the ceiling. It returns a jsonb decision and
-- nothing else. public.can_accept_work(uuid) (section C) is the client-facing
-- permission layer over it and decides nothing itself. The core follows
-- private.is_suspended's shape: a small security definer function with an empty
-- search_path. Its lock is taken FIRST, on the
-- provider's ledger account row (SELECT ... FOR UPDATE), and only then is the
-- balance summed. Two accepts on the same provider therefore serialize at that
-- lock. The second one re-reads the balance after the first has committed, so
-- at 94% for both, the loser sees 94% plus the winner's invoice and is refused.
--
-- THE THIRD STATE. A provider may now be refused for three distinct reasons,
-- checked in this order at every accept path: 'account_suspended' (the
-- suspension guard), 'documents_not_approved' (the documents gate), and
-- 'debt_ceiling_reached' (this step). The new refusal is checked after the
-- other two and never instead of them.
--
-- WHERE THE CEILING BITES. It is enforced on the three UPDATE-assignment accept
-- paths only: respond_to_dispatch_offer (202610280000 section A5),
-- respond_to_onsite_offer (202610310001 section C) and respond_to_price_revision
-- (202611030000 section C, offer-stage accept branch). Those are the functions
-- tests/helpers/accept-paths.mjs inventoried in F1 and TD-032 recorded. Each
-- body below is the live body reproduced exactly, with only the ceiling guard
-- (and one declaration for its result) added. Every other statement, comment
-- and error code is unchanged.
--
-- WHY THE INSERT-TIME BINDINGS ARE OUT OF SCOPE. create_service_request and
-- place_order bind a provider to a job at the moment the row is born, with the
-- buyer choosing the provider. The debt ceiling prices a provider's OWN act of
-- taking work. A buyer-triggered bind would answer the provider's debt state to
-- the buyer as an error, which leaks it and blames the wrong person. Neither
-- function posts anything to the ledger in this phase either (F2a's own TD-034),
-- so the ceiling has no metered balance to act on there yet. If either one ever
-- begins to post cash at creation, it gets its own step and its own decision.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO.
--   - It writes NO ledger row. Nothing here moves a balance, and no UPDATE or
--     DELETE of any ledger row exists anywhere. The ledger stays append-only,
--     as F1's triggers enforce it.
--   - It creates no trigger, no index on a ledger table, and adds no column to
--     any existing table.
--   - It does not settle anything. The debt is cleared by a settlement run,
--     which is F3a's to build.
--   - It has no wallet screen, no warning banner and no panel form. The screens
--     and the admin editing of section A's rows are F4's.
--   - It seeds the three rows in section A and nothing else.
--
-- SELLERS AND SHOPS ARE OUT OF SCOPE. A seller's money is escrow, not cash in
-- hand, so no ceiling row exists for 'seller' or 'owner', and the predicate
-- never applies to them. The '*' row carries only a DEFAULT AMOUNT for a
-- cash-holding role. It does not say that every role is capped, and it must
-- never make the predicate apply to a seller.

-- === A. public.ledger_debt_ceilings -- the DATA =============================
-- role is a profiles.user_type value, or the sentinel '*' meaning "the platform
-- default amount". A role with no row here is never refused by private.ceiling_decision:
-- that absence is the scope decision, not an oversight. A role's own row, when
-- it exists, is authoritative even when is_active is false (an inactive row
-- means "this role is not capped", never "fall back to the default"). See
-- private.ledger_debt_ceiling_for (section B).
--
-- These numbers are data the owner may change from the F4 panel. They are
-- never literals in the predicate. Editing a percentage must never need a
-- migration.
create table public.ledger_debt_ceilings (
  role text primary key,
  ceiling_toman bigint not null default 5000000,
  warn_at_percent numeric not null default 40,
  stop_at_percent numeric not null default 95,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint ledger_debt_ceilings_ceiling_check check (ceiling_toman >= 0),
  constraint ledger_debt_ceilings_warn_check check (warn_at_percent > 0 and warn_at_percent <= 100),
  constraint ledger_debt_ceilings_stop_check check (
    stop_at_percent > 0 and stop_at_percent <= 100 and stop_at_percent > warn_at_percent
  )
);

-- Seeded data: the platform default the owner named, and one explicit row for
-- each cash-holding role. Idempotent: a re-run never overwrites an edited row.
insert into public.ledger_debt_ceilings (role, ceiling_toman, warn_at_percent, stop_at_percent) values
  ('*', 5000000, 40, 95),
  ('rescuer', 5000000, 40, 95),
  ('service', 5000000, 40, 95)
on conflict (role) do nothing;

-- RLS: clients never write this table. It is read by an admin screen only.
-- There is no INSERT, UPDATE or DELETE grant to any client role: the F4 panel
-- edits these rows through an admin RPC, exactly as it edits every other panel
-- setting.
alter table public.ledger_debt_ceilings enable row level security;
revoke all on public.ledger_debt_ceilings from public, anon, authenticated;
grant select on public.ledger_debt_ceilings to authenticated;
create policy ledger_debt_ceilings_read_admin on public.ledger_debt_ceilings
  for select to authenticated
  using (private.is_admin());

-- === B. private.ledger_debt_ceiling_for(role) -- which row applies =========
-- The role's own row, whatever its is_active, when one exists. The '*' default
-- row only when the role has NO row at all. So an inactive own row means "this
-- role is not capped right now" and never falls back to the default amount.
-- Only 'rescuer' and 'service' have their own rows, and the '*' row must never
-- be handed to a seller, so THIS function is only ever reached after the caller
-- has established that the role is a cash-holding role. private.ceiling_decision
-- (section C0, step 3) enforces that scope check before it calls here. Calling it for any
-- other role, or for '*' itself, is a contract violation.
create or replace function private.ledger_debt_ceiling_for(p_role text) returns public.ledger_debt_ceilings
language sql stable security definer set search_path = '' as $$
  select c.* from public.ledger_debt_ceilings c
   where c.role = p_role
  union all
  select c.* from public.ledger_debt_ceilings c
   where c.role = '*' and not exists (select 1 from public.ledger_debt_ceilings r where r.role = p_role)
  limit 1;
$$;
revoke all on function private.ledger_debt_ceiling_for(text) from public, anon, authenticated;

-- === C0. private.ceiling_decision(provider) -- the decision, no caller check ============
-- THE DECISION. Returns the jsonb object described in section C, with the same
-- keys on every path. It has NO authorization check of any kind, and that is
-- deliberate: it is an internal primitive whose callers have already decided WHO
-- may ask. The public predicate (section C) authorizes the client-facing name. The
-- three accept RPCs (section D) act on a provider read from the job row they are
-- about to assign, which is exactly the provider whose debt the ceiling prices,
-- and that provider is not always the caller (D3's caller is the customer). It is
-- not executable by any client role: the grant is revoked below and never given.
create or replace function private.ceiling_decision(p_provider_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
  v_account_id uuid;
  v_ceiling public.ledger_debt_ceilings%rowtype;
  v_has_ceiling boolean := false;
  v_debt bigint := 0;
  v_stop_threshold bigint := null;
  v_refuse boolean := false;
  v_reason text;
begin
  -- Step 1: the provider's profile. Suspension and documents are NOT decided
  -- here; the accept paths check them before they call this decision.
  select p.user_type into v_role from public.profiles p where p.id = p_provider_id;

  -- Step 2: THE LOCK, taken before any sum. The second of two concurrent accepts
  -- on this provider waits here, and re-reads the balance after the first
  -- commits. Taking it before the sum is what makes 94%/94% impossible.
  select a.id into v_account_id from public.ledger_accounts a
   where a.profile_id = p_provider_id
     for update;

  -- Step 3 (first half): a missing profile or account is not a debt. Allowing it
  -- means a data-shape problem can never become a lockout.
  if v_account_id is null then
    v_reason := 'account_not_found';

  -- Step 3 (scope): only the cash-holding roles have a ceiling at all. The '*'
  -- row is never consulted here: it is a default AMOUNT, not a cap on every role.
  elsif v_role not in ('rescuer', 'service') then
    v_reason := 'no_ceiling_for_role';

  else
    -- Step 4: the applicable ceiling row. No row, or an inactive one, means no
    -- ceiling for this role.
    select * into v_ceiling from private.ledger_debt_ceiling_for(v_role);
    if not found or not v_ceiling.is_active then
      v_reason := 'no_ceiling_for_role';
    else
      v_has_ceiling := true;

      -- Step 5: the debt. A cash collection makes the balance positive; it is
      -- zero for a provider who has collected nothing.
      select coalesce(sum(e.signed_amount), 0)::bigint into v_debt
        from public.ledger_entries e
       where e.account_id = v_account_id;

      -- Step 6: the stop threshold, in whole toman. Rounded, not truncated, so
      -- it reports the same number the comparison below actually tests against.
      v_stop_threshold := round(v_ceiling.ceiling_toman * v_ceiling.stop_at_percent / 100)::bigint;

      -- Step 7: exact arithmetic. debt * 100 >= ceiling * stop_at_percent is the
      -- stop boundary written without division: at 94.99% the work is allowed,
      -- at exactly 95% it is refused. No float, no early rounding.
      v_refuse := v_debt * 100 >= v_ceiling.ceiling_toman * v_ceiling.stop_at_percent;
      v_reason := case when v_refuse then 'debt_ceiling_reached' else 'below_stop_threshold' end;
    end if;
  end if;

  return jsonb_build_object(
    'decision', case when v_refuse then 'refuse' else 'allow' end,
    'error_code', case when v_refuse then 'debt_ceiling_reached' else null end,
    'reason', v_reason,
    'role', v_role,
    'ceiling_toman', case when v_has_ceiling then v_ceiling.ceiling_toman else null end,
    'warn_at_percent', case when v_has_ceiling then v_ceiling.warn_at_percent else null end,
    'stop_at_percent', case when v_has_ceiling then v_ceiling.stop_at_percent else null end,
    'debt_toman', v_debt,
    'stop_threshold_toman', v_stop_threshold,
    'account_id', v_account_id
  );
end $$;
-- No grant to any client role. Only owner-side code can reach this, through the
-- public predicate's own authorization or through a SECURITY DEFINER accept RPC.
revoke all on function private.ceiling_decision(uuid) from public, anon, authenticated;

-- === C. public.can_accept_work(provider) -- THE predicate ==================
-- The permission layer over private.ceiling_decision (section C0). It returns
-- the same jsonb object, with the same keys, on every path:
--   decision              'allow' | 'refuse'
--   error_code            null | 'debt_ceiling_reached'
--   reason                'below_stop_threshold' | 'debt_ceiling_reached' |
--                         'no_ceiling_for_role' | 'account_not_found'
--   role                  profiles.user_type, or null when there is no profile
--   ceiling_toman         the applicable ceiling, or null when there is none
--   warn_at_percent       the applicable warning percentage, or null
--   stop_at_percent       the applicable stop percentage, or null
--   debt_toman            the summed balance (bigint); zero when not computed
--   stop_threshold_toman  ceiling * stop_at_percent / 100, rounded, or null
--   account_id            the provider's ledger account, or null
--
-- Not executable by any client role: the EXECUTE grant is revoked from public,
-- anon and authenticated (see the revoke below), so only owner-side code can
-- call it. The three accept RPCs do NOT call it: they call private.ceiling_decision
-- (section C0), because the provider they assign is not always the caller. As
-- defence in depth, the body raises 'forbidden' when the caller asks about a profile
-- other than its own (unless the caller is an admin), so a future migration that
-- grants it by accident is still not an oracle for another provider's debt. F4's
-- self-inquiry / wallet read will be its own read-only entry point with its own
-- visibility decision. It must never be this function handed back to clients
-- with the ceiling guard's own grant.
create or replace function public.can_accept_work(p_provider_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  -- Authorization, first: a caller may ask only about its own profile. Client
  -- roles cannot execute this at all (see the revoke below); this is the
  -- defence-in-depth check behind that grant. The decision itself lives in
  -- private.ceiling_decision, so this function is the permission layer and nothing else.
  if auth.uid() is distinct from p_provider_id and not private.is_admin() then
    raise exception 'forbidden';
  end if;

  return private.ceiling_decision(p_provider_id);
end $$;
-- No grant to any client role. Revoking client EXECUTE cannot break anything: the
-- accept RPCs call private.ceiling_decision, which is owner-only as well.
revoke all on function public.can_accept_work(uuid) from public, anon, authenticated;

-- === D. The three accept paths -- the ceiling guard, nothing else changes ===
-- Each body below is reproduced from its source file, line for line, with only
-- the ceiling guard and one declaration added. The source is named above each
-- one so a reviewer can diff it. The guard is the same in all three except for
-- the id it names; it always names the PROVIDER, never the caller.
--
-- WHICH FUNCTION THEY CALL. The three accept RPCs call private.ceiling_decision
-- (section C0), NOT the client-facing public.can_accept_work. These RPCs run as the
-- owner and are SECURITY DEFINER, so they may call the private core; and each names
-- the provider the JOB row is about to be assigned to, which may legitimately differ
-- from the caller (D3's caller is the customer). The wrapper's own-profile check
-- would refuse every legitimate accept, so the accept paths must not pass through it.
--
-- LOCK ORDER, the same in every path: the job (request) row is locked first, the
-- provider's ledger account second. No path may take the ledger lock before the
-- job lock. Dispatch would hold the account and want the job, while a price-
-- revision accept holds the job and wants the account; two such accepts could
-- deadlock. The predicate takes the account lock, so the guard always comes
-- after the job lock in each body.

-- --- D1. public.respond_to_dispatch_offer(uuid, text) ----------------------
-- Source: 202610280000_documents_gate_provider_work.sql lines 113-194.
-- Guard position: after the request row is locked, the replay answers, the
-- decline branch and the expiry answer, and immediately before the winner UPDATE.
-- So a decline is never refused by the ceiling, a legitimate retry of an accepted
-- offer still answers 'accepted', and a rescuer who lost the race still gets
-- 'already_taken'. The ledger account is locked inside the predicate, after the
-- job lock (see LOCK ORDER in section D).
create or replace function public.respond_to_dispatch_offer(p_offer_id uuid, p_response text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  o public.hauling_dispatch_offers%rowtype;
  r public.hauling_requests%rowtype;
  v_ceiling jsonb;
begin
  if uid is null then raise exception 'unauthorized'; end if;
  if private.is_suspended(uid) then raise exception 'account_suspended'; end if;
  -- Documents are an entry gate for the work, exactly like suspension: an
  -- account the panel has not approved may not accept a job. The check sits
  -- here, beside the suspension guard, so both "you may not take work" rules
  -- are answered at the same moment in the same order.
  if not private.has_approved_documents(uid) then raise exception 'documents_not_approved'; end if;
  if p_response not in ('accept', 'decline') then raise exception 'invalid_response'; end if;
  select * into o from public.hauling_dispatch_offers where id = p_offer_id;
  if not found then raise exception 'offer_not_found'; end if;
  if o.provider_id <> uid then raise exception 'forbidden'; end if;
  -- Requests first, always: it is the row every writer contends on.
  select * into r from public.hauling_requests where id = o.request_id for update;
  if not found then raise exception 'request_not_found'; end if;

  if p_response = 'decline' then
    if o.response = 'declined' then return 'declined'; end if;      -- idempotent replay
    if o.response <> 'pending' then return 'already_answered'; end if;
    update public.hauling_dispatch_offers set response = 'declined', responded_at = now() where id = o.id;
    perform private.log_hauling_event(r.id, 'offer.declined', uid, jsonb_build_object('offer_id', o.id));
    perform private.settle_hauling_dispatch_if_exhausted(r.id);
    return 'declined';
  end if;

  if o.response = 'accepted' then return 'accepted'; end if;        -- winner replay
  if o.response = 'declined' then return 'already_answered'; end if;
  -- An invitation that closed because SOMEBODY ELSE won is not "you answered
  -- it" ظ¤ the rescuer tapped accept on a job that is already gone, and
  -- 'already_taken' is the only honest answer. An invitation that closed on
  -- its own deadline, while the job is still searching, is 'offer_expired'.
  if o.response = 'expired' then
    if r.provider_id is not null and r.provider_id <> uid then return 'already_taken'; end if;
    return 'offer_expired';
  end if;
  if o.offer_deadline_at <= now() then
    update public.hauling_dispatch_offers set response = 'expired', responded_at = now()
    where id = o.id and response = 'pending';
    perform private.log_hauling_event(r.id, 'offer.expired', uid, jsonb_build_object('offer_id', o.id));
    perform private.settle_hauling_dispatch_if_exhausted(r.id);
    return 'offer_expired';
  end if;

  -- Debt ceiling (F2b): the third "may this provider take work" state, checked
  -- after the suspension and documents guards, never instead of them. It sits
  -- after the replay, decline and expiry answers, immediately before the winner
  -- UPDATE. The predicate locks the provider's ledger account before it sums, so
  -- two concurrent accepts cannot both pass below the stop threshold. Here
  -- o.provider_id is the caller, already proven equal to uid above. Calls the
  -- private core, not the wrapper (see section D).
  v_ceiling := private.ceiling_decision(o.provider_id);
  if (v_ceiling ->> 'decision') <> 'allow' then
    raise exception '%', coalesce(v_ceiling ->> 'error_code', 'debt_ceiling_reached');
  end if;

  -- ---------------------------------------------------------------------
  -- THE GUARD. One statement decides the winner. status = 'dispatching' AND
  -- provider_id IS NULL are the concurrency predicate: a second session that
  -- was waiting on this row wakes up, re-checks the predicate against the new
  -- committed version, matches nothing, and gets 'already_taken' below. No
  -- advisory lock, no SELECT-then-check gap, no way to double-assign a job.
  -- ---------------------------------------------------------------------
  update public.hauling_requests
    set provider_id = uid,
        status = 'accepted',
        accepted_at = now(),
        accepted_price_toman = quoted_price_toman,
        payment_method = coalesce(payment_method, 'cash'),
        updated_at = now()
  where id = r.id and status = 'dispatching' and provider_id is null;
  if not found then
    if r.provider_id is not null then return 'already_taken'; end if;
    return 'dispatch_closed';                                        -- cancelled / terminal meanwhile
  end if;

  update public.hauling_dispatch_offers set response = 'accepted', responded_at = now()
  where id = o.id and response = 'pending';
  -- The other invitees lost this race; their invitations close. This is also
  -- what removes their read access to the request (see the read policies).
  update public.hauling_dispatch_offers set response = 'expired', responded_at = now()
  where request_id = r.id and response = 'pending' and provider_id <> uid;
  perform private.log_hauling_event(r.id, 'offer.accepted', uid,
    jsonb_build_object('offer_id', o.id, 'accepted_price_toman', r.quoted_price_toman, 'distance_km', o.distance_km));
  perform private.log_hauling_event(r.id, 'dispatch.closed', uid, jsonb_build_object('provider_id', uid));
  return 'accepted';
end $$;
revoke all on function public.respond_to_dispatch_offer(uuid,text) from public, anon;
grant execute on function public.respond_to_dispatch_offer(uuid,text) to authenticated;

-- --- D2. public.respond_to_onsite_offer(uuid, text) ------------------------
-- Source: 202610310001_onsite_documents_gate.sql lines 64-145.
-- Guard position: the same as D1. After the on-site request row is locked, the
-- replay answers, the decline branch and the expiry answer, and immediately
-- before the winner UPDATE. The ledger account is locked inside the predicate,
-- after the job lock (see LOCK ORDER in section D).
create or replace function public.respond_to_onsite_offer(p_offer_id uuid, p_response text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  o public.onsite_dispatch_offers%rowtype;
  r public.onsite_requests%rowtype;
  v_ceiling jsonb;
begin
  if uid is null then raise exception 'unauthorized'; end if;
  if private.is_suspended(uid) then raise exception 'account_suspended'; end if;
  -- Documents are an entry gate for the work, exactly like suspension: an
  -- account the panel has not approved may not accept a job. The check sits
  -- here, beside the suspension guard, so both "you may not take work" rules
  -- are answered at the same moment in the same order.
  if not private.has_approved_onsite_documents(uid) then raise exception 'documents_not_approved'; end if;
  if p_response not in ('accept', 'decline') then raise exception 'invalid_response'; end if;
  select * into o from public.onsite_dispatch_offers where id = p_offer_id;
  if not found then raise exception 'offer_not_found'; end if;
  if o.provider_id <> uid then raise exception 'forbidden'; end if;
  -- Requests first, always: it is the row every writer contends on.
  select * into r from public.onsite_requests where id = o.request_id for update;
  if not found then raise exception 'request_not_found'; end if;

  if p_response = 'decline' then
    if o.response = 'declined' then return 'declined'; end if;      -- idempotent replay
    if o.response <> 'pending' then return 'already_answered'; end if;
    update public.onsite_dispatch_offers set response = 'declined', responded_at = now() where id = o.id;
    perform private.log_onsite_event(r.id, 'offer.declined', uid, jsonb_build_object('offer_id', o.id));
    perform private.settle_onsite_dispatch_if_exhausted(r.id);
    return 'declined';
  end if;

  if o.response = 'accepted' then return 'accepted'; end if;        -- winner replay
  if o.response = 'declined' then return 'already_answered'; end if;
  -- An invitation that closed because SOMEBODY ELSE won is not "you answered
  -- it" ظ¤ the provider tapped accept on a job that is already gone, and
  -- 'already_taken' is the only honest answer. An invitation that closed on its
  -- own deadline, while the job is still searching, is 'offer_expired'.
  if o.response = 'expired' then
    if r.provider_id is not null and r.provider_id <> uid then return 'already_taken'; end if;
    return 'offer_expired';
  end if;
  if o.offer_deadline_at <= now() then
    update public.onsite_dispatch_offers set response = 'expired', responded_at = now()
    where id = o.id and response = 'pending';
    perform private.log_onsite_event(r.id, 'offer.expired', uid, jsonb_build_object('offer_id', o.id));
    perform private.settle_onsite_dispatch_if_exhausted(r.id);
    return 'offer_expired';
  end if;

  -- Debt ceiling (F2b): the third "may this provider take work" state, checked
  -- after the suspension and documents guards, never instead of them. It sits
  -- after the replay, decline and expiry answers, immediately before the winner
  -- UPDATE. The predicate locks the provider's ledger account before it sums, so
  -- two concurrent accepts cannot both pass below the stop threshold. Here
  -- o.provider_id is the caller, already proven equal to uid above. Calls the
  -- private core, not the wrapper (see section D).
  v_ceiling := private.ceiling_decision(o.provider_id);
  if (v_ceiling ->> 'decision') <> 'allow' then
    raise exception '%', coalesce(v_ceiling ->> 'error_code', 'debt_ceiling_reached');
  end if;

  -- ---------------------------------------------------------------------
  -- THE GUARD. One statement decides the winner. status = 'dispatching' AND
  -- provider_id IS NULL are the concurrency predicate: a second session that
  -- was waiting on this row wakes up, re-checks the predicate against the new
  -- committed version, matches nothing, and gets 'already_taken' below. No
  -- advisory lock, no SELECT-then-check gap, no way to double-assign a job.
  -- ---------------------------------------------------------------------
  update public.onsite_requests
    set provider_id = uid,
        status = 'accepted',
        accepted_at = now(),
        accepted_price_toman = quoted_price_toman,
        payment_method = coalesce(payment_method, 'cash'),
        updated_at = now()
  where id = r.id and status = 'dispatching' and provider_id is null;
  if not found then
    if r.provider_id is not null then return 'already_taken'; end if;
    return 'dispatch_closed';                                        -- cancelled / terminal meanwhile
  end if;

  update public.onsite_dispatch_offers set response = 'accepted', responded_at = now()
  where id = o.id and response = 'pending';
  -- The other invitees lost this race; their invitations close. This is also
  -- what removes their read access to the request (see the read policies).
  update public.onsite_dispatch_offers set response = 'expired', responded_at = now()
  where request_id = r.id and response = 'pending' and provider_id <> uid;
  perform private.log_onsite_event(r.id, 'offer.accepted', uid,
    jsonb_build_object('offer_id', o.id, 'accepted_price_toman', r.quoted_price_toman, 'distance_km', o.distance_km));
  perform private.log_onsite_event(r.id, 'dispatch.closed', uid, jsonb_build_object('provider_id', uid));
  return 'accepted';
end $$;
revoke all on function public.respond_to_onsite_offer(uuid,text) from public, anon;
grant execute on function public.respond_to_onsite_offer(uuid,text) to authenticated;

-- --- D3. public.respond_to_price_revision(uuid, boolean, text) --------------
-- Source: 202611030000_offer_price_increase.sql lines 130-248.
-- Guard position: inside the OFFER-STAGE ACCEPT branch, immediately after the
-- two existing target checks (suspension, then documents). The caller here is
-- the CUSTOMER, who is never the provider and is never gated for their own
-- request, so the subject is the PROPOSING rescuer (o.provider_id). A check on
-- uid would gate the wrong person. The post-acceptance branch is not an accept
-- path for a new provider and is unchanged.
create or replace function public.respond_to_price_revision(
  p_revision_id uuid, p_accept boolean, p_reason text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  rev public.request_price_revisions%rowtype;
  r public.hauling_requests%rowtype;
  o public.hauling_dispatch_offers%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ceiling jsonb;
begin
  if uid is null then raise exception 'unauthorized'; end if;
  if p_accept is null then raise exception 'invalid_request'; end if;
  select * into rev from public.request_price_revisions where id = p_revision_id;
  if not found then raise exception 'revision_not_found'; end if;
  -- Requests first, always: the row every writer contends on.
  select * into r from public.hauling_requests where id = rev.request_id for update;
  if not found then raise exception 'request_not_found'; end if;
  if r.requester_id <> uid then raise exception 'forbidden'; end if;
  if rev.status <> 'pending' then raise exception 'invalid_transition'; end if;

  if rev.offer_id is not null then
    -- === OFFER-STAGE BRANCH (D-0048): before doing anything, prove the
    -- question is still answerable, evaluated at query time. ===============
    select * into o from public.hauling_dispatch_offers where id = rev.offer_id;
    if not found or o.response <> 'pending' or o.offer_deadline_at <= now() then
      raise exception 'offer_expired';
    end if;
    if r.status <> 'dispatching' or r.provider_id is not null then
      raise exception 'already_taken';
    end if;

    if p_accept then
      -- Acceptance is the moment work is taken: this branch ASSIGNS the job
      -- to a provider, so it is a "may this provider take on work" step,
      -- exactly like respond_to_dispatch_offer (202610280000 A5) -- same
      -- order (suspension, then documents), checked on the PROPOSING
      -- rescuer, not the caller (the caller is the customer, who is never
      -- suspended/document-gated for their own request). The proposal-time
      -- check in propose_dispatch_price_increase cannot cover a document
      -- rejection or a suspension that lands between the ask and the
      -- customer's answer -- TD-018's owner ruling is that an unapproved
      -- provider must not be able to take work either, at any entry point.
      if private.is_suspended(o.provider_id) then raise exception 'account_suspended'; end if;
      if not private.has_approved_documents(o.provider_id) then raise exception 'documents_not_approved'; end if;
      -- Debt ceiling (F2b): the third state, after the two above, never instead
      -- of them. The caller here is the CUSTOMER, so the subject is the PROPOSING
      -- rescuer (o.provider_id), never uid: testing the caller would gate the
      -- wrong person. The predicate locks the rescuer's ledger account before it
      -- sums, so two concurrent accepts cannot both pass below the stop threshold.
      -- Calls the private core, not the wrapper: the caller is the customer, and
      -- the wrapper's own-profile check would refuse every legitimate accept.
      v_ceiling := private.ceiling_decision(o.provider_id);
      if (v_ceiling ->> 'decision') <> 'allow' then
        raise exception '%', coalesce(v_ceiling ->> 'error_code', 'debt_ceiling_reached');
      end if;

      update public.request_price_revisions set
        status = 'accepted', decided_by = uid, decided_at = now(),
        decision_reason = coalesce(v_reason, '┘╛╪░█î╪▒┘╪ز┘ç ╪┤╪»')
      where id = p_revision_id;

      -- The same winner guard a normal acceptance uses (202610280000 section
      -- A5): the request row is already locked for update, so this cannot
      -- lose a race. provider_id is the PROPOSING rescuer (rev.proposed_by /
      -- o.provider_id) -- this call's own uid is the customer, not the
      -- winner.
      update public.hauling_requests
        set provider_id = o.provider_id,
            status = 'accepted',
            accepted_at = now(),
            accepted_price_toman = rev.revised_price_toman,
            payment_method = coalesce(payment_method, 'cash'),
            updated_at = now()
      where id = r.id and status = 'dispatching' and provider_id is null;
      if not found then raise exception 'already_taken'; end if;

      update public.hauling_dispatch_offers set response = 'accepted', responded_at = now()
      where id = o.id and response = 'pending';
      -- The other invitees lost this race; their invitations close, exactly
      -- as a normal acceptance closes them.
      update public.hauling_dispatch_offers set response = 'expired', responded_at = now()
      where request_id = r.id and response = 'pending' and provider_id <> o.provider_id;

      perform private.log_hauling_event(r.id, 'price.offer_increase_accepted', uid,
        jsonb_build_object('revision_id', p_revision_id, 'offer_id', o.id, 'revised_price_toman', rev.revised_price_toman));
      perform private.log_hauling_event(r.id, 'offer.accepted', o.provider_id,
        jsonb_build_object('offer_id', o.id, 'accepted_price_toman', rev.revised_price_toman, 'distance_km', o.distance_km));
      perform private.log_hauling_event(r.id, 'dispatch.closed', o.provider_id, jsonb_build_object('provider_id', o.provider_id));
    else
      if v_reason is null then raise exception 'reason_required'; end if;
      update public.request_price_revisions set
        status = 'rejected', decided_by = uid, decided_at = now(), decision_reason = v_reason
      where id = p_revision_id;
      -- D-0048: the base price stands, the refusing rescuer takes no
      -- penalty (a proposal inside the rule is not a fault) -- this closes
      -- that one invitation as a normal decline would, and nothing else.
      update public.hauling_dispatch_offers set response = 'declined', responded_at = now()
      where id = o.id and response = 'pending';
      perform private.log_hauling_event(r.id, 'price.offer_increase_rejected', uid,
        jsonb_build_object('revision_id', p_revision_id, 'offer_id', o.id, 'revised_price_toman', rev.revised_price_toman, 'reason', v_reason));
      -- "dispatch continues to the next rescuer" -- the same settlement call
      -- a normal decline makes.
      perform private.settle_hauling_dispatch_if_exhausted(r.id);
    end if;
    return;
  end if;

  -- === POST-ACCEPTANCE BRANCH: byte-identical to 202611020000's body. =====
  if p_accept then
    update public.request_price_revisions set
      status = 'accepted', decided_by = uid, decided_at = now(),
      decision_reason = coalesce(v_reason, '┘╛╪░█î╪▒┘╪ز┘ç ╪┤╪»')
    where id = p_revision_id;
    perform private.log_hauling_event(r.id, 'price.revision_accepted', uid,
      jsonb_build_object('revision_id', p_revision_id, 'revised_price_toman', rev.revised_price_toman));
  else
    if v_reason is null then raise exception 'reason_required'; end if;
    update public.request_price_revisions set
      status = 'rejected', decided_by = uid, decided_at = now(), decision_reason = v_reason
    where id = p_revision_id;
    update public.hauling_requests set
      provider_id = null, accepted_at = null, accepted_price_toman = null, payment_method = null,
      status = 'dispatching', dispatching_at = now(), updated_at = now()
    where id = r.id;
    perform private.log_hauling_event(r.id, 'price.revision_rejected', uid,
      jsonb_build_object('revision_id', p_revision_id, 'revised_price_toman', rev.revised_price_toman, 'reason', v_reason));
  end if;
end $$;
revoke all on function public.respond_to_price_revision(uuid, boolean, text) from public, anon;
grant execute on function public.respond_to_price_revision(uuid, boolean, text) to authenticated;

commit;
