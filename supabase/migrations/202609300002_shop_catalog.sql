begin;
-- Phase 2 / Task 2.3: public catalog search/sort.
-- The public /shop listing previously fetched every active Product with all
-- of its Offers and computed the cheapest visible Offer in JavaScript after
-- the full result set reached the browser. That is the same visibility rule
-- already enforced by offer_read (active, not hidden, in stock, priced), just
-- moved server-side so text search, category filtering, price/name/newness
-- sorting and pagination can run as ordinary SQL instead of loading the
-- entire catalog client-side to filter it.
--
-- security_invoker makes this view run with the CALLING role's own
-- privileges and RLS (Postgres 15+; this project targets 17), not the view
-- owner's. It grants no access beyond what product_read/offer_read already
-- allow that role directly against products/product_sellers -- the WHERE/
-- LATERAL predicates below intersect with, not replace, that RLS.
-- A legacy Offer row can carry a discount_price that never satisfied the
-- NOT VALID phase1_offer_valid constraint (0/negative, or above price).
-- Checkout does not fall back to base price for such a row -- it rejects the
-- whole Offer as unavailable (offer.discount_price<=0 or
-- offer.discount_price>offer.price). The catalog's purchasable-candidate
-- pool must apply that identical invariant: an Offer with a non-null invalid
-- discount_price is excluded entirely, not repriced. Once only eligible
-- Offers remain (discount_price is null, or > 0 and <= price), any
-- discount_price left standing is guaranteed valid, so display_price is a
-- plain coalesce.
create view public.shop_catalog with (security_invoker = true) as
select
  p.id, p.name, p.slug, p.brand, p.part_number, p.images, p.category_id, p.created_at,
  o.id as offer_id, o.seller_id, o.seller_name, o.price, o.discount_price, o.stock,
  coalesce(o.discount_price, o.price) as display_price
from public.products p
left join lateral (
  select ps.id, ps.seller_id, ps.seller_name, ps.price, ps.discount_price, ps.stock
  from public.product_sellers ps
  where ps.product_id = p.id and ps.is_active is true and ps.is_hidden_by_seller is false
    and ps.stock > 0 and ps.price > 0
    and (ps.discount_price is null or (ps.discount_price > 0 and ps.discount_price <= ps.price))
  order by coalesce(ps.discount_price, ps.price) asc
  limit 1
) o on true
where p.is_active is true;

grant select on public.shop_catalog to anon, authenticated;
commit;
