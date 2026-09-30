begin;
-- Phase 4 / Task 4.2B: discount request approval / rejection.
-- Consumes the Task 4.2A discount_requests foundation (202609300004) and the
-- Task 4.1 has_permission/audit foundation (202609300003). No new table and
-- no schema change: both RPCs derive the Offer and seller identity from the
-- locked discount_requests row itself -- there is no client-supplied
-- offer/seller parameter to forge, so there is no cross-Offer / cross-request
-- IDOR surface at all.
--
-- Row lock order: product_sellers (the Offer) is always locked BEFORE
-- discount_requests (the Request) -- the same order save_offer uses (its
-- UPDATE on product_sellers happens, then its UPDATE on discount_requests
-- happens, inside the same transaction). approve_discount_request only
-- receives a request id, so it first takes a throwaway, UNLOCKED read of
-- discount_requests.offer_id purely to know which Offer row to lock; that
-- value is never trusted for any decision. Once the Offer row is locked, the
-- request row is locked and re-read, and every field the approval decision
-- depends on (existence, that it still belongs to the just-locked Offer,
-- that it is still pending, price match, discount validity) is re-checked
-- against that locked re-read -- never against the throwaway probe.
-- An earlier revision of this function locked the Request first and the
-- Offer second, which is the reverse of save_offer's order and forms a
-- classic deadlock cycle when an approval and a concurrent save_offer call
-- target the same Offer (one holds the Request row waiting on the Offer row
-- while the other holds the Offer row waiting on the Request row); fixed
-- here. reject_discount_request never locks product_sellers at all, so it
-- has no Offer/Request ordering to get wrong and is unchanged.

create or replace function public.approve_discount_request(p_request_id bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  probe_offer_id bigint;
  req public.discount_requests%rowtype;
  current_price bigint;
begin
  if auth.uid() is null or not private.has_permission('discounts.approve') then raise exception 'forbidden'; end if;
  if p_request_id is null then raise exception 'invalid_request'; end if;

  -- Unlocked probe: only used to find which Offer row to lock first. Not
  -- trusted for any authorization or business decision below.
  select offer_id into probe_offer_id from public.discount_requests where id = p_request_id;
  if probe_offer_id is null then raise exception 'request_not_found'; end if;

  select price into current_price from public.product_sellers where id = probe_offer_id for update;
  if current_price is null then raise exception 'offer_not_found'; end if;

  -- Now lock and re-read the request, with the Offer lock already held.
  select * into req from public.discount_requests where id = p_request_id for update;
  if req.id is null then raise exception 'request_not_found'; end if;
  -- The probe and the locked re-read must agree on which Offer this request
  -- is for; offer_id is never updated after a request is created, so this
  -- can only fail if the probed row no longer exists as read (already ruled
  -- out above) -- kept as a direct sanity check on the two-phase lookup.
  if req.offer_id is distinct from probe_offer_id then raise exception 'request_offer_mismatch'; end if;
  if req.status is distinct from 'pending' then raise exception 'request_not_pending'; end if;

  -- Revalidate against the CURRENT locked Offer, never the stale request snapshot:
  -- if the seller changed the base price since the request was filed, this
  -- approval fails atomically, the live Offer is not touched, and the request
  -- is left pending for explicit later handling (reject or a fresh request).
  if current_price is distinct from req.base_price_snapshot then
    raise exception 'stale_request_base_price_mismatch';
  end if;
  -- Structural revalidation against the locked current price (defense in
  -- depth -- already implied by the table's own check constraint plus the
  -- price-match above, but re-asserted explicitly here rather than assumed).
  if req.requested_discount_price <= 0 or req.requested_discount_price > current_price then
    raise exception 'invalid_request_state';
  end if;

  update public.product_sellers set discount_price = req.requested_discount_price, updated_at = now()
  where id = req.offer_id;

  update public.discount_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(), updated_at = now()
  where id = req.id;

  perform private.log_admin_action('approve_discount_request', 'discount_requests', req.id::text, null,
    jsonb_build_object('offer_id', req.offer_id, 'seller_id', req.seller_id,
      'requested_discount_price', req.requested_discount_price, 'base_price_snapshot', req.base_price_snapshot));
  return req.id;
end $$;
revoke all on function public.approve_discount_request(bigint) from public, anon;
grant execute on function public.approve_discount_request(bigint) to authenticated;

create or replace function public.reject_discount_request(p_request_id bigint, p_reason text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  req public.discount_requests%rowtype;
begin
  if auth.uid() is null or not private.has_permission('discounts.approve') then raise exception 'forbidden'; end if;
  if p_request_id is null then raise exception 'invalid_request'; end if;
  if coalesce(length(p_reason),0) > 2000 then raise exception 'invalid_request'; end if;

  select * into req from public.discount_requests where id = p_request_id for update;
  if req.id is null then raise exception 'request_not_found'; end if;
  if req.status is distinct from 'pending' then raise exception 'request_not_pending'; end if;

  -- Rejection never touches product_sellers: the live Offer (last approved
  -- price/discount_price) is left exactly as-is.
  update public.discount_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), updated_at = now()
  where id = req.id;

  perform private.log_admin_action('reject_discount_request', 'discount_requests', req.id::text, p_reason,
    jsonb_build_object('offer_id', req.offer_id, 'seller_id', req.seller_id));
  return req.id;
end $$;
revoke all on function public.reject_discount_request(bigint, text) from public, anon;
grant execute on function public.reject_discount_request(bigint, text) to authenticated;
commit;
