begin;
-- Phase 4: order_read already permits orders.read operators to inspect all
-- order headers, but item_read's explicit buyer ownership check does not
-- inherit that permission. Add only the matching read-only operator path.
-- Require an actual visible parent header: legacy order_id is nullable,
-- and orders.read must not newly expose orphan order lines.
-- Preserve the existing buyer/seller/Super Admin policy and all grants,
-- write restrictions, fulfillment visibility, and auth/permission helpers.
create policy item_orders_read on public.order_items
  for select to authenticated
  using (
    private.has_permission('orders.read')
    and exists(select 1 from public.orders o where o.id = order_items.order_id)
  );
commit;
