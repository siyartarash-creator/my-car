begin;
alter table public.orders add column checkout_key uuid;
alter table public.orders add column checkout_payload jsonb;
create unique index orders_checkout_once on public.orders(user_id,checkout_key) where checkout_key is not null;
create table public.seller_fulfillments (
 id bigint generated always as identity primary key,
 order_id bigint not null references public.orders(id),
 seller_id uuid not null references public.profiles(id),
 status text not null default 'pending' check(status in ('pending','processing','shipped','delivered','cancelled')),
 shipping_address jsonb not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(order_id,seller_id)
);
alter table public.order_items add column offer_id bigint references public.product_sellers(id);
alter table public.order_items add column fulfillment_id bigint references public.seller_fulfillments(id);
-- Preserve legacy seller order visibility without inventing offer identities or changing totals.
insert into public.seller_fulfillments(order_id,seller_id,status,shipping_address,created_at)
select distinct o.id,i.seller_id,
 case when o.status in ('processing','shipped','delivered','cancelled') then o.status else 'pending' end,
 coalesce(o.shipping_address,'{}'::jsonb),coalesce(o.created_at,now())
from public.orders o join public.order_items i on i.order_id=o.id
where i.seller_id is not null;
update public.order_items i set fulfillment_id=f.id from public.seller_fulfillments f
where f.order_id=i.order_id and f.seller_id=i.seller_id;
revoke all on sequence public.seller_fulfillments_id_seq from public,anon,authenticated;
alter table public.seller_fulfillments enable row level security;
revoke all on public.seller_fulfillments from public, anon, authenticated;
grant select on public.seller_fulfillments to authenticated;
create policy fulfillment_read on public.seller_fulfillments for select to authenticated using (
 seller_id=auth.uid() or private.is_admin() or exists(select 1 from public.orders o where o.id=order_id));

