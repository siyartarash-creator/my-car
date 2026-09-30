begin;
-- Phase 4 / Admin Panel Completion, Checkpoint B fix-forward.
-- Root cause of the database-security.mjs crash reported against f0a1ff1:
-- request_read on product_requests was never widened for requests.review,
-- unlike the parallel widening applied in the same checkpoint (202609300008)
-- to offer_read, order_read, and coupon_read for offers.moderate/
-- discounts.approve/orders.read/coupons.manage. review_product_request()
-- itself authorizes correctly via has_permission('requests.review') and was
-- never the problem -- but a requests.review operator who is not Super
-- Admin could not SELECT a product_requests row at all (request_read only
-- recognized seller_id=auth.uid() or is_admin()), so:
--   1. the Store Admin product-requests page would show zero rows for such
--      an operator even though they hold requests.review and can act via
--      the RPC -- a real functional gap in Checkpoint B, not just a test
--      artifact;
--   2. tests/database-security.mjs's added Checkpoint B assertions that
--      SELECT the decided request as the `operator` role (holding only
--      requests.review, not is_admin) got zero rows back, and the test
--      harness's check() helper (`Object.values(r.rows[0])[0]`) threw
--      "Cannot convert undefined or null to object" on that undefined
--      r.rows[0] -- exactly the reported failure.
drop policy request_read on public.product_requests;
create policy request_read on public.product_requests for select to authenticated using (
  seller_id=auth.uid() or private.is_admin() or private.has_permission('requests.review'));
commit;
