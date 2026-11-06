begin;

-- Rollback for 202611060000_ledger_debt_ceiling.sql (WU-FINANCE-F2b).
--
-- Restores the schema to exactly what it is without that migration:
--   - drops the predicate, the decision core, its row-selection helper and the
--     ceiling data table;
--   - recreates the three accept-path bodies verbatim from the migrations that
--     defined them before F2b (the source file and line range are named above
--     each one), with their revoke/grant lines re-issued as the sources have them.
-- It is idempotent: running it twice is safe.
--
-- It does NOT touch ledger_entries, ledger_accounts, ledger_settings or
-- post_ledger_transfer. Those are F1's and F2a's to undo, not this migration's.
-- It writes no ledger row, and it moves no balance.

-- The predicate first: the three accept bodies that call it are recreated
-- below, so nothing left behind refers to it.
drop function if exists public.can_accept_work(uuid);
drop function if exists private.ceiling_decision(uuid);
-- The helper's return type is the table below, so it goes before the table.
drop function if exists private.ledger_debt_ceiling_for(text);
drop table if exists public.ledger_debt_ceilings;

-- --- D1. public.respond_to_dispatch_offer(uuid, text) ----------------------
-- Source: 202610280000_documents_gate_provider_work.sql lines 113-194.
create or replace function public.respond_to_dispatch_offer(p_offer_id uuid, p_response text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  o public.hauling_dispatch_offers%rowtype;
  r public.hauling_requests%rowtype;
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
create or replace function public.respond_to_onsite_offer(p_offer_id uuid, p_response text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  o public.onsite_dispatch_offers%rowtype;
  r public.onsite_requests%rowtype;
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
create or replace function public.respond_to_price_revision(
  p_revision_id uuid, p_accept boolean, p_reason text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  rev public.request_price_revisions%rowtype;
  r public.hauling_requests%rowtype;
  o public.hauling_dispatch_offers%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
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
