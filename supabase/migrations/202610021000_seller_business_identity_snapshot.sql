begin;
-- Seller Profile <-> Store Cohesion: NEW commerce identity snapshots should
-- prefer the seller's own chosen Business Identity (profiles.data.seller.shopName)
-- over their Account Identity (profiles.name), falling back to the Account name
-- when no shop name was set (never blank). This mirrors the application-side
-- contract in lib/seller-identity.ts (resolveSellerBusinessIdentity).
--
-- Scope: only the seller_name snapshot source inside save_offer's INSERT branch
-- and inside the request_identity trigger changes. Everything else (ownership
-- checks, validation, advisory locking, UPDATE branch, seller_mobile source,
-- security definer / search_path, grants, RLS) is unchanged from
-- 202609300001_offer_timestamps.sql and 202609290001_security_foundation.sql.
--
-- Historical rows are untouched: this only changes what new INSERTs compute.

create or replace function public.save_offer(p_product_id bigint, p_offer_id bigint, p_price bigint,
  p_discount_price bigint, p_stock integer, p_warranty text, p_shipping text, p_notes text, p_hidden boolean)
returns bigint language plpgsql security definer set search_path = '' as $$
declare result_id bigint; seller_name text; old_price bigint;
begin
  if auth.uid() is null or not private.is_seller() then raise exception 'forbidden'; end if;
  if p_price is null or p_price <= 0 or p_price > 1000000000000 or p_stock is null or p_stock < 0 or p_stock > 1000000
    or p_hidden is null or (p_discount_price is not null and (p_discount_price <= 0 or p_discount_price > p_price))
    or coalesce(length(p_notes),0)>2000 or coalesce(length(p_shipping),0)>1000 or coalesce(length(p_warranty),0)>1000
    then raise exception 'invalid_offer'; end if;
  if not exists(select 1 from public.products where id=p_product_id and is_active is true) then raise exception 'product_unavailable'; end if;
  select coalesce(nullif(btrim(data->'seller'->>'shopName'), ''), name) into seller_name from public.profiles where id=auth.uid();
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':offer:'||p_product_id::text,0));
  if p_offer_id is null then
    if exists(select 1 from public.product_sellers where product_id=p_product_id and seller_id=auth.uid()) then raise exception 'offer_exists'; end if;
    insert into public.product_sellers(product_id,seller_id,seller_name,price,discount_price,stock,warranty,shipping,notes,is_hidden_by_seller,is_active,updated_at,price_updated_at)
    values(p_product_id,auth.uid(),seller_name,p_price,p_discount_price,p_stock,p_warranty,p_shipping,p_notes,p_hidden,true,now(),now()) returning id into result_id;
  else
    select price into old_price from public.product_sellers where id=p_offer_id and product_id=p_product_id and seller_id=auth.uid();
    if old_price is null then raise exception 'offer_not_found'; end if;
    update public.product_sellers set price=p_price,discount_price=p_discount_price,stock=p_stock,
      warranty=p_warranty,shipping=p_shipping,notes=p_notes,is_hidden_by_seller=p_hidden,updated_at=now(),
      price_updated_at=(case when p_price is distinct from old_price then now() else price_updated_at end)
    where id=p_offer_id and product_id=p_product_id and seller_id=auth.uid() returning id into result_id;
  end if;
  return result_id;
end $$;
revoke all on function public.save_offer(bigint,bigint,bigint,bigint,integer,text,text,text,boolean) from public,anon;
grant execute on function public.save_offer(bigint,bigint,bigint,bigint,integer,text,text,text,boolean) to authenticated;

create or replace function private.request_identity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  select coalesce(nullif(btrim(data->'seller'->>'shopName'), ''), name), mobile
    into new.seller_name, new.seller_mobile from public.profiles where id=auth.uid();
  return new;
end $$;
revoke all on function private.request_identity() from public,anon,authenticated;
commit;
