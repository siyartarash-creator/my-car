begin;
-- Seller Profile <-> Store Cohesion: NEW commerce identity snapshots should
-- prefer the seller's own chosen Business Identity (profiles.data.seller.shopName)
-- over their Account Identity (profiles.name), falling back to the Account name
-- when no shop name was set, or when it is null/empty/all-whitespace (never
-- blank). This mirrors the application-side contract in lib/seller-identity.ts
-- (resolveSellerBusinessIdentity).
--
-- Supersedes an earlier, unsafe draft of this migration
-- (202610021000_seller_business_identity_snapshot.sql, never applied to any
-- shared environment) that was authored against a pre-Phase-4 save_offer()
-- body and would have dropped the Task 4.2A/4.2B discount-threshold,
-- discount_requests routing, and pending-request-supersession behavior if
-- deployed. This migration instead starts from the CURRENT authoritative
-- save_offer() in 202609300004_discount_requests.sql (the last migration
-- that redefines it) and changes only the seller_name snapshot source
-- expression inside its INSERT branch. Everything else -- ownership checks,
-- input validation, product-availability check, the discount threshold read,
-- above/below-threshold branching, discount_requests insert/supersession,
-- the price-change-ambiguous rejection, the UPDATE branch, advisory locking,
-- function signature, SECURITY DEFINER, search_path, grants -- is
-- byte-for-byte unchanged from that migration.
--
-- Whitespace normalization: a shopName consisting only of spaces, tabs,
-- newlines, carriage returns, or any mix of these must be treated as absent.
-- regexp_replace(..., '^[[:space:]]+|[[:space:]]+$', '', 'g') trims the
-- POSIX [:space:] class (space, tab, newline, CR, FF, VT) from both ends
-- using only core PostgreSQL regex support -- no new extension/dependency.
-- A shopName that is entirely whitespace trims to '', so nullif(...,'') maps
-- it to null and coalesce falls through to the Account name.
--
-- private.request_identity() (the product_requests insert trigger, defined
-- in 202609290001_security_foundation.sql) is rebuilt with the identical
-- contract. seller_mobile's source, the function's security characteristics,
-- and its grants are unchanged.
--
-- Historical rows are untouched: this only changes what new INSERTs compute.
-- The Offer UPDATE branch already does not re-snapshot seller_name (it was
-- never part of save_offer's UPDATE column list), so updating other Offer
-- fields after a seller changes their shopName does not retroactively alter
-- an existing Offer's seller_name -- that invariant is preserved as-is.

create or replace function public.save_offer(p_product_id bigint, p_offer_id bigint, p_price bigint,
  p_discount_price bigint, p_stock integer, p_warranty text, p_shipping text, p_notes text, p_hidden boolean)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  result_id bigint;
  seller_name text;
  old_price bigint;
  threshold smallint;
  discount_percent numeric;
  is_above boolean := false;
begin
  if auth.uid() is null or not private.is_seller() then raise exception 'forbidden'; end if;
  if p_price is null or p_price <= 0 or p_price > 1000000000000 or p_stock is null or p_stock < 0 or p_stock > 1000000
    or p_hidden is null or (p_discount_price is not null and (p_discount_price <= 0 or p_discount_price > p_price))
    or coalesce(length(p_notes),0)>2000 or coalesce(length(p_shipping),0)>1000 or coalesce(length(p_warranty),0)>1000
    then raise exception 'invalid_offer'; end if;
  if not exists(select 1 from public.products where id=p_product_id and is_active is true) then raise exception 'product_unavailable'; end if;
  select coalesce(nullif(regexp_replace(data->'seller'->>'shopName', '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''), name)
    into seller_name from public.profiles where id=auth.uid();

  select seller_autonomous_discount_max_percent into threshold from public.marketplace_settings where id=1;
  if threshold is null then raise exception 'marketplace_settings_missing'; end if;
  if p_discount_price is not null then
    discount_percent := (p_price - p_discount_price)::numeric / p_price::numeric * 100;
    is_above := discount_percent > threshold;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':offer:'||p_product_id::text,0));
  if p_offer_id is null then
    if exists(select 1 from public.product_sellers where product_id=p_product_id and seller_id=auth.uid()) then raise exception 'offer_exists'; end if;
    insert into public.product_sellers(product_id,seller_id,seller_name,price,discount_price,stock,warranty,shipping,notes,is_hidden_by_seller,is_active,updated_at,price_updated_at)
    values(p_product_id,auth.uid(),seller_name,p_price,case when is_above then null else p_discount_price end,
      p_stock,p_warranty,p_shipping,p_notes,p_hidden,true,now(),now())
    returning id into result_id;
    if is_above then
      insert into public.discount_requests(offer_id,seller_id,base_price_snapshot,requested_discount_price)
      values(result_id,auth.uid(),p_price,p_discount_price);
    end if;
  else
    select price into old_price from public.product_sellers where id=p_offer_id and product_id=p_product_id and seller_id=auth.uid();
    if old_price is null then raise exception 'offer_not_found'; end if;
    if is_above and p_price is distinct from old_price then
      raise exception 'discount_request_price_change_ambiguous';
    end if;
    if is_above then
      -- price is unchanged (checked above); price/discount_price stay as last approved.
      update public.product_sellers set stock=p_stock,warranty=p_warranty,shipping=p_shipping,notes=p_notes,
        is_hidden_by_seller=p_hidden,updated_at=now()
      where id=p_offer_id and product_id=p_product_id and seller_id=auth.uid() returning id into result_id;
      update public.discount_requests set status='superseded', updated_at=now()
      where offer_id=p_offer_id and status='pending';
      insert into public.discount_requests(offer_id,seller_id,base_price_snapshot,requested_discount_price)
      values(p_offer_id,auth.uid(),p_price,p_discount_price);
    else
      update public.product_sellers set price=p_price,discount_price=p_discount_price,stock=p_stock,
        warranty=p_warranty,shipping=p_shipping,notes=p_notes,is_hidden_by_seller=p_hidden,updated_at=now(),
        price_updated_at=(case when p_price is distinct from old_price then now() else price_updated_at end)
      where id=p_offer_id and product_id=p_product_id and seller_id=auth.uid() returning id into result_id;
      update public.discount_requests set status='superseded', updated_at=now()
      where offer_id=p_offer_id and status='pending';
    end if;
  end if;
  return result_id;
end $$;
revoke all on function public.save_offer(bigint,bigint,bigint,bigint,integer,text,text,text,boolean) from public,anon;
grant execute on function public.save_offer(bigint,bigint,bigint,bigint,integer,text,text,text,boolean) to authenticated;

create or replace function private.request_identity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  select coalesce(nullif(regexp_replace(data->'seller'->>'shopName', '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''), name), mobile
    into new.seller_name, new.seller_mobile from public.profiles where id=auth.uid();
  return new;
end $$;
revoke all on function private.request_identity() from public,anon,authenticated;
commit;