create or replace function private.checkout(p_items jsonb,p_coupon text,p_address jsonb,p_key uuid,p_commit boolean,p_expected_total bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 uid uuid := auth.uid(); x record; offer public.product_sellers%rowtype;
 coupon public.coupons%rowtype; old_order public.orders%rowtype;
 lines jsonb := '[]'; subtotal bigint := 0; shipping bigint := 50000; discount bigint := 0;
 unit_price bigint; new_id bigint; fulfillment bigint; payload jsonb;
begin
 if uid is null or not exists(select 1 from public.profiles where id=uid) then raise exception 'unauthorized'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'invalid_items'; end if;
 if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'invalid_items'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) v where jsonb_typeof(v)<>'object'
   or coalesce(v->>'offer_id','') !~ '^[1-9][0-9]{0,14}$'
   or coalesce(v->>'quantity','') !~ '^[1-9][0-9]{0,3}$'
   or (v - 'offer_id' - 'quantity') <> '{}'::jsonb) then raise exception 'invalid_items'; end if;
 if (select count(distinct (v->>'offer_id')::bigint) from jsonb_array_elements(p_items) v) <> jsonb_array_length(p_items) then raise exception 'duplicate_offer'; end if;
 if coalesce(length(p_coupon),0)>64 then raise exception 'invalid_coupon'; end if;
 p_coupon := nullif(upper(btrim(p_coupon)),'');
 if p_commit then
   if p_key is null or p_address is null or jsonb_typeof(p_address)<>'object' or octet_length(p_address::text)>8000
    or exists(select 1 from unnest(array['full_name','mobile','province','city','street']) field where jsonb_typeof(p_address->field) is distinct from 'string')
    or coalesce(length(btrim(p_address->>'full_name')),0) not between 3 and 200
    or coalesce(p_address->>'mobile','') !~ '^09[0-9]{9}$'
    or coalesce(length(btrim(p_address->>'province')),0) not between 1 and 100
    or coalesce(length(btrim(p_address->>'city')),0) not between 1 and 100
    or coalesce(length(btrim(p_address->>'street')),0) not between 3 and 1000 then raise exception 'invalid_address'; end if;
   payload := jsonb_build_object('items',p_items,'coupon',p_coupon,'address',p_address,'expected_total',p_expected_total);
   perform pg_advisory_xact_lock(hashtextextended(uid::text||':'||p_key::text,0));
   select * into old_order from public.orders where user_id=uid and checkout_key=p_key;
   if found then
     if old_order.checkout_payload <> payload then raise exception 'idempotency_conflict'; end if;
     return jsonb_build_object('order_id',old_order.id,'total',old_order.final_price);
   end if;
 end if;
 -- Deterministic lock ordering prevents overselling and competing checkout deadlocks.
 for x in select (v->>'offer_id')::bigint id,(v->>'quantity')::integer quantity from jsonb_array_elements(p_items) v order by 1 loop
   select * into offer from public.product_sellers where id=x.id for update;
   if not found or offer.seller_id is null or offer.is_active is not true or offer.is_hidden_by_seller is not false
    or offer.stock is null or offer.stock<x.quantity or offer.price<=0 or offer.price>1000000000000
    or (offer.discount_price is not null and (offer.discount_price<=0 or offer.discount_price>offer.price))
    or not exists(select 1 from public.profiles where id=offer.seller_id and user_type='seller')
    then raise exception 'offer_unavailable'; end if;
   -- SHARE lock protects catalog activation/name for the duration of this transaction.
   perform 1 from public.products where id=offer.product_id and is_active is true for share;
   if not found then raise exception 'product_unavailable'; end if;
   unit_price := coalesce(offer.discount_price,offer.price);
   subtotal := subtotal + unit_price*x.quantity;
   if subtotal>9000000000000000 then raise exception 'order_too_large'; end if;
   lines := lines || jsonb_build_array(jsonb_build_object('offer_id',offer.id,'product_id',offer.product_id,
    'seller_id',offer.seller_id,'quantity',x.quantity,'price',unit_price,
    'name',(select name from public.products where id=offer.product_id)));
 end loop;
 if p_coupon is not null then
   select * into coupon from public.coupons where code=p_coupon for update;
   if not found or coupon.is_active is not true or coupon.valid_from>now() or coupon.valid_until<now()
    or (coupon.max_uses is not null and coalesce(coupon.used_count,0)>=coupon.max_uses)
    or subtotal<coalesce(coupon.min_order_amount,0) or coupon.discount_value<0
    or (coupon.discount_type='percent' and coupon.discount_value>100)
    or (coupon.max_uses_per_user is not null and (select count(*) from public.coupon_usages where coupon_id=coupon.id and user_id=uid)>=coupon.max_uses_per_user)
    then raise exception 'invalid_coupon'; end if;
   discount := case when coupon.discount_type='percent' then floor(subtotal::numeric*coupon.discount_value/100)::bigint else least(subtotal,coupon.discount_value) end;
 end if;
 if not p_commit then return jsonb_build_object('subtotal',subtotal,'shipping',shipping,'discount',discount,'total',subtotal+shipping-discount,'items',lines); end if;
 if p_expected_total is null or p_expected_total <> subtotal+shipping-discount then raise exception 'price_changed'; end if;
 insert into public.orders(user_id,status,total_price,shipping_cost,discount,final_price,shipping_address,
  payment_method,payment_status,coupon_id,coupon_code,coupon_discount,checkout_key,checkout_payload)
 values(uid,'pending',subtotal,shipping,discount,subtotal+shipping-discount,p_address,'cash_on_delivery','pending',coupon.id,p_coupon,discount,p_key,payload) returning id into new_id;
 for x in select distinct (v->>'seller_id')::uuid seller_id from jsonb_array_elements(lines) v loop
   insert into public.seller_fulfillments(order_id,seller_id,shipping_address) values(new_id,x.seller_id,p_address);
 end loop;
 for x in select * from jsonb_to_recordset(lines) as r(offer_id bigint,product_id bigint,seller_id uuid,quantity integer,price bigint,name text) loop
   select id into fulfillment from public.seller_fulfillments where order_id=new_id and seller_id=x.seller_id;
   insert into public.order_items(order_id,product_id,product_name,product_price,quantity,seller_id,offer_id,fulfillment_id)
   values(new_id,x.product_id,x.name,x.price,x.quantity,x.seller_id,x.offer_id,fulfillment);
   update public.product_sellers set stock=stock-x.quantity where id=x.offer_id;
 end loop;
 if coupon.id is not null then
   insert into public.coupon_usages(coupon_id,user_id,order_id) values(coupon.id,uid,new_id);
   update public.coupons set used_count=coalesce(used_count,0)+1 where id=coupon.id;
 end if;
 return jsonb_build_object('order_id',new_id,'total',subtotal+shipping-discount);
