begin;
-- Gate 3-B finding: item_read and fulfillment_read used
-- "exists(select 1 from public.orders o where o.id=order_id)" as their
-- non-owner/non-admin fallback, with no explicit o.user_id = auth.uid()
-- check. public.orders carries its own RLS policy
-- (user_id = auth.uid() or private.is_admin()), and the `authenticated`
-- role neither owns orders nor bypasses row-level security, so under
-- ordinary REST/RPC access that subquery was already implicitly scoped to
-- the caller's own orders -- it was not literally USING (true). That
-- scoping depended on an unstated invariant of a different table's policy
-- and of the role evaluating it (a table owner, a BYPASSRLS role, or a
-- SECURITY DEFINER context that bypasses orders' RLS would not be
-- restricted the same way). Adding the ownership check explicitly to
-- item_read and fulfillment_read removes that implicit dependency and
-- states the intended per-user restriction directly on these two policies.
-- Applied to Staging under explicit owner authorization via `supabase db push`.
drop policy if exists item_read on public.order_items;
create policy item_read on public.order_items for select to authenticated using (
  seller_id = auth.uid()
  or private.is_admin()
  or exists(select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
);

drop policy if exists fulfillment_read on public.seller_fulfillments;
create policy fulfillment_read on public.seller_fulfillments for select to authenticated using (
  seller_id = auth.uid()
  or private.is_admin()
  or exists(select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
);
commit;
