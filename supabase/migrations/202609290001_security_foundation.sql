begin;
-- Target: observed My Car public schema. Run preflight and backup before rollout.
create schema if not exists private;
revoke create on schema public from public, anon, authenticated;
-- Future objects created by the migration owner start closed; grant deliberately.
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and is_admin is true);
$$;
create or replace function private.is_seller() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and user_type = 'seller');
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$ select private.is_admin(); $$;
revoke all on function private.is_admin(), private.is_seller(), public.is_admin() from public;
grant execute on function private.is_admin(), private.is_seller(), public.is_admin() to anon, authenticated;

-- Replace overlapping permissive policies, including any PUBLIC grants.
do $$ declare t text; p record; c record;
begin
  foreach t in array array['profiles','categories','products','product_sellers','product_compatibility','product_requests','orders','order_items','coupons','coupon_usages','payouts','sms_logs','sms_templates'] loop
    execute format('alter table public.%I enable row level security',t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I',p.policyname,t);
    end loop;
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    for c in select column_name from information_schema.columns where table_schema='public' and table_name=t loop
      execute format('revoke all (%I) on public.%I from public, anon, authenticated',c.column_name,t);
    end loop;
  end loop;
end $$;

grant select on public.categories, public.products, public.product_sellers, public.product_compatibility to anon, authenticated;
grant select on public.profiles, public.orders, public.order_items, public.coupons, public.coupon_usages, public.product_requests, public.payouts, public.sms_logs, public.sms_templates to authenticated;
grant update (name, avatar_type, avatar_value, city, region, address, phone1, phone2, working_hours, social_links, about, updated_at, data, address_data) on public.profiles to authenticated;
create policy profile_read on public.profiles for select to authenticated using (id=auth.uid() or private.is_admin());
create policy profile_edit on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());

create or replace function private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare kind text := coalesce(new.raw_user_meta_data->>'user_type','owner');
begin
  if kind not in ('owner','seller','service','rescuer') then raise exception 'invalid_profile_type'; end if;
  if coalesce(length(btrim(new.raw_user_meta_data->>'name')),0) < 3 or
    coalesce(new.raw_user_meta_data->>'mobile','') !~ '^09[0-9]{9}$' then raise exception 'invalid_profile'; end if;
  insert into public.profiles(id,user_type,name,mobile,is_admin)
  values(new.id,kind,btrim(new.raw_user_meta_data->>'name'),new.raw_user_meta_data->>'mobile',false);
  return new;
end $$;
revoke all on function private.create_profile() from public, anon, authenticated;
create trigger mycar_create_profile after insert on auth.users for each row execute function private.create_profile();

create policy category_read on public.categories for select to anon, authenticated using (true);
create policy product_read on public.products for select to anon, authenticated using (is_active is true or private.is_admin());
create policy compatibility_read on public.product_compatibility for select to anon, authenticated using (exists(select 1 from public.products p where p.id=product_id));
create policy offer_read on public.product_sellers for select to anon, authenticated using (
  (is_active is true and is_hidden_by_seller is false and exists(select 1 from public.products p where p.id=product_id and p.is_active is true))
  or seller_id=auth.uid() or private.is_admin());
create policy request_read on public.product_requests for select to authenticated using (seller_id=auth.uid() or private.is_admin());
create policy request_insert on public.product_requests for insert to authenticated with check (seller_id=auth.uid() and private.is_seller() and status='pending' and admin_notes is null);
grant insert (seller_id,seller_name,seller_mobile,product_name,brand,photo_url) on public.product_requests to authenticated;
grant update (status,admin_notes,updated_at) on public.product_requests to authenticated;
create policy request_admin_update on public.product_requests for update to authenticated using (private.is_admin()) with check (private.is_admin());

do $$ declare t text;
begin
  foreach t in array array['categories','products','product_compatibility','coupons','sms_templates'] loop
    execute format('grant insert, update, delete on public.%I to authenticated',t);
    execute format('create policy admin_write on public.%I for all to authenticated using (private.is_admin()) with check (private.is_admin())',t);
  end loop;
end $$;
create policy coupon_read on public.coupons for select to authenticated using (private.is_admin());
create policy order_read on public.orders for select to authenticated using (user_id=auth.uid() or private.is_admin());
create policy item_read on public.order_items for select to authenticated using (seller_id=auth.uid() or private.is_admin() or exists(select 1 from public.orders o where o.id=order_id));
create policy usage_read on public.coupon_usages for select to authenticated using (user_id=auth.uid() or private.is_admin());
create policy payout_read on public.payouts for select to authenticated using (seller_id=auth.uid() or private.is_admin());
create policy sms_log_read on public.sms_logs for select to authenticated using (private.is_admin());

