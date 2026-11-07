begin;
-- Finance step F1 (osaa/specs/finance.md section 4, row F1) -- the ledger
-- foundation ONLY. Section 2 of that spec is the architecture decision this
-- file carries out; nothing here wires a product behaviour. After this
-- migration the app behaves byte-for-byte as before: no existing function
-- body is edited, no trigger is added to a job table (hauling_requests,
-- onsite_requests, orders, service_requests), no screen changes. The only
-- new facts in the database are an empty ledger, one account row per
-- profile (and two platform accounts), and one settings row recording when
-- the ledger starts.
--
-- TECH-DEBT section E named four preconditions this step must satisfy. Each,
-- and how it is met here:
--
--   1. "Append-only debit/credit rows with SUM() balances (never a stored
--      balance column)." ledger_accounts carries no numeric column at all
--      (see its own comment below) and ledger_entries carries no running
--      total either -- a balance is always SUM(signed_amount) grouped by
--      account_id, computed on read. Append-only is not a promise: section C
--      below makes DELETE always fail and makes UPDATE fail for every column
--      except the one-shot settlement transition.
--
--   2. "Every entry snapshots the rate values it actually used, by value and
--      not only by row id." rate_snapshot is a NOT NULL jsonb object, and
--      public.post_ledger_transfer refuses an empty object ('{}'::jsonb) --
--      a rate ROW id alone is not a snapshot (commission is editable per
--      service type/vehicle/city/scope, spec section 1), so the caller must
--      hand over the computed numbers it actually used. Once written, the
--      row is append-only (precondition 1), so a later edit to the live
--      rate table can never retroactively change what an old entry reports.
--
--   3. "Settlement is idempotent through the same request_key/
--      pg_advisory_xact_lock discipline the request paths already use."
--      This step does not build settlement -- F3a does. What F1 contributes
--      is the schema fact F3a's idempotency will stand on: settled_in_run_id
--      can be set exactly once per row (section C, mechanism 1+2), and
--      re-applying the SAME run id is defined as a no-op rather than an
--      error. That is the "set at most once, idempotent repeat" shape the
--      request_key discipline already uses elsewhere in this codebase
--      (e.g. 202610100003's service_requests(buyer_id, request_key) unique
--      index + pg_advisory_xact_lock). Separately, post_ledger_transfer has
--      its OWN idempotency need (a network retry must not double-post one
--      economic event), and it is met the same way in spirit but by a
--      stronger mechanism than an advisory lock: the anti-duplicate unique
--      index (section B) is a declarative constraint that exists even when
--      no caller remembers to acquire a lock, so a concurrent duplicate
--      collides on the index itself (converted to 'duplicate_ledger_post')
--      rather than being merely serialized by a lock that a careless caller
--      could skip. No advisory lock is added inside post_ledger_transfer
--      because there is no pre-existing row to lock on -- F3a's settlement
--      run creation is the case that actually needs pg_advisory_xact_lock
--      (one calculation per provider per period, coordinated BEFORE any row
--      exists), and that lock is F3a's to add, not this step's.
--
--   4. "A documented reversal-entry type exists before the main settlement
--      path." reverses_entry_id, the reversal-fidelity trigger, and the
--      reversal-exempt half of the anti-duplicate index are all built now
--      (section B/C), before F3a's settlement path exists at all -- and
--      public.post_ledger_transfer (section D) is the ONLY way to write one:
--      a leg may carry reverses_entry_id, so a reversal posts through the
--      same single writer as every other entry instead of a second INSERT
--      path that would make requirement 8 below false.
--
-- ≡ا¤┤ NO HISTORICAL BACKFILL: no ledger entry is created for any job that
-- ended before this migration's cutover. The only rows this migration
-- writes outside the two new ledger tables are the account rows (which
-- carry no money -- see ledger_accounts below) and the single cutover
-- marker row in ledger_settings (section E.4). This is the owner's decision
-- recorded in osaa/specs/finance.md section 3 (2026-07-25): the commission
-- rate on any past job cannot be proven, so any backfill would be a guess,
-- and backdating debt could put a provider over their ceiling with no
-- warning the moment the migration runs.
--
-- The canonical reason string public.post_ledger_transfer callers must use
-- for a terminal cash job's collection event is 'job_cash_collected' -- F2a
-- is the step that will actually call post_ledger_transfer with this
-- reason, and the reconciliation query this file's own test suite proves
-- (tests/ledger-core.mjs) keys on exactly this string.
--
-- THE DEDUP INDEX, and why its leading three columns are not the whole key:
-- the brief that opened this step proposed a literal unique index on
-- (source_type, source_id, reason). That cannot work: a balanced transfer
-- (spec section 2 item 1) is, by definition, TWO rows that share the same
-- transfer_id and, for most events, the same source_type/source_id/reason
-- (e.g. a cash collection posts one leg on the provider's account and one
-- leg on platform.clearing, both reason 'job_cash_collected' for the SAME
-- source_id). A three-column unique index on (source_type, source_id,
-- reason) would accept the FIRST leg and reject the SECOND with the exact
-- same key -- i.e. it would make a balanced transfer unimplementable,
-- directly contradicting the zero-sum invariant and the requirement to
-- write both legs. Adding account_id to the key is the minimal fix that
-- keeps the triple as the key's leading prefix (so a future reporting query
-- can still use (source_type, source_id, reason) as an index prefix) while
-- letting the two legs of one call coexist under it.
-- Consequence for F2a, stated explicitly so it is not rediscovered the hard
-- way: post_ledger_transfer takes exactly ONE p_reason per call, so every
-- leg of a group shares that reason -- one call is therefore one reason and
-- one balanced PAIR (two legs, two DIFFERENT accounts); two legs on the SAME
-- account under one reason collide on ledger_entries_event_leg_unique. The
-- index itself would allow a same-account repeat, but only across two
-- DIFFERENT reasons -- a shape one call's single reason can never produce.
-- A terminal cash job's economics are therefore posted as separate EVENTS,
-- each its own call: 'job_cash_collected' (the provider's account debited
-- for the full invoice, platform.clearing credited), the provider's net
-- share as its own reason (the provider's account credited back,
-- platform.clearing debited), then 'job_commission' (platform.clearing ->
-- platform.revenue) -- the provider's net lands at exactly the commission
-- while the full invoice stays one real row. This is exactly what
-- tests/ledger-core.mjs's own test helper does. The reconciliation query
-- (below) keys on 'job_cash_collected' alone, so it stays exactly one group
-- per terminal cash job no matter how many other reasons later post against
-- the same source_id.
--
-- WHY post_ledger_transfer IS NOT CLIENT-CALLABLE: it accepts an arbitrary
-- jsonb array of legs with no restriction on which accounts or how much --
-- if any signed-in role could execute it, any account could mint or move
-- balance at will, including balances that are not their own. Revoking
-- execute from public/anon/authenticated and granting it to no role at all
-- is deliberate: the function's owner (the migration role) can always call
-- its own function regardless of grants, so F2a's state-transition RPCs --
-- themselves SECURITY DEFINER, owned by the same role -- can call
-- post_ledger_transfer as their owner without any grant ever being opened to
-- a client. That satisfies this step's requirement 8 ("the helper RPC is the
-- only writer") without creating a direct client write path.
--
-- WHAT IS DELIBERATELY NOT HERE, and which step owns it:
--   - settled_in_run_id has NO foreign key yet. public.settlement_runs does
--     not exist until F3a creates it; adding the FK now is not possible and
--     is not an oversight.
--   - can_accept_work(...) and the debt-ceiling predicate: F2b.
--   - Any consumer of post_ledger_transfer (commission, provider share,
--     cash, penalty, reversal postings): F2a.
--   - Any screen, wallet view, or settlement UI: F4 (and F3a for the
--     settlement run data itself).

