begin;
-- Phase 4 / Admin Panel Completion -- independent review fix-forward.
-- Fixes exactly the two P2 findings from the independent review of
-- 011f006..12722df. Does not touch any already-applied migration file.

-- === P2-1: product_requests finality =========================================
-- review_product_request (202609300008) locked the target row but never
-- checked its current status before overwriting it, unlike its sibling
-- approve_discount_request/reject_discount_request (202609300005), which both
-- require status='pending'. An operator holding only requests.review could
-- therefore re-decide an already-approved/rejected request indefinitely.
-- 'pending' is the only status this RPC may act on -- once a request has been
-- decided (contacted/approved/rejected), review_product_request is done with
-- it; nothing else in the schema re-opens a decided request for further
-- review, so this is not a new workflow, only the same finality already
-- enforced on discount_requests. All existing validation, authorization
-- ('requests.review'), and the atomic audit write are unchanged.
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
  if req.status is distinct from 'pending' then raise exception 'request_not_pending'; end if;

  update public.product_requests set status = p_status, admin_notes = p_admin_notes, updated_at = now()
  where id = req.id;

  perform private.log_admin_action('review_product_request', 'product_requests', req.id::text, p_admin_notes,
    jsonb_build_object('status', p_status, 'seller_id', req.seller_id, 'previous_status', req.status));
  return req.id;
end $$;
-- Grants unchanged (already authenticated-only, no anon/public execute); a
-- bare CREATE OR REPLACE keeps them as-is, restated here for auditability.
revoke all on function public.review_product_request(bigint, text, text) from public, anon;
grant execute on function public.review_product_request(bigint, text, text) to authenticated;

-- === P2-2: make products.write real ===========================================
-- products.write has existed in the operator_permissions CHECK constraint and
-- in the grantable PERMISSION_KEYS set since Task 4.1, but nothing has ever
-- consumed it: product create/update/delete still went through the legacy
-- direct-client INSERT/UPDATE/DELETE path gated only on private.is_admin(),
-- with no audit trail -- the same shape the coupons/product_requests direct-
-- write paths were converted out of in 202609300008. This closes the same gap
-- for products: three audited SECURITY DEFINER RPCs, matching that reference
-- shape exactly (actor from auth.uid(), has_permission('products.write') check,
-- no client-supplied role/permission, mutation + log_admin_action atomic in
-- the same transaction), and the direct-table write path is removed.

drop policy admin_write on public.products;
revoke insert, update, delete on public.products from authenticated;

-- product_read previously only bypassed the is_active condition for Super
-- Admin. A products.write operator (not Super Admin) needs to see inactive
-- products too, to manage/re-activate them from the Store Admin Products
-- page -- same widening pattern already applied to offer_read/coupon_read/
-- order_read/request_read for their respective permissions.
drop policy product_read on public.products;
create policy product_read on public.products for select to anon, authenticated using (
  is_active is true or private.is_admin() or private.has_permission('products.write'));

create or replace function public.admin_create_product(
  p_name text, p_slug text, p_brand text, p_part_number text, p_description text, p_short_description text,
  p_category_id bigint, p_reference_price bigint, p_images jsonb, p_is_featured boolean
) returns bigint language plpgsql security definer set search_path = '' as $$
declare new_id bigint;
begin
  if auth.uid() is null or not private.has_permission('products.write') then raise exception 'forbidden'; end if;
  if coalesce(length(btrim(coalesce(p_name,''))),0) < 3 then raise exception 'invalid_name'; end if;
  if p_slug is null or length(p_slug) = 0 or length(p_slug) > 200 or p_slug !~ '^[a-z0-9-]+$' then raise exception 'invalid_slug'; end if;
  if p_category_id is not null and not exists(select 1 from public.categories where id = p_category_id) then raise exception 'category_not_found'; end if;
  if p_reference_price is not null and p_reference_price < 0 then raise exception 'invalid_reference_price'; end if;
  if coalesce(length(p_brand),0) > 200 or coalesce(length(p_part_number),0) > 200 then raise exception 'invalid_request'; end if;
  if coalesce(length(p_description),0) > 20000 or coalesce(length(p_short_description),0) > 2000 then raise exception 'invalid_request'; end if;
  if p_images is not null and jsonb_typeof(p_images) is distinct from 'array' then raise exception 'invalid_images'; end if;
  if p_is_featured is null then raise exception 'invalid_request'; end if;

  insert into public.products(
    name, slug, brand, part_number, description, short_description, category_id,
    reference_price, images, is_active, is_featured
  ) values (
    btrim(p_name), p_slug, nullif(btrim(coalesce(p_brand,'')),''), nullif(btrim(coalesce(p_part_number,'')),''),
    nullif(btrim(coalesce(p_description,'')),''), nullif(btrim(coalesce(p_short_description,'')),''),
    p_category_id, p_reference_price, coalesce(p_images,'[]'::jsonb), true, p_is_featured
  ) returning id into new_id;

  perform private.log_admin_action('create_product', 'products', new_id::text, null,
    jsonb_build_object('name', btrim(p_name), 'slug', p_slug));
  return new_id;
