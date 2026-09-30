begin;
-- Phase 4 / Task 4.3: offer moderation foundation (activate/deactivate only).
-- Consumes the Task 4.1 has_permission/admin_audit_log foundation. No new
-- table, no schema change, no generic moderation framework: two narrow RPCs
-- that moderate exactly product_sellers.is_active and nothing else.
--
-- product_sellers already has no insert/update/delete grant to any client
-- role (202609290001_security_foundation.sql) -- every write goes through a
-- SECURITY DEFINER function owned by the table owner. save_offer
-- (202609300004_discount_requests.sql) hardcodes is_active=true on insert
-- and never assigns it on update, so a seller has no path -- through
-- save_offer, a crafted RPC call, or a direct table write -- to flip
-- is_active themselves. These two RPCs are therefore the only place
-- is_active can ever change, and both require offers.moderate.
--
-- Lock scope: each RPC locks exactly one product_sellers row and touches no
-- other table's row before or after it, so there is no multi-resource lock
-- order to get wrong (unlike approve_discount_request/save_offer, which both
-- lock product_sellers and discount_requests and must agree on order).

create or replace function public.deactivate_offer(p_offer_id bigint, p_reason text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare seller_id uuid; product_id bigint;
begin
  if auth.uid() is null or not private.has_permission('offers.moderate') then raise exception 'forbidden'; end if;
  if p_offer_id is null then raise exception 'invalid_request'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 or length(p_reason) > 2000 then raise exception 'invalid_reason'; end if;

  select ps.seller_id, ps.product_id into seller_id, product_id
    from public.product_sellers ps where ps.id = p_offer_id for update;
  if not found then raise exception 'offer_not_found'; end if;

  update public.product_sellers set is_active = false, updated_at = now() where id = p_offer_id;

  perform private.log_admin_action('deactivate_offer', 'product_sellers', p_offer_id::text, p_reason,
    jsonb_build_object('seller_id', seller_id, 'product_id', product_id));
  return p_offer_id;
end $$;
revoke all on function public.deactivate_offer(bigint, text) from public, anon;
grant execute on function public.deactivate_offer(bigint, text) to authenticated;

create or replace function public.activate_offer(p_offer_id bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare seller_id uuid; product_id bigint;
begin
  if auth.uid() is null or not private.has_permission('offers.moderate') then raise exception 'forbidden'; end if;
  if p_offer_id is null then raise exception 'invalid_request'; end if;

  select ps.seller_id, ps.product_id into seller_id, product_id
    from public.product_sellers ps where ps.id = p_offer_id for update;
  if not found then raise exception 'offer_not_found'; end if;

  update public.product_sellers set is_active = true, updated_at = now() where id = p_offer_id;

  perform private.log_admin_action('activate_offer', 'product_sellers', p_offer_id::text, null,
    jsonb_build_object('seller_id', seller_id, 'product_id', product_id));
  return p_offer_id;
end $$;
revoke all on function public.activate_offer(bigint) from public, anon;
grant execute on function public.activate_offer(bigint) to authenticated;
commit;