-- === A. public.ledger_accounts -- one account per profile, plus the two
--         platform accounts =================================================
-- No balance column and no numeric column of any kind on this table: spec
-- section 2 item 9 says the balance is never cached. It is ALWAYS
-- SUM(signed_amount) over public.ledger_entries for a given account_id,
-- computed on read, never stored and never stale.
create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('profile', 'platform')),
  -- on delete cascade, not restrict: an ACCOUNT is an extension of the
  -- profile, not itself a financial record (house style for profile-owned
  -- rows -- compare public.rescuer_vehicle_documents.provider_id and
  -- public.onsite_provider_documents.provider_id). An account with no
  -- entries follows its profile out of the database. The financial-record
  -- guarantee this table needs lives on ledger_entries below instead: a
  -- profile that has ANY ledger history still cannot be deleted, because
  -- its entries pin both their account (restrict) and their author
  -- (actor_profile_id, restrict).
  profile_id uuid references public.profiles(id) on delete cascade,
  code text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint ledger_accounts_owner_check check (
    (kind = 'profile' and profile_id is not null and code is null)
    or (kind = 'platform' and profile_id is null and code is not null)
  ),
  constraint ledger_accounts_code_shape_check check (
    code is null or (code = lower(code) and char_length(code) between 3 and 60)
  )
);
create unique index ledger_accounts_profile_unique on public.ledger_accounts (profile_id) where profile_id is not null;
create unique index ledger_accounts_code_unique on public.ledger_accounts (code) where code is not null;

