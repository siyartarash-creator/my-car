begin;
-- Phase 4 / Admin Panel Completion, Checkpoint B: Store Admin Module.
-- Brings two existing direct-table-write admin paths under audited
-- SECURITY DEFINER RPCs, per the locked audit rule (section 4): the business
-- mutation and its admin_audit_log entry must be atomic in the same
-- transaction. Both paths below previously wrote through a plain RLS
-- "admin_write"/"request_admin_update" policy gated only on
-- private.is_admin(), with no audit trail and no operator-permission path.
--
-- Table shapes are unchanged; only the write path moves from
-- "direct client UPDATE/INSERT/DELETE gated by RLS" to "SECURITY DEFINER
-- RPC gated by has_permission(), auditing atomically".

-- === A. Product request review (approval/rejection) ===========================
-- requests.review already exists in operator_permissions' fixed key set
-- (Task 4.1) but nothing consumed it yet.
drop policy request_admin_update on public.product_requests;
revoke update (status, admin_notes, updated_at) on public.product_requests from authenticated;

create or replace function public.review_product_request(p_request_id bigint, p_status text, p_admin_notes text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare req public.product_requests%rowtype;
begin
  if auth.uid() is null or not private.has_permission('requests.review') then raise exception 'forbidden'; end if;
  if p_request_id is null then raise exception 'invalid_request'; end if;
  if p_status is null or p_status not in ('contacted','approved','rejected') then raise exception 'invalid_status'; end if;
  if coalesce(length(p_admin_notes),0) > 2000 then raise exception 'invalid_request'; end if;

  select * into req from public.product_requests where id = p_request_id for update;
  if req.id is null then raise exception 'request_not_found'; end if;

  update public.product_requests set status = p_status, admin_notes = p_admin_notes, updated_at = now()
  where id = req.id;

  perform private.log_admin_action('review_product_request', 'product_requests', req.id::text, p_admin_notes,
    jsonb_build_object('status', p_status, 'seller_id', req.seller_id, 'previous_status', req.status));
  return req.id;
end $$;
revoke all on function public.review_product_request(bigint, text, text) from public, anon;
grant execute on function public.review_product_request(bigint, text, text) to authenticated;

-- === B. Coupon management (create / activate-deactivate / delete) ============
-- New permission key: coupons.manage. Genuinely required -- Store Admin
-- (section 8) explicitly includes "coupon management where current domain
-- supports it", and coupon create/update/delete is explicitly named in the
-- locked audit rule (section 4). No other operation on coupons exists in the
-- current admin UI (create, toggle is_active, delete only) -- no speculative
-- fields/verbs added.
alter table public.operator_permissions drop constraint operator_permissions_permission_key_check;
alter table public.operator_permissions add constraint operator_permissions_permission_key_check check (permission_key in (
  'products.write', 'offers.moderate', 'discounts.approve', 'requests.review', 'orders.read', 'coupons.manage'
));

drop policy admin_write on public.coupons;
revoke insert, update, delete on public.coupons from authenticated;
-- coupon_read (private.is_admin() only) predates operator permissions; widen
-- it the same way discount_request_read/product_sellers moderation reads
-- already are, so a coupons.manage operator can see what they manage.
drop policy coupon_read on public.coupons;
create policy coupon_read on public.coupons for select to authenticated using (private.is_admin() or private.has_permission('coupons.manage'));

create or replace function public.admin_create_coupon(
  p_code text, p_discount_type text, p_discount_value bigint, p_min_order_amount bigint,
  p_max_uses integer, p_max_uses_per_user integer, p_valid_until timestamptz, p_description text
) returns bigint language plpgsql security definer set search_path = '' as $$
declare new_id bigint; clean_code text;
begin
  if auth.uid() is null or not private.has_permission('coupons.manage') then raise exception 'forbidden'; end if;
  clean_code := upper(regexp_replace(coalesce(p_code,''), '\s', '', 'g'));
  if length(clean_code) < 3 or clean_code !~ '^[A-Z0-9_-]+$' then raise exception 'invalid_code'; end if;
  if p_discount_type not in ('percent','fixed') then raise exception 'invalid_discount_type'; end if;
  if p_discount_value is null or p_discount_value <= 0 then raise exception 'invalid_discount_value'; end if;
  if p_discount_type = 'percent' and p_discount_value > 100 then raise exception 'invalid_discount_value'; end if;
  if p_max_uses is not null and p_max_uses < 1 then raise exception 'invalid_max_uses'; end if;
  if p_max_uses_per_user is null or p_max_uses_per_user < 1 then raise exception 'invalid_max_uses_per_user'; end if;
  if coalesce(length(p_description),0) > 2000 then raise exception 'invalid_request'; end if;

  insert into public.coupons(code, discount_type, discount_value, min_order_amount, max_uses, max_uses_per_user, valid_until, description, is_active)
  values (clean_code, p_discount_type, p_discount_value, coalesce(p_min_order_amount,0), p_max_uses, p_max_uses_per_user, p_valid_until, nullif(btrim(p_description),''), true)
  returning id into new_id;

  perform private.log_admin_action('create_coupon', 'coupons', new_id::text, null,
    jsonb_build_object('code', clean_code, 'discount_type', p_discount_type, 'discount_value', p_discount_value));
  return new_id;
end $$;
revoke all on function public.admin_create_coupon(text,text,bigint,bigint,integer,integer,timestamptz,text) from public, anon;
grant execute on function public.admin_create_coupon(text,text,bigint,bigint,integer,integer,timestamptz,text) to authenticated;

create or replace function public.admin_set_coupon_active(p_coupon_id bigint, p_is_active boolean)
returns bigint language plpgsql security definer set search_path = '' as $$
declare code text;
begin
  if auth.uid() is null or not private.has_permission('coupons.manage') then raise exception 'forbidden'; end if;
  if p_coupon_id is null or p_is_active is null then raise exception 'invalid_request'; end if;
  select c.code into code from public.coupons c where c.id = p_coupon_id for update;
  if code is null then raise exception 'coupon_not_found'; end if;

  update public.coupons set is_active = p_is_active where id = p_coupon_id;

  perform private.log_admin_action(case when p_is_active then 'activate_coupon' else 'deactivate_coupon' end,
    'coupons', p_coupon_id::text, null, jsonb_build_object('code', code));
  return p_coupon_id;
end $$;
revoke all on function public.admin_set_coupon_active(bigint, boolean) from public, anon;
grant execute on function public.admin_set_coupon_active(bigint, boolean) to authenticated;

create or replace function public.admin_delete_coupon(p_coupon_id bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare code text;
begin
  if auth.uid() is null or not private.has_permission('coupons.manage') then raise exception 'forbidden'; end if;
  if p_coupon_id is null then raise exception 'invalid_request'; end if;
  select c.code into code from public.coupons c where c.id = p_coupon_id for update;
  if code is null then raise exception 'coupon_not_found'; end if;

  delete from public.coupons where id = p_coupon_id;

  perform private.log_admin_action('delete_coupon', 'coupons', p_coupon_id::text, null, jsonb_build_object('code', code));
  return p_coupon_id;
end $$;
revoke all on function public.admin_delete_coupon(bigint) from public, anon;
grant execute on function public.admin_delete_coupon(bigint) to authenticated;

-- === C. Offer visibility for the operators who moderate/decide on them ========
-- offer_read previously only bypassed the active/visible-to-buyers condition
-- for the Offer's own seller or a Super Admin. An offers.moderate operator
-- could not see (list, or read back after acting on) an inactive Offer, and
-- a discounts.approve operator could not see an Offer whose seller had it
-- hidden -- neither RPC's own authorization depends on this (both
-- authorize from has_permission() server-side, not from what the caller can
-- SELECT), but the Store Admin Offer-moderation and discount-request admin
-- pages need to list/display exactly those Offers. Same widening pattern
-- already applied above to coupon_read and discount_request_read.
drop policy offer_read on public.product_sellers;
create policy offer_read on public.product_sellers for select to anon, authenticated using (
  (is_active is true and is_hidden_by_seller is false and exists(select 1 from public.products p where p.id=product_id and p.is_active is true))
  or seller_id=auth.uid() or private.is_admin()
  or private.has_permission('offers.moderate') or private.has_permission('discounts.approve'));

-- === D. Order visibility for orders.read operators =============================
-- order_read previously only bypassed user_id=auth.uid() for Super Admin.
-- orders.read already exists in the fixed permission-key set (Task 4.1) but
-- nothing consumed it yet; Store Admin's read-only order inspection page
-- needs it. Read-only: no write grant/policy is added here.
drop policy order_read on public.orders;
create policy order_read on public.orders for select to authenticated using (
  user_id=auth.uid() or private.is_admin() or private.has_permission('orders.read'));
commit;