end $$;
revoke all on function private.checkout(jsonb,text,jsonb,uuid,boolean,bigint) from public,anon,authenticated;
create function public.quote_checkout(p_items jsonb,p_coupon text default null) returns jsonb
language sql security definer set search_path='' as $$ select private.checkout(p_items,p_coupon,null,null,false); $$;
create function public.place_order(p_items jsonb,p_address jsonb,p_key uuid,p_expected_total bigint,p_coupon text default null) returns jsonb
language sql security definer set search_path='' as $$ select private.checkout(p_items,p_coupon,p_address,p_key,true,p_expected_total); $$;
revoke all on function public.quote_checkout(jsonb,text), public.place_order(jsonb,jsonb,uuid,bigint,text) from public,anon;
grant execute on function public.quote_checkout(jsonb,text), public.place_order(jsonb,jsonb,uuid,bigint,text) to authenticated;

create function public.cancel_order(p_order_id bigint) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; x record;
begin
 select * into o from public.orders where id=p_order_id and user_id=auth.uid() for update;
 if not found then raise exception 'order_not_found'; end if;
 if o.status='cancelled' then return; end if;
 if o.status<>'pending' or o.payment_status<>'pending' or o.checkout_key is null then raise exception 'cannot_cancel'; end if;
 perform 1 from public.seller_fulfillments where order_id=o.id order by id for update;
 if exists(select 1 from public.seller_fulfillments where order_id=o.id and status<>'pending') then raise exception 'cannot_cancel'; end if;
 for x in select offer_id,sum(quantity)::integer quantity from public.order_items where order_id=o.id group by offer_id order by offer_id loop
   update public.product_sellers set stock=stock+x.quantity where id=x.offer_id;
 end loop;
 update public.seller_fulfillments set status='cancelled',updated_at=now() where order_id=o.id;
 update public.orders set status='cancelled',updated_at=now() where id=o.id;
 -- Coupon redemption remains consumed on cancellation to prevent replay abuse.
end $$;
create function public.advance_fulfillment(p_order_id bigint,p_status text) returns void
language plpgsql security definer set search_path='' as $$
declare f public.seller_fulfillments%rowtype; next_status text;
begin
 if auth.uid() is null or not private.is_seller() then raise exception 'forbidden'; end if;
 perform 1 from public.orders o where o.id=p_order_id and exists(select 1 from public.seller_fulfillments sf where sf.order_id=o.id and sf.seller_id=auth.uid()) for update;
 select * into f from public.seller_fulfillments where order_id=p_order_id and seller_id=auth.uid() for update;
 if not found then raise exception 'fulfillment_not_found'; end if;
 if f.status=p_status then return; end if;
 if not ((f.status='pending' and p_status='processing') or (f.status='processing' and p_status='shipped') or (f.status='shipped' and p_status='delivered')) or p_status is null then raise exception 'invalid_transition'; end if;
 update public.seller_fulfillments set status=p_status,updated_at=now() where id=f.id;
 select case when bool_and(status='delivered') then 'delivered'
   when bool_and(status in ('shipped','delivered')) then 'shipped' else 'processing' end
 into next_status from public.seller_fulfillments where order_id=p_order_id;
 update public.orders set status=next_status,updated_at=now() where id=p_order_id;
end $$;
revoke all on function public.cancel_order(bigint), public.advance_fulfillment(bigint,text) from public,anon;
grant execute on function public.cancel_order(bigint), public.advance_fulfillment(bigint,text) to authenticated;
commit;