-- Exactly two platform accounts, seeded empty: platform.revenue is where
-- platform income (commission, penalties) lands; platform.clearing is the
-- counterparty of a collection leg -- cash a provider physically holds on
-- the platform's behalf. A third platform account later is a data row, not
-- a schema change.
insert into public.ledger_accounts (kind, code) values
  ('platform', 'platform.revenue'),
  ('platform', 'platform.clearing')
on conflict do nothing;

-- Auto-provisioning, direction 1: every profile that already exists resolves
-- to an account the moment this migration runs -- no manual step, ever.
insert into public.ledger_accounts (profile_id, kind)
select p.id, 'profile' from public.profiles p
on conflict do nothing;
-- Auto-provisioning, direction 2 (every profile that will ever exist): the
-- trigger is created in section E, after private.create_ledger_account() is
-- defined -- it inserts an ACCOUNT row only, never a financial row, so it
-- does not conflict with spec section 2 item 2's rule that no trigger
-- writes a ledger entry.

-- === B. public.ledger_entries -- append-only, double-entry, integer toman =
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  -- The legs of one economic event share this id; SUM(signed_amount) over
  -- one transfer_id is always zero (enforced in section C, mechanism 3).
  transfer_id uuid not null,
  -- restrict, NOT cascade like ledger_accounts.profile_id above: once a
  -- single entry exists, the account it names is a financial record, not a
  -- bare profile extension, and must survive for as long as the entry does.
  account_id uuid not null references public.ledger_accounts(id) on delete restrict,
  signed_amount bigint not null check (signed_amount <> 0),
  reason text not null check (char_length(reason) between 1 and 64 and btrim(reason) = reason),
  source_type text not null check (source_type in ('hauling_request', 'onsite_request', 'order', 'manual')),
  source_id uuid not null,
  reverses_entry_id uuid references public.ledger_entries(id) on delete restrict,
  -- Nullable; set at MOST once (section C, mechanisms 1+2). NO foreign key
  -- yet -- public.settlement_runs does not exist until F3a creates it; this
  -- is a deliberate gap this step leaves open, not an oversight (see header).
  settled_in_run_id uuid,
  rate_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(rate_snapshot) = 'object'),
  -- restrict, for the same reason as account_id above: the entry pins its
  -- author too, so a profile with any ledger history -- as an account
  -- holder OR as the actor who posted an entry -- cannot be deleted. Between
  -- the two restrict FKs here and the cascade on ledger_accounts.profile_id,
  -- a profile with zero entries can still be deleted (its bare account goes
  -- with it), but one with even a single entry never can.
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint ledger_entries_reversal_not_self_check check (reverses_entry_id <> id)
  -- No updated_at (append-only rows are never edited in place beyond the one
  -- settlement transition, which touches only settled_in_run_id -- tracking
  -- that with a generic updated_at would invite exactly the kind of
  -- "quietly edited" field this table must never have).
  -- No currency column -- multi-currency is deferred to the gateway phase
  -- (spec section 7). No soft-delete flag -- deletion is never legal here.
);
create index ledger_entries_transfer_idx on public.ledger_entries (transfer_id);
create index ledger_entries_account_idx on public.ledger_entries (account_id);
create index ledger_entries_source_idx on public.ledger_entries (source_type, source_id);
-- Do not invent more indexes -- the spec says measure before optimizing
-- (spec section 2 item 9's closing line).

-- THE ANTI-DUPLICATE INDEX -- the whole point of this step. See the header
-- for the counter-example that rules out the literal (source_type,
-- source_id, reason) triple and the F2a consequence it implies.
create unique index ledger_entries_event_leg_unique
  on public.ledger_entries (source_type, source_id, reason, account_id)
  where reverses_entry_id is null;

-- One reversal per original leg, and no reversal of a reversal (the second
-- half of that rule is enforced by the trigger in section C, mechanism 4;
-- this index enforces the first half declaratively).
create unique index ledger_entries_reversal_unique
  on public.ledger_entries (reverses_entry_id)
  where reverses_entry_id is not null;

-- === C. The three enforcement mechanisms (four trigger functions) --
--        append-only is enforced, not promised ==============================

-- Mechanism 1: a BEFORE trigger raises the SPECIFIC error for tampering with
-- settled_in_run_id (nulling it or changing it to a different value) BEFORE
-- mechanism 2's generic append-only check would otherwise catch the same
-- row under a less informative message -- a BEFORE trigger always fires
-- before an AFTER one, which is what makes this specific error reachable.
create function private.ledger_entries_guard_settled() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.settled_in_run_id is not null
     and (new.settled_in_run_id is null or new.settled_in_run_id is distinct from old.settled_in_run_id) then
    raise exception 'settled_in_run_id_is_immutable';
  end if;
  return new;
end $$;
revoke all on function private.ledger_entries_guard_settled() from public, anon, authenticated;
create trigger ledger_entries_guard_settled before update on public.ledger_entries
  for each row execute function private.ledger_entries_guard_settled();

-- Mechanism 2: DELETE is always illegal. UPDATE is legal in exactly two
-- cases -- the one-shot settlement transition (null -> a run id) or an
-- idempotent re-settle (the same run id written again) -- and in both cases
-- every OTHER column must be unchanged. A rule that forbade every UPDATE
-- outright would make F3a impossible: settled_in_run_id is set AT
-- settlement time, which is necessarily an UPDATE of an existing row. "Set
-- at most once, never changed once set except to itself, never nulled" is
-- the actual invariant -- not "no UPDATE ever".
create function private.ledger_entries_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ledger_entries_are_append_only';
  end if;

  if not (
    (old.settled_in_run_id is null and new.settled_in_run_id is not null)
    or (old.settled_in_run_id is not null and new.settled_in_run_id is not null
        and new.settled_in_run_id = old.settled_in_run_id)
  ) then
    raise exception 'ledger_entries_are_append_only';
  end if;

  if new.transfer_id is distinct from old.transfer_id
     or new.account_id is distinct from old.account_id
     or new.signed_amount is distinct from old.signed_amount
     or new.reason is distinct from old.reason
     or new.source_type is distinct from old.source_type
     or new.source_id is distinct from old.source_id
     or new.reverses_entry_id is distinct from old.reverses_entry_id
     or new.rate_snapshot is distinct from old.rate_snapshot
     or new.actor_profile_id is distinct from old.actor_profile_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'ledger_entries_are_append_only';
  end if;
  return null;
end $$;
revoke all on function private.ledger_entries_append_only() from public, anon, authenticated;
create constraint trigger ledger_entries_append_only after update or delete on public.ledger_entries
  deferrable initially immediate for each row execute function private.ledger_entries_append_only();

-- Mechanism 3: the zero-sum invariant as a SCHEMA fact, not just something
-- post_ledger_transfer happens to check before it inserts. Deferred ON
-- PURPOSE: all the legs of one event land in one statement (one INSERT ...
-- SELECT), and the group is only complete once every leg has been inserted
-- -- checking per-row immediately would reject the first leg of every
-- transfer for being, by itself, unbalanced. This makes the invariant hold
-- even for a caller that bypasses post_ledger_transfer entirely.
create function private.ledger_entries_balanced_transfer() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select coalesce(sum(signed_amount), 0) from public.ledger_entries where transfer_id = new.transfer_id) <> 0 then
    raise exception 'unbalanced_transfer';
  end if;
  return null;
