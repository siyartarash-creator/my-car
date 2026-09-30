begin;
-- Phase 4 / Task 4.2A: above-35% discount request foundation.
-- Consumes the Task 4.1 foundation (marketplace_settings.seller_autonomous_
-- discount_max_percent, discounts.approve permission, admin_audit_log) --
-- does not duplicate the threshold and does not implement approval yet.
--
-- discount_requests is a dedicated, typed structure (not a generic ticket
-- table): one row per discount ask. A seller's above-threshold ask never
-- writes product_sellers.discount_price -- catalog/checkout (shop_catalog,
-- place_order) read product_sellers directly and are untouched by this
-- migration, so a pending ask cannot become visible/purchasable before an
-- admin/operator approves it (a later task). Only one 'pending' row is kept
-- per Offer (partial unique index); a later save_offer call that changes
-- the seller's ask supersedes the previous pending row instead of mutating
-- it in place, so full request history survives.
create table public.discount_requests (
  id bigint generated always as identity primary key,
  offer_id bigint not null references public.product_sellers(id),
  seller_id uuid not null references public.profiles(id),
  base_price_snapshot bigint not null check (base_price_snapshot > 0),
  requested_discount_price bigint not null check (
    requested_discount_price > 0 and requested_discount_price <= base_price_snapshot
  ),
  status text not null default 'pending' check (status in ('pending','approved','rejected','superseded')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Never more than one open ask per Offer -- a later task's approve/reject
-- RPC always operates on a single, unambiguous pending row.
create unique index discount_requests_one_pending_per_offer on public.discount_requests(offer_id) where status = 'pending';

alter table public.discount_requests enable row level security;
-- Deny by default, same as every other table in this schema: no insert/
-- update/delete grant to any client role. The only writer is save_offer
-- below, a SECURITY DEFINER function owned by the table owner -- it writes
-- through its own privileges, not through a grant to "authenticated", so
-- there is no direct-table or PostgREST route to fabricate/alter a request
-- or forge its status/actor.
revoke all on public.discount_requests from public, anon, authenticated;
grant select on public.discount_requests to authenticated;
create policy discount_request_read on public.discount_requests for select to authenticated using (
  seller_id = auth.uid() or private.is_admin() or private.has_permission('discounts.approve')
);

-- === Seller Offer mutation path: enforce the autonomous-discount threshold ===
-- Below/at threshold: unchanged direct-live behavior. Above threshold: the
-- requested discount_price is never written live; a pending discount_request
-- is recorded instead and the Offer keeps its last already-approved
-- price/discount_price.
--
-- Edge case (flagged for Mehdi, not resolved here -- see Task 4.2A report):
-- a single call that both changes an EXISTING Offer's base price AND asks
-- for an above-threshold discount is rejected outright
-- ('discount_request_price_change_ambiguous'). Applying the new price while
-- leaving the old absolute discount_price live could put discount_price
-- above the new price (violating phase1_offer_valid); silently dropping or
-- rescaling the old discount is an unrequested product decision. Creating a
-- brand-new Offer with an above-threshold discount is not ambiguous (there
-- is no prior live value to conflict with) and is handled directly: the
-- Offer is created with discount_price left null and a pending request is
-- recorded against its starting price.
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
  select name into seller_name from public.profiles where id=auth.uid();

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
commit;