end $$;
revoke all on function public.admin_create_product(text,text,text,text,text,text,bigint,bigint,jsonb,boolean) from public, anon;
grant execute on function public.admin_create_product(text,text,text,text,text,text,bigint,bigint,jsonb,boolean) to authenticated;

create or replace function public.admin_update_product(
  p_product_id bigint, p_name text, p_slug text, p_brand text, p_part_number text, p_description text,
  p_short_description text, p_category_id bigint, p_reference_price bigint, p_images jsonb,
  p_is_active boolean, p_is_featured boolean
) returns bigint language plpgsql security definer set search_path = '' as $$
declare existing_name text;
begin
  if auth.uid() is null or not private.has_permission('products.write') then raise exception 'forbidden'; end if;
  if p_product_id is null then raise exception 'invalid_request'; end if;
  if coalesce(length(btrim(coalesce(p_name,''))),0) < 3 then raise exception 'invalid_name'; end if;
  if p_slug is null or length(p_slug) = 0 or length(p_slug) > 200 or p_slug !~ '^[a-z0-9-]+$' then raise exception 'invalid_slug'; end if;
  if p_category_id is not null and not exists(select 1 from public.categories where id = p_category_id) then raise exception 'category_not_found'; end if;
  if p_reference_price is not null and p_reference_price < 0 then raise exception 'invalid_reference_price'; end if;
  if coalesce(length(p_brand),0) > 200 or coalesce(length(p_part_number),0) > 200 then raise exception 'invalid_request'; end if;
  if coalesce(length(p_description),0) > 20000 or coalesce(length(p_short_description),0) > 2000 then raise exception 'invalid_request'; end if;
  if p_images is not null and jsonb_typeof(p_images) is distinct from 'array' then raise exception 'invalid_images'; end if;
  if p_is_active is null or p_is_featured is null then raise exception 'invalid_request'; end if;

  select name into existing_name from public.products where id = p_product_id for update;
  if existing_name is null then raise exception 'product_not_found'; end if;

  update public.products set
    name = btrim(p_name), slug = p_slug, brand = nullif(btrim(coalesce(p_brand,'')),''),
    part_number = nullif(btrim(coalesce(p_part_number,'')),''), description = nullif(btrim(coalesce(p_description,'')),''),
    short_description = nullif(btrim(coalesce(p_short_description,'')),''), category_id = p_category_id,
    reference_price = p_reference_price, images = coalesce(p_images,'[]'::jsonb),
    is_active = p_is_active, is_featured = p_is_featured, updated_at = now()
  where id = p_product_id;

  perform private.log_admin_action('update_product', 'products', p_product_id::text, null,
    jsonb_build_object('name', btrim(p_name), 'slug', p_slug, 'is_active', p_is_active));
  return p_product_id;
end $$;
revoke all on function public.admin_update_product(bigint,text,text,text,text,text,text,bigint,bigint,jsonb,boolean,boolean) from public, anon;
grant execute on function public.admin_update_product(bigint,text,text,text,text,text,text,bigint,bigint,jsonb,boolean,boolean) to authenticated;

create or replace function public.admin_delete_product(p_product_id bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare existing_name text;
begin
  if auth.uid() is null or not private.has_permission('products.write') then raise exception 'forbidden'; end if;
  if p_product_id is null then raise exception 'invalid_request'; end if;

  select name into existing_name from public.products where id = p_product_id for update;
  if existing_name is null then raise exception 'product_not_found'; end if;

  -- product_sellers has ON DELETE CASCADE on product_id (unchanged by this
  -- migration): deleting a product still removes its seller offers exactly as
  -- the legacy direct-client delete already did.
  delete from public.products where id = p_product_id;

  perform private.log_admin_action('delete_product', 'products', p_product_id::text, null,
    jsonb_build_object('name', existing_name));
  return p_product_id;
end $$;
revoke all on function public.admin_delete_product(bigint) from public, anon;
grant execute on function public.admin_delete_product(bigint) to authenticated;
commit;