end $$;
revoke all on function private.ledger_entries_balanced_transfer() from public, anon, authenticated;
create constraint trigger ledger_entries_balanced_transfer after insert on public.ledger_entries
  deferrable initially deferred for each row execute function private.ledger_entries_balanced_transfer();

-- Mechanism 4: a reversal row must negate its original exactly. Reversal
-- rows are exempt from the anti-duplicate index (section B) precisely so a
-- correction can be posted at all -- this trigger is what keeps that
-- exemption from being an opening for an imprecise or malicious "reversal".
create function private.ledger_entries_reversal_fidelity() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_original public.ledger_entries%rowtype;
begin
  if new.reverses_entry_id is null then
    return new;
  end if;

  select * into v_original from public.ledger_entries where id = new.reverses_entry_id;
  if not found then
    raise exception 'entry_not_found';
  end if;
  if v_original.reverses_entry_id is not null then
    raise exception 'reversal_of_reversal';
  end if;
  if new.account_id is distinct from v_original.account_id
     or new.signed_amount <> -v_original.signed_amount
     or new.source_type is distinct from v_original.source_type
     or new.source_id is distinct from v_original.source_id
  then
    raise exception 'invalid_reversal';
  end if;
  return new;
end $$;
revoke all on function private.ledger_entries_reversal_fidelity() from public, anon, authenticated;
create trigger ledger_entries_reversal_fidelity before insert on public.ledger_entries
  for each row execute function private.ledger_entries_reversal_fidelity();