-- Seller offers use one server-side function; ownership and moderation cannot be changed via REST.
alter table public.product_sellers add constraint phase1_offer_valid check (
  product_id is not null and seller_id is not null and price > 0 and stock is not null and stock >= 0
  and (discount_price is null or (discount_price > 0 and discount_price <= price))
) not valid;
-- NOT VALID preserves legacy rows while enforcing the contract on every new write.
create or replace function public.save_offer(p_product_id bigint, p_offer_id bigint, p_price bigint,
  p_discount_price bigint, p_stock integer, p_warranty text, p_shipping text, p_notes text, p_hidden boolean)
returns bigint language plpgsql security definer set search_path = '' as $$
declare result_id bigint; seller_name text;
begin
  if auth.uid() is null or not private.is_seller() then raise exception 'forbidden'; end if;
  if p_price is null or p_price <= 0 or p_price > 1000000000000 or p_stock is null or p_stock < 0 or p_stock > 1000000
    or p_hidden is null or (p_discount_price is not null and (p_discount_price <= 0 or p_discount_price > p_price))
    or coalesce(length(p_notes),0)>2000 or coalesce(length(p_shipping),0)>1000 or coalesce(length(p_warranty),0)>1000
    then raise exception 'invalid_offer'; end if;
  if not exists(select 1 from public.products where id=p_product_id and is_active is true) then raise exception 'product_unavailable'; end if;
  select name into seller_name from public.profiles where id=auth.uid();
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':offer:'||p_product_id::text,0));
  if p_offer_id is null then
    if exists(select 1 from public.product_sellers where product_id=p_product_id and seller_id=auth.uid()) then raise exception 'offer_exists'; end if;
    insert into public.product_sellers(product_id,seller_id,seller_name,price,discount_price,stock,warranty,shipping,notes,is_hidden_by_seller,is_active)
    values(p_product_id,auth.uid(),seller_name,p_price,p_discount_price,p_stock,p_warranty,p_shipping,p_notes,p_hidden,true) returning id into result_id;
  else
    update public.product_sellers set price=p_price,discount_price=p_discount_price,stock=p_stock,
      warranty=p_warranty,shipping=p_shipping,notes=p_notes,is_hidden_by_seller=p_hidden
    where id=p_offer_id and product_id=p_product_id and seller_id=auth.uid() returning id into result_id;
    if result_id is null then raise exception 'offer_not_found'; end if;
  end if;
  return result_id;
end $$;
revoke all on function public.save_offer(bigint,bigint,bigint,bigint,integer,text,text,text,boolean) from public,anon;
grant execute on function public.save_offer(bigint,bigint,bigint,bigint,integer,text,text,text,boolean) to authenticated;

create function private.request_identity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  select name,mobile into new.seller_name,new.seller_mobile from public.profiles where id=auth.uid();
  return new;
end $$;
revoke all on function private.request_identity() from public,anon,authenticated;
create trigger mycar_request_identity before insert on public.product_requests for each row execute function private.request_identity();

-- Scope sequence privileges to tables that clients are allowed to insert into.
revoke all on all sequences in schema public from public, anon, authenticated;
grant usage on sequence public.categories_id_seq,public.products_id_seq,public.product_compatibility_id_seq,
 public.product_requests_id_seq,public.coupons_id_seq,public.sms_templates_id_seq to authenticated;

-- Storage bucket write policies in the supplied inventory were not owner-scoped.
do $$ declare p record;
begin
  if exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname not in (
    'Auth users can delete own avatar','Auth users can delete product images','Auth users can update own avatar',
    'Auth users can update product images','Auth users can upload avatars','Auth users can upload product images',
    'Public read avatars','Public read product images')) then raise exception 'unexpected_storage_policy_review_required'; end if;
  for p in select policyname from pg_policies where schemaname='storage' and tablename='objects' loop
    execute format('drop policy %I on storage.objects',p.policyname);
  end loop;
end $$;
create policy mycar_public_images on storage.objects for select to anon,authenticated using (bucket_id in ('avatars','products'));
create policy mycar_upload on storage.objects for insert to authenticated with check (
 (bucket_id='avatars' and split_part(name,'/',1)=auth.uid()::text)
 or (bucket_id='products' and private.is_admin()));
create policy mycar_update_image on storage.objects for update to authenticated using (
 (bucket_id='avatars' and split_part(name,'/',1)=auth.uid()::text)
 or (bucket_id='products' and private.is_admin())) with check (
 (bucket_id='avatars' and split_part(name,'/',1)=auth.uid()::text)
 or (bucket_id='products' and private.is_admin()));
create policy mycar_delete_image on storage.objects for delete to authenticated using (
 (bucket_id='avatars' and split_part(name,'/',1)=auth.uid()::text)
 or (bucket_id='products' and private.is_admin()));
commit;