-- === D. public.post_ledger_transfer -- the central posting helper, the
--        ONLY writer ========================================================
-- A leg is a two-key object ({account_id, signed_amount}) for an ordinary
-- posting, or a three-key object ({account_id, signed_amount,
-- reverses_entry_id}) for a reversal leg -- any other key count is
-- invalid_leg. The reversal reference lives on the LEG rather than behind a
-- separate reversal function: requirement 8 ("the helper RPC is the only
-- writer") and this step's own idempotency rule (the anti-duplicate index,
-- with its one exemption for reversals) already live on
-- post_ledger_transfer, so a second entry point would just be a second place
-- to keep both in sync, for no gain -- a reversal is still only a balanced
-- transfer whose legs happen to negate an earlier one, which the existing
-- reversal-fidelity trigger (section C, mechanism 4) already verifies
-- row-by-row no matter which statement performed the INSERT.
create function public.post_ledger_transfer(
  p_source_type text, p_source_id uuid, p_reason text, p_legs jsonb, p_rate_snapshot jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := coalesce(p_reason, '');
  v_transfer_id uuid;
  v_leg jsonb;
  v_key_count int;
  v_account_id uuid;
  v_signed_amount bigint;
  v_reverses_entry_id uuid;
  v_sum bigint := 0;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  if p_source_type is null or p_source_type not in ('hauling_request', 'onsite_request', 'order', 'manual') then
    raise exception 'invalid_source_type';
  end if;

  if v_reason = '' or char_length(v_reason) > 64 or btrim(v_reason) <> v_reason then
    raise exception 'invalid_reason';
  end if;

  -- A rate ROW id alone is not a snapshot (commission is editable per
  -- service type/vehicle/city/scope) -- requiring a non-empty object is
  -- what turns that into a rule instead of a hope.
  if p_rate_snapshot is null then raise exception 'invalid_rate_snapshot'; end if;
  if jsonb_typeof(p_rate_snapshot) <> 'object' then raise exception 'invalid_rate_snapshot'; end if;
  if p_rate_snapshot = '{}'::jsonb then raise exception 'invalid_rate_snapshot'; end if;

  if p_legs is null or jsonb_typeof(p_legs) <> 'array' then raise exception 'invalid_legs'; end if;
  if jsonb_array_length(p_legs) < 2 then raise exception 'invalid_legs'; end if;

  for v_leg in select * from jsonb_array_elements(p_legs) loop
    if jsonb_typeof(v_leg) <> 'object' then raise exception 'invalid_leg'; end if;
    v_key_count := (select count(*) from jsonb_object_keys(v_leg));
    if v_key_count <> 2 and v_key_count <> 3 then raise exception 'invalid_leg'; end if;
    if not (v_leg ? 'account_id') or not (v_leg ? 'signed_amount') then raise exception 'invalid_leg'; end if;
    if v_key_count = 3 and not (v_leg ? 'reverses_entry_id') then raise exception 'invalid_leg'; end if;
    v_reverses_entry_id := null;
    begin
      v_account_id := (v_leg ->> 'account_id')::uuid;
      v_signed_amount := (v_leg ->> 'signed_amount')::bigint;
      if v_key_count = 3 then
        v_reverses_entry_id := (v_leg ->> 'reverses_entry_id')::uuid;
      end if;
    exception when others then
      raise exception 'invalid_leg';
    end;
    -- A JSON null under any key casts to a SQL NULL with no error raised
    -- above; left unchecked, a NULL signed_amount would silently poison the
    -- running sum below (NULL + anything = NULL, so v_sum <> 0 would never
    -- fire), a NULL account_id would merely surface later as the wrong error
    -- (account_not_found instead of invalid_leg), and a NULL
    -- reverses_entry_id on a three-key leg would silently become an
    -- ordinary leg instead of being refused. All three are rejected here,
    -- explicitly.
    if v_account_id is null or v_signed_amount is null then raise exception 'invalid_leg'; end if;
    if v_key_count = 3 and v_reverses_entry_id is null then raise exception 'invalid_leg'; end if;
    if v_signed_amount = 0 then raise exception 'invalid_leg'; end if;
    v_sum := v_sum + v_signed_amount;
  end loop;

  if v_sum <> 0 then raise exception 'unbalanced_transfer'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_legs) e
    where not exists (
      select 1 from public.ledger_accounts a
      where a.id = (e ->> 'account_id')::uuid and a.is_active is true
    )
  ) then
    raise exception 'account_not_found';
  end if;

  v_transfer_id := gen_random_uuid();
  -- No autonomous transaction, no COMMIT, no swallowed exception: these legs
  -- are written INSIDE the caller's transaction, so a caller that rolls back
  -- rolls the posting back with it.
  begin
    insert into public.ledger_entries (
      transfer_id, account_id, signed_amount, reason, source_type, source_id, rate_snapshot, actor_profile_id, reverses_entry_id
    )
    select v_transfer_id, (e ->> 'account_id')::uuid, (e ->> 'signed_amount')::bigint,
           v_reason, p_source_type, p_source_id, p_rate_snapshot, v_uid, (e ->> 'reverses_entry_id')::uuid
    from jsonb_array_elements(p_legs) e;
  exception when unique_violation then
    raise exception 'duplicate_ledger_post';
  end;

  return v_transfer_id;
end $$;
-- No client role may execute this function, ever -- see the header for why.
-- F2a's SECURITY DEFINER state-transition RPCs call it as their OWNER
-- (which always retains implicit execute rights on its own functions
-- regardless of this revoke), satisfying "the helper RPC is the only
-- writer" without opening a direct client write path.
revoke all on function public.post_ledger_transfer(text, uuid, text, jsonb, jsonb) from public, anon, authenticated;

-- === E. Auto-provisioning trigger + RLS + the cutover marker ===============

-- This writes an ACCOUNT row, never a financial row -- it does not
-- contradict spec section 2 item 2's rule that no trigger writes a ledger
-- entry.
create function private.create_ledger_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ledger_accounts (profile_id, kind) values (new.id, 'profile')
  on conflict do nothing;
  return new;
end $$;
revoke all on function private.create_ledger_account() from public, anon, authenticated;
create trigger mycar_create_ledger_account after insert on public.profiles
  for each row execute function private.create_ledger_account();

alter table public.ledger_accounts enable row level security;
revoke all on public.ledger_accounts from public, anon, authenticated;
grant select on public.ledger_accounts to authenticated;
-- A platform account (profile_id is null) is admin-only by construction:
-- the OR's first branch can never be true for one.
create policy ledger_accounts_read on public.ledger_accounts for select to authenticated
  using (profile_id = auth.uid() or private.is_admin());
-- No insert/update/delete grant to any role, admin included: accounts are
-- created by the trigger/backfill above, never by a client.

alter table public.ledger_entries enable row level security;
revoke all on public.ledger_entries from public, anon, authenticated;
grant select on public.ledger_entries to authenticated;
create policy ledger_entries_read on public.ledger_entries for select to authenticated
  using (
    exists (
      select 1 from public.ledger_accounts a
      where a.id = account_id and (a.profile_id = auth.uid() or private.is_admin())
    )
  );
-- No write grant to anyone -- public.post_ledger_transfer is the only writer.

create table public.ledger_settings (
  key text primary key,
  value text not null,
  note text,
  created_at timestamptz not null default now()
);
alter table public.ledger_settings enable row level security;
revoke all on public.ledger_settings from public, anon, authenticated;
grant select on public.ledger_settings to authenticated;
create policy ledger_settings_read on public.ledger_settings for select to authenticated
  using (private.is_admin());

-- The cutover marker lives in the LEDGER's own settings table, deliberately
-- NOT in public.site_settings: a seeded site_settings key that no screen
-- reads is an orphan that fails the TD-012 key guard
-- (scripts/check-site-setting-keys.mjs), and a cutover timestamp is not
-- owner-editable copy text, so it must not sit in that table pretending to
-- be one. now() is evaluated when this migration is actually applied, so
-- the stored value is the real cutover date; on conflict do nothing means
-- re-running this migration changes nothing.
insert into public.ledger_settings (key, value, note) values (
  'ledger_cutover_at',
  to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'the ledger starts here; no entry exists for anything older (owner decision: no historical backfill)'
) on conflict (key) do nothing;
commit;
