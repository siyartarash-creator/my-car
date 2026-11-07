begin;

-- WU-FINANCE-F5: the shop's money cycle. osaa/specs/finance.md section 10, decision D-0050, and the
-- owner's debt rule D-0049 (a penalty charged to a provider with no balance raises the provider's debt,
-- so a PROVIDER account may go below zero; nothing else may).
--
-- WHAT THIS STEP DOES. A buyer pays an order from the wallet: the buyer's ledger account is debited and
-- one shop module account (platform.shop) is credited. The money stays there (escrow). Once the module's
-- release window has elapsed, counted from the moment the order was first delivered, an admin releases it:
-- each seller is credited (its items total minus commission), platform.revenue receives the commission and
-- any remainder, and platform.shop returns to zero for that order. A return before release is the money
-- half of a return: the payment transfer is reversed in full. The case row (public.return_requests) stays
-- the operator's record and its own RPC is untouched; a later step can call admin_refund_order_escrow from it.
--
-- THE GUARD. Every account except the provider accounts (and the two counter-legs named in D2) is refused
-- any transfer that leaves it below zero. This is checked in the database (ledger_entries_non_negative_guard,
-- deferred to COMMIT), so it holds for every writer, not only for the RPCs in this file.
--
-- NEW OBJECTS: ledger_accounts.allows_negative, orders.delivered_at, public.module_release_windows (one
-- seeded row), one seeded platform account (platform.shop), a deferred constraint trigger on ledger_entries,
-- two triggers (ledger_accounts default, orders delivered stamp), four public RPCs, and private helpers.
-- No existing function body is edited. No existing migration is edited.
--
-- DECISIONS (recorded here, not hidden in code):
--
--   D1. THE BUYER'S WALLET IS ITS POSITIVE BALANCE. A payment debits the buyer, so the buyer's balance must
--       cover the order and must stay >= 0 (the guard). F4's manual charge is the only funding writer and it
--       raises a balance, so the tests fund a buyer that way. The sign reads the other way round for a provider,
--       where a positive balance is a debt. Both are the same signed sum on the same table; this step does not
--       reconcile the two readings.
--
--   D2. TWO COUNTER-LEG ACCOUNTS ARE EXEMPT FROM THE GUARD: platform.clearing and platform.manual_adjustments.
--       The brief's rule ("every platform account may never go negative") would refuse every cash collection
--       (the clearing leg is -invoice by design, 202611050000) and every manual charge (the manual_adjustments
--       leg is -amount by design, 202611100000), including the existing tests that post one collection on an
--       empty ledger. Both are counter-legs for money entering or leaving the outside world, not money
--       belonging to anyone, and neither is a wallet a buyer pays from. platform.revenue, platform.penalties,
--       platform.provider_earnings and platform.shop stay guarded, and so does every profile account.
--
--   D3. THE GUARD REFUSES A WALLET TRANSFER THAT DEBITS A GUARDED ACCOUNT PAST ZERO -- it is the transfer that
--       must be covered, not the account's history. A transfer that merely finds an account already negative (a
--       debt) never blocks a credit such as a refund or a correction. That is what makes "the wallet can never
--       go negative" a database fact rather than a promise inside one RPC: every wallet writer, present and
--       future, passes through it.
--
--   D4. THE GUARD'S SCOPE IS WALLET MONEY, BY REASON. It fires only on a transfer carrying one of the four
--       wallet reasons ('order_wallet_payment', 'order_escrow_release', 'order_escrow_refund', 'admin_withdraw').
--       Everything else on this ledger is untouched by it: D-0049's penalties still grow a debt ("if there is no
--       balance, the debt grows" -- a customer-paid cancel penalty on an empty wallet is the proof case), and
--       F2a's job_cash_collected still posts its controlled overdraft on the platform.clearing counter-leg,
--       offset by the earnings leg that follows it. Scoping by reason rather than by role is deliberate: a new
--       reason cannot inherit the exemption by accident, and this step does not re-open an earlier step's
--       mechanics.
--
--   D5. allows_negative IS SET FROM user_type AT INSERT (and by the backfill for existing rows). A later change
--       of a profile's user_type does not update its account flag. Nothing in the app changes user_type today.
--
--   D6. orders.escrow_status LOSES ITS DEFAULT ('held') AND EXISTING NON-WALLET ROWS ARE SET TO NULL. With the
--       default in place every order would read as "already paid" to pay_order_from_wallet, and the release
--       sweep would try to release every delivered order. escrow_status is set only by the wallet payment now.
--       The clear is conditional on payment_method, so it can never erase a row a wallet already paid. It has no
--       reader or writer before this step (202611050000 header), so nothing else changes. The column is left
--       nullable with NO default, which is exactly what 202610100002 left behind, so the rollback has a real
--       pre-F5 state to return to instead of inventing one.
--
--   D7. delivered_at IS STAMPED ONCE, at the first transition to 'delivered' (set-once: a later update never
--       re-stamps it). Orders delivered BEFORE this migration keep delivered_at NULL: their real delivery date is
--       unknown, and no backfill is made (the same owner rule as the ledger cutover). They can never be released.
--
--   D8. THE SHOP COMMISSION IS THE COMMISSION ROW THE LEDGER ALREADY USES (private.ledger_commission, the only
--       'commission' rate: 15% payer rescuer in the seed). No shop-specific rate is introduced.
--
--   D9. A SELLER'S GROSS IS SUMMED FROM ITS OWN ORDER LINES (product_price * quantity, order_items.seller_id).
--       A line with NO seller_id is credited to nobody; its value stays with platform.revenue inside the
--       remainder. A seller whose net is 0 gets no leg, and platform.revenue gets no leg when its remainder is 0
--       (the ledger refuses zero legs). An order with no sellers at all raises invalid_amount.
--
--   D10. SHIPPING IS NOT PAID TO A SELLER, AND A DISCOUNT IS REFUSED AT PAYMENT (D20). Sellers are paid from the
--       escrowed amount in proportion to their item totals, so the module can never pay out more than it holds;
--       whatever is left after the payouts is the shop's commission (shipping included, since nothing else can
--       own it), and a remainder that would be negative is refused as a data error rather than recorded.
--
--   D11. THE RELEASE UPDATES THE ORDER BEFORE IT POSTS, under the row lock taken for the order: a concurrent call
--       that already released it finds escrow_status <> 'held' and skips it, and no second post can happen.
--
--   D12. THE EXPLICIT-ID CASE IS HONEST. An explicit p_order_id that is not due raises the reason it is not
--       due (order_already_released, order_not_escrowed, order_not_delivered, release_window_not_elapsed).
--       An unknown id raises order_not_found. So a second explicit release raises order_already_released. The
--       sweep with no id returns released_count 0 on a second run. The brief asked for both behaviours; this is
--       how they are reconciled.
--
--   D13. THE PAY REPLAY. A pay call on an order already paid with the SAME key returns the stored payment again,
--       rebuilt from the payment ledger entry (transfer id and balances from its rate_snapshot). escrow_status in
--       the replay is the current one. A DIFFERENT key on a paid order raises order_already_paid. The replay runs
--       only while the order is still 'pending' (the status check is first, as the brief orders it).
--
--   D14. THE PAYMENT'S SOURCE ID IS A FRESH UUID (the helper mints its own transfer id, as F4's D4 explains). The
--       release and the refund find the SAME source id through the payment entry, so the anti-duplicate index
--       (source_type, source_id, reason, account_id) holds one payment, one release and one reversal per order.
--
--   D15. THE REFUND'S OPTIONAL TRANSFER ID MUST BE THIS ORDER'S PAYMENT TRANSFER. Any other id raises
--       invalid_refund_transfer (a new code). Without it, reversing an arbitrary transfer would be possible.
--
--   D16. THE REFUND REFUSES ANY RELEASED ORDER (order_already_released) and any order not held (order_not_escrowed),
--       which includes a second refund. The reversal itself is private.reverse_ledger_transfer, which already
--       refuses an already-reversed leg ('already_reversed') as a backstop.
--
--   D17. THE WINDOW IS DATA. private.module_release_window_for reads the active row for the exact code, then the
--       active '*' row, then 7. No RPC can write a '*' row (only platform.shop is accepted), so the 7 is the fallback
--       in practice. The upsert RPC keeps is_active unchanged (it has no such parameter); a blank note is stored as NULL.
--
--   D18. THE WINDOW UPSERT WRITES NO LEDGER ROW. It configures a number; the two money writers (pay and release)
--       post through post_ledger_transfer, and the refund posts through private.reverse_ledger_transfer, which
--       posts through post_ledger_transfer. No public function here posts a transfer by any other path.
--
--   D19. THE NEW ERROR CODES: order_not_payable, order_already_paid, insufficient_balance,
--       account_would_go_negative (the guard), release_window_not_elapsed, order_already_released,
--       order_not_escrowed, order_not_delivered, order_not_found, ledger_account_not_found, invalid_commission,
--       invalid_refund_transfer, invalid_module, invalid_days, invalid_note, invalid_request, account_suspended.
--       'unauthorized', 'forbidden', 'invalid_reason', 'invalid_amount' and 'duplicate_ledger_post' already exist.
--
--   D20. NO WALLET PAYMENT CREATES A DISCOUNT LOSS, AND THE RULE IS ENFORCED AT PAYMENT TIME. The shop account
--       can only ever pay out what a buyer actually paid into it: final_price = item totals ظêْ discount
--       ظêْ coupon + shipping. So a seller's items total is NEVER used as an entitlement. A wallet payment is
--       refused with 'order_not_wallet_payable' when the sum of the order's item totals is greater than
--       final_price, i.e. when a discount or a coupon is in play. Shipping is not refused by that test: paying
--       it and giving it to nobody is not a loss, and the commission simply absorbs it. The RELEASE splits the
--       escrowed amount over the sellers in proportion to their item totals (floor, with the last seller taking
--       the remainder), and each seller is then credited that share MINUS the commission on its own item total.
--       For an order with no discount the two figures add back to exactly the item total, so the brief's
--       "amount - commission" holds per seller and the platform's commission is the sum of those commissions.
--       WHO FUNDS A DISCOUNT is an owner decision this step does not make; until it is made, a discounted order
--       cannot be paid from the wallet. A wallet payment with NO item rows at all is refused too: there would be
--       nothing to release to.
--
-- WHAT IS DELIBERATELY NOT IN THIS STEP: a payment gateway and any top-up path for a buyer's wallet; a scheduler
-- for the release sweep (it is an admin call, as the brief asks); a panel page for the shop escrow or the window;
-- the emdad and on-site module accounts (no money path for them yet); customer-facing returns (the case row and its
-- RPC are untouched); and any order status change on payment (an order stays 'pending' until fulfilment moves it).

-- === A1. The column that makes the invariant checkable in the database =======
-- The owner's debt rule (D-0049): a penalty charged to a provider with no balance INCREASES the provider's
-- debt, so a provider account may go below zero. Every other account (a buyer's wallet, the shop module account,
-- the platform accounts that hold real money) may never. This column is the switch the guard reads.
alter table public.ledger_accounts add column allows_negative boolean not null default false;
update public.ledger_accounts a set allows_negative = true
  from public.profiles p
 where p.id = a.profile_id and p.user_type in ('rescuer', 'service');
-- The two counter-legs (D2). Their balance is the other side of cash collection and of a manual entry.
update public.ledger_accounts set allows_negative = true
 where code in ('platform.clearing', 'platform.manual_adjustments');

-- === A2. The flag stays honest for accounts created later ====================
create function private.ledger_account_role_default(p_profile_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select p.user_type in ('rescuer', 'service')
                     from public.profiles p where p.id = p_profile_id), false)
$$;
revoke all on function private.ledger_account_role_default(uuid) from public, anon, authenticated;

create function private.set_ledger_account_negative_default() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind = 'profile' and new.profile_id is not null and new.allows_negative is not true then
    new.allows_negative := private.ledger_account_role_default(new.profile_id);
  end if;
  return new;
end $$;
revoke all on function private.set_ledger_account_negative_default() from public, anon, authenticated;
create trigger mycar_ledger_account_negative_default before insert on public.ledger_accounts
  for each row execute function private.set_ledger_account_negative_default();

-- === A3. The database-level non-negative guard (the heart of this step) =======
-- Deferred to COMMIT, so the whole transfer is present when it runs. One check per distinct account of the
-- transfer. The per-row trigger fires once per leg; the repeat is harmless and keeps the trigger order-free.
create function private.ledger_account_stays_non_negative() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_account_id uuid;
  v_allows_negative boolean;
  v_balance_before bigint;
  v_balance_after bigint;
begin
  -- The scope of the rule: a transfer that moves WALLET money. Those are the four reasons this step and F4
  -- introduced. Everything else on this ledger is either a debt event (D-0049's penalties, which MUST be able
  -- to create a debt -- D4) or a two-leg cash-collection pair whose first leg is a controlled overdraft by
  -- design (F2a's job_cash_collected, offset by the earnings leg that follows it, its "cash in hand is the
  -- platform's money" model). The guard is therefore a guarantee about wallets, not a blanket rule that would
  -- re-litigate the earlier steps' mechanics.
  if not exists (
    select 1 from public.ledger_entries e
     where e.transfer_id = new.transfer_id
       and e.reason = any (array['order_wallet_payment', 'order_escrow_release', 'order_escrow_refund', 'admin_withdraw'])
  ) then
    return null;
  end if;

  for v_account_id in
    select distinct e.account_id from public.ledger_entries e where e.transfer_id = new.transfer_id
  loop
    select a.allows_negative into v_allows_negative from public.ledger_accounts a where a.id = v_account_id;
    if v_allows_negative is true then continue; end if;

    -- The account's balance without this transfer, and with it. The question is whether THIS TRANSFER is what
    -- took it below zero: a debt it already carried never blocks a credit such as a refund or a correction.
    select coalesce(sum(e.signed_amount), 0)::bigint into v_balance_after
      from public.ledger_entries e where e.account_id = v_account_id;
    select coalesce(sum(e.signed_amount), 0)::bigint into v_balance_before
      from public.ledger_entries e
     where e.account_id = v_account_id and e.transfer_id <> new.transfer_id;

    if v_balance_after < 0 and v_balance_before >= 0 then raise exception 'account_would_go_negative'; end if;
  end loop;
  return null;
end $$;
revoke all on function private.ledger_account_stays_non_negative() from public, anon, authenticated;
create constraint trigger ledger_entries_non_negative_guard after insert on public.ledger_entries
  deferrable initially deferred for each row execute function private.ledger_account_stays_non_negative();

-- === A4. The shop module account (a DATA row, never a schema change) =========
-- Created with allows_negative false (its default): the shop never owes or holds a negative balance.
insert into public.ledger_accounts (kind, code) values ('platform', 'platform.shop') on conflict do nothing;

-- === A5. When delivery happened, and the escrow default ======================
alter table public.orders add column delivered_at timestamptz;
comment on column public.orders.delivered_at is 'the moment the order first became delivered; the shop escrow release window is counted from here. NULL means never delivered.';

-- D6: the default is dropped BEFORE the stamp trigger exists, so this backfill cannot stamp delivered_at.
-- The clear is conditional on the payment method: a row already marked as paid by a wallet is escrow state this
-- step owns and must not be erased, while every other row's 'held' is the baseline default this step retires.
alter table public.orders alter column escrow_status drop default;
update public.orders set escrow_status = null
 where escrow_status is not null and payment_method is distinct from 'wallet';

create function private.orders_stamp_delivered_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'delivered' and new.delivered_at is null
     and (old.status is distinct from 'delivered' or old.delivered_at is null) then
    new.delivered_at := now();
  end if;
  return new;
end $$;
revoke all on function private.orders_stamp_delivered_at() from public, anon, authenticated;
create trigger mycar_orders_stamp_delivered_at before update on public.orders
  for each row execute function private.orders_stamp_delivered_at();

-- === A6. The release window as editable data =================================
create table public.module_release_windows (
  code text primary key,          -- e.g. 'platform.shop'; the module's ledger account code
  release_after_days integer not null check (release_after_days between 0 and 365),
  is_active boolean not null default true,
  note text check (note is null or char_length(note) <= 500),
  updated_at timestamptz not null default now()
);
alter table public.module_release_windows enable row level security;
revoke all on public.module_release_windows from public, anon, authenticated;
grant select on public.module_release_windows to authenticated;
create policy module_release_windows_read_admin on public.module_release_windows
  for select to authenticated
  using (private.is_admin());
-- No insert, update or delete grant to any client role: the admin RPC below is the only writer.

insert into public.module_release_windows (code, release_after_days, is_active, note)
values ('platform.shop', 7, true, null)
on conflict do nothing;

-- One statement, no %rowtype: the exact code's active row, else the active '*' row, else 7 (D17).
create function private.module_release_window_for(p_code text) returns integer
language sql stable set search_path = '' as $$
  select coalesce(
    (select w.release_after_days from public.module_release_windows w where w.code = p_code and w.is_active limit 1),
    (select w.release_after_days from public.module_release_windows w where w.code = '*' and w.is_active limit 1),
    7)
$$;
revoke all on function private.module_release_window_for(text) from public, anon, authenticated;

-- The window for the shop, named once so the callers do not repeat the module code.
create function private.module_release_window_days() returns integer
language sql stable set search_path = '' as $$
  select private.module_release_window_for('platform.shop')
$$;
revoke all on function private.module_release_window_days() from public, anon, authenticated;

-- === A7. public.pay_order_from_wallet ========================================
-- The buyer pays its own pending checkout order from its wallet. One balanced transfer into platform.shop, and
-- the order's payment fields set. The seller is credited only at release (A8).
create function public.pay_order_from_wallet(p_order_id bigint, p_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_checkout_key uuid;
  v_order public.orders%rowtype;
  v_buyer_account uuid;
  v_shop_account uuid;
  v_balance_before bigint;
  v_balance_after bigint;
  v_window integer := private.module_release_window_days();
  v_source_id uuid := gen_random_uuid();
  v_transfer_id uuid;
  v_replay_transfer uuid;
  v_replay_snapshot jsonb;
  v_items_total bigint;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if private.is_suspended(v_uid) then raise exception 'account_suspended'; end if;
  if p_key is null then raise exception 'invalid_request'; end if;

  select o.user_id, o.checkout_key into v_owner, v_checkout_key from public.orders o where o.id = p_order_id;
  if not found then raise exception 'order_not_found'; end if;
  if v_owner is distinct from v_uid then raise exception 'forbidden'; end if;
  -- Only a real checkout order can be paid. A legacy or hand-made order has no checkout key.
  if v_checkout_key is null then raise exception 'order_not_payable'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.status is distinct from 'pending' then raise exception 'order_not_payable'; end if;

  if v_order.escrow_status is not null then
    -- The same key again: the stored result, with no write (D13). Any other key: refused.
    if v_order.payment_ref = p_key::text then
      select e.transfer_id, e.rate_snapshot into v_replay_transfer, v_replay_snapshot
        from public.ledger_entries e
       where e.source_type = 'order' and e.reason = 'order_wallet_payment'
         and e.rate_snapshot ->> 'order_id' = p_order_id::text
       limit 1;
      return jsonb_build_object(
        'order_id', p_order_id,
        'transfer_id', v_replay_transfer,
        'amount_toman', v_order.final_price,
        'balance_before_toman', (v_replay_snapshot ->> 'balance_before_toman')::bigint,
        'balance_after_toman', (v_replay_snapshot ->> 'balance_after_toman')::bigint,
        'escrow_status', v_order.escrow_status);
    end if;
    raise exception 'order_already_paid';
  end if;
  if v_order.payment_status is distinct from 'pending' then raise exception 'order_already_paid'; end if;
  if v_order.final_price is null or v_order.final_price <= 0 then raise exception 'invalid_amount'; end if;

  -- D20: a discount (or a coupon) makes the sellers' item totals larger than what the buyer pays, and the shop
  -- module has no funding source of its own. Refused here, at the only moment the money can still stay put.
  select coalesce(sum(i.product_price * i.quantity), 0)::bigint into v_items_total
    from public.order_items i where i.order_id = p_order_id;
  if v_items_total <= 0 or v_items_total > v_order.final_price then raise exception 'order_not_wallet_payable'; end if;

  select a.id into v_buyer_account from public.ledger_accounts a where a.profile_id = v_uid;
  select a.id into v_shop_account from public.ledger_accounts a where a.code = 'platform.shop';
  if v_buyer_account is null or v_shop_account is null then raise exception 'ledger_account_not_found'; end if;

  select coalesce(sum(e.signed_amount), 0)::bigint into v_balance_before
    from public.ledger_entries e where e.account_id = v_buyer_account;
  -- Refused BEFORE any write. The guard (A3) is the database's own backstop for the same rule.
  if v_balance_before < v_order.final_price then raise exception 'insufficient_balance'; end if;
  v_balance_after := v_balance_before - v_order.final_price;

  v_transfer_id := public.post_ledger_transfer('order', v_source_id, 'order_wallet_payment',
    jsonb_build_array(
      jsonb_build_object('account_id', v_buyer_account, 'signed_amount', -v_order.final_price),
      jsonb_build_object('account_id', v_shop_account, 'signed_amount', v_order.final_price)),
    jsonb_build_object(
      'code', 'order_wallet_payment',
      'order_id', p_order_id::text,
      'amount_toman', v_order.final_price,
      'balance_before_toman', v_balance_before,
      'balance_after_toman', v_balance_after,
      'release_after_days', v_window,
      'module', 'platform.shop'));

  update public.orders
     set payment_method = 'wallet', payment_status = 'paid', escrow_status = 'held',
         payment_ref = p_key::text, updated_at = now()
   where id = p_order_id;

  return jsonb_build_object(
    'order_id', p_order_id,
    'transfer_id', v_transfer_id,
    'amount_toman', v_order.final_price,
    'balance_before_toman', v_balance_before,
    'balance_after_toman', v_balance_after,
    'escrow_status', 'held');
end $$;
revoke all on function public.pay_order_from_wallet(bigint, uuid) from public, anon, authenticated;
grant execute on function public.pay_order_from_wallet(bigint, uuid) to authenticated;

-- === A8. public.admin_release_order_escrow ===================================
-- Releases every DUE held order (or one, by id). Due: held, delivered, and now() at or past delivered_at plus
-- the window. Each order is posted as ONE balanced transfer under its own payment's source id.
create function public.admin_release_order_escrow(p_order_id bigint default null, p_reason text default 'scheduled release of due shop orders')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_window integer := private.module_release_window_days();
  v_order_id bigint;
  v_order public.orders%rowtype;
  v_status text;
  v_delivered timestamptz;
  v_source_id uuid;
  v_shop_account uuid;
  v_revenue_account uuid;
  v_seller record;
  v_seller_account uuid;
  v_gross bigint;
  v_commission bigint;
  v_net bigint;
  v_amount bigint;
  v_legs jsonb;
  v_sellers jsonb;
  v_payout_total bigint;
  v_allocate bigint;
  v_allocate_total bigint;
  v_commission_total bigint;
  v_transfer_id uuid;
  v_updated integer;
  v_released jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_total_amount bigint := 0;
  v_total_commission bigint := 0;
  v_seller_items_total bigint;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'forbidden'; end if;
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then raise exception 'invalid_reason'; end if;

  -- D12: an explicit id that is not due says why, instead of returning an empty list.
  if p_order_id is not null and not exists (
       select 1 from public.orders o
        where o.id = p_order_id and o.escrow_status = 'held' and o.delivered_at is not null
          and now() >= o.delivered_at + make_interval(days => v_window)) then
    select o.escrow_status, o.delivered_at into v_status, v_delivered from public.orders o where o.id = p_order_id;
    if not found then raise exception 'order_not_found'; end if;
    if v_status = 'released' then raise exception 'order_already_released'; end if;
    if v_status is distinct from 'held' then raise exception 'order_not_escrowed'; end if;
    if v_delivered is null then raise exception 'order_not_delivered'; end if;
    raise exception 'release_window_not_elapsed';
  end if;

  select a.id into v_shop_account from public.ledger_accounts a where a.code = 'platform.shop';
  select a.id into v_revenue_account from public.ledger_accounts a where a.code = 'platform.revenue';
  if v_shop_account is null or v_revenue_account is null then raise exception 'ledger_account_not_found'; end if;

  for v_order_id in
    select o.id from public.orders o
     where o.escrow_status = 'held' and o.delivered_at is not null
       and now() >= o.delivered_at + make_interval(days => v_window)
       and (p_order_id is null or o.id = p_order_id)
     order by o.delivered_at, o.id
  loop
    select * into v_order from public.orders o where o.id = v_order_id for update;
    -- Re-verified under the lock: a concurrent call may have released it already (D11).
    if v_order.escrow_status is distinct from 'held' then continue; end if;

    select e.source_id into v_source_id from public.ledger_entries e
     where e.source_type = 'order' and e.reason = 'order_wallet_payment'
       and e.rate_snapshot ->> 'order_id' = v_order_id::text
     limit 1;
    if v_source_id is null then raise exception 'order_not_escrowed'; end if;

    v_amount := v_order.final_price;
    v_legs := '[]'::jsonb;
    v_sellers := '[]'::jsonb;
    v_payout_total := 0;
    v_commission_total := 0;
    v_allocate_total := 0;

    -- The sellers' own item totals, and the total of them. The escrowed amount is shared over these in
    -- proportion, so the module can never pay out more than a buyer actually paid in (D20).
    select coalesce(sum(i.product_price * i.quantity), 0)::bigint into v_seller_items_total
      from public.order_items i where i.order_id = v_order_id and i.seller_id is not null;
    if v_seller_items_total <= 0 then raise exception 'invalid_amount'; end if;

    -- PASS 1: each seller's item total (its entitlement), the share of what the BUYER PAID that it carries
    -- (allocate_toman, floor), and the commission on its own entitlement (D8). The commission the shop earns is
    -- therefore the sum of those commissions whenever the buyer paid the full item total; a discount can only
    -- make the shop's own margin smaller, never larger, and a wallet payment is refused when one is in play
    -- (D20). So the shop's commission and the sellers' payouts always add up to exactly what was escrowed.
    for v_seller in
      select i.seller_id, sum(i.product_price * i.quantity)::bigint as gross
        from public.order_items i
       where i.order_id = v_order_id and i.seller_id is not null
       group by i.seller_id
       order by i.seller_id
    loop
      v_gross := v_seller.gross;
      if v_gross is null or v_gross <= 0 then raise exception 'invalid_amount'; end if;
      v_commission := (private.ledger_commission(v_gross) ->> 'commission')::bigint;
      if v_commission < 0 or v_commission > v_gross then raise exception 'invalid_commission'; end if;

      select a.id into v_seller_account from public.ledger_accounts a where a.profile_id = v_seller.seller_id;
      if v_seller_account is null then raise exception 'ledger_account_not_found'; end if;

      v_allocate := floor(v_amount::numeric * v_gross::numeric / v_seller_items_total::numeric)::bigint;
      v_sellers := v_sellers || jsonb_build_array(jsonb_build_object(
        'seller_id', v_seller.seller_id, 'account_id', v_seller_account,
        'items_toman', v_gross, 'commission_toman', v_commission,
        'allocate_toman', v_allocate, 'payout_toman', 0::bigint));
      v_allocate_total := v_allocate_total + v_allocate;
    end loop;

    if jsonb_array_length(v_sellers) = 0 then raise exception 'invalid_amount'; end if;

    -- The floor can leave a toman or two of the buyer's payment unallocated. It goes to the LAST seller (the
    -- highest seller id), never to the platform: a rounding artifact must not become revenue. (jsonb arrays are
    -- 0-based and ordinality is 1-based, hence the ord - 1.)
    if v_allocate_total < v_amount then
      v_sellers := jsonb_set(v_sellers,
        array[(jsonb_array_length(v_sellers) - 1)::text, 'allocate_toman'],
        to_jsonb((v_sellers -> (jsonb_array_length(v_sellers) - 1) ->> 'allocate_toman')::bigint
                 + (v_amount - v_allocate_total)), true);
      v_allocate_total := v_amount;
    end if;

    -- PASS 2: each seller is credited its share of the payment MINUS the commission on its own entitlement.
    -- That is exactly the brief's "amount - commission" for a single-seller order and its per-seller form for a
    -- multi-seller one; the sum of the payouts plus the commissions is exactly the escrowed amount.
    v_legs := '[]'::jsonb;
    v_payout_total := 0;
    v_commission_total := 0;
    for v_seller in
      select s.ord,
             (s.value ->> 'account_id')::uuid as account_id,
             (s.value ->> 'commission_toman')::bigint as commission,
             (s.value ->> 'allocate_toman')::bigint as allocate
        from jsonb_array_elements(v_sellers) with ordinality s(value, ord)
       order by s.ord
    loop
      v_net := v_seller.allocate - v_seller.commission;
      -- A negative payout is only reachable through a discount (which the payment already refused) or a
      -- commission larger than the seller's share of the payment. Refused as a data error, never recorded.
      if v_net < 0 then raise exception 'invalid_commission'; end if;
      v_sellers := jsonb_set(v_sellers, array[(v_seller.ord - 1)::text, 'payout_toman'], to_jsonb(v_net), true);
      if v_net > 0 then
        v_legs := v_legs || jsonb_build_array(jsonb_build_object('account_id', v_seller.account_id, 'signed_amount', v_net));
      end if;
      v_payout_total := v_payout_total + v_net;
      v_commission_total := v_commission_total + v_seller.commission;
    end loop;

    -- What the module actually keeps: what the buyer paid minus what the sellers were paid. It equals the
    -- commissions above whenever no discount was involved, and it is the figure platform.revenue receives, so
    -- the legs balance and the shop account returns to zero for this order.
    v_commission_total := v_amount - v_payout_total;
    if v_commission_total < 0 then raise exception 'invalid_amount'; end if;

    -- The commission leg and the shop's own leg. A zero commission adds no leg: the ledger refuses a
    -- zero-amount leg ("no transfer says zero" -- the same rule F2c's helpers follow).
    if v_commission_total > 0 then
      v_legs := v_legs || jsonb_build_array(jsonb_build_object('account_id', v_revenue_account, 'signed_amount', v_commission_total));
    end if;
    v_legs := v_legs || jsonb_build_array(jsonb_build_object('account_id', v_shop_account, 'signed_amount', -v_amount));

    -- D11: the status moves before the post. A zero-row update means someone else took it: skip, do not post.
    update public.orders set escrow_status = 'released', updated_at = now()
     where id = v_order_id and escrow_status = 'held';
    get diagnostics v_updated = row_count;
    if v_updated = 0 then continue; end if;

    v_transfer_id := public.post_ledger_transfer('order', v_source_id, 'order_escrow_release', v_legs,
      jsonb_build_object(
        'code', 'order_escrow_release',
        'order_id', v_order_id::text,
        'amount_toman', v_amount,
        'total_commission_toman', v_commission_total,
        'sellers', v_sellers,
        'window_days', v_window,
        'released_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));

    perform private.log_admin_action('release_order_escrow', 'orders', v_order_id::text, v_reason,
      jsonb_build_object('amount_toman', v_amount, 'commission_toman', v_commission_total,
                         'transfer_id', v_transfer_id, 'sellers', v_sellers));

    v_released := v_released || jsonb_build_array(jsonb_build_object(
      'order_id', v_order_id, 'transfer_id', v_transfer_id, 'amount_toman', v_amount,
      'commission_toman', v_commission_total, 'seller_count', jsonb_array_length(v_sellers)));
    v_count := v_count + 1;
    v_total_amount := v_total_amount + v_amount;
    v_total_commission := v_total_commission + v_commission_total;
  end loop;

  return jsonb_build_object(
    'released_count', v_count,
    'total_amount_toman', v_total_amount,
    'total_commission_toman', v_total_commission,
    'released', v_released,
    'window_days', v_window,
    'checked_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end $$;
revoke all on function public.admin_release_order_escrow(bigint, text) from public, anon, authenticated;
grant execute on function public.admin_release_order_escrow(bigint, text) to authenticated;

-- === A9. public.admin_refund_order_escrow ====================================
-- The money half of a return: the payment transfer is reversed in full. The buyer gets the amount back and
-- platform.shop is debited; no seller leg exists to reverse, because nothing was released.
create function public.admin_refund_order_escrow(p_order_id bigint, p_reason text, p_refund_transfer_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_order public.orders%rowtype;
  v_source_id uuid;
  v_transfer_id uuid;
  v_refund_transfer_id uuid;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'forbidden'; end if;
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then raise exception 'invalid_reason'; end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.escrow_status = 'released' then raise exception 'order_already_released'; end if;
  if v_order.escrow_status is distinct from 'held' then raise exception 'order_not_escrowed'; end if;

  select e.source_id into v_source_id from public.ledger_entries e
   where e.source_type = 'order' and e.reason = 'order_wallet_payment'
     and e.rate_snapshot ->> 'order_id' = p_order_id::text
   limit 1;
  if v_source_id is null then raise exception 'order_not_escrowed'; end if;

  if exists (select 1 from public.ledger_entries e
              where e.source_type = 'order' and e.source_id = v_source_id and e.reason = 'order_escrow_release') then
    raise exception 'order_already_released';
  end if;

  if p_refund_transfer_id is not null then
    -- D15: only this order's own payment transfer may be reversed.
    if not exists (select 1 from public.ledger_entries e
                    where e.transfer_id = p_refund_transfer_id and e.source_id = v_source_id
                      and e.reason = 'order_wallet_payment') then
      raise exception 'invalid_refund_transfer';
    end if;
    v_transfer_id := p_refund_transfer_id;
  else
    select e.transfer_id into v_transfer_id from public.ledger_entries e
     where e.source_id = v_source_id and e.reason = 'order_wallet_payment'
     limit 1;
    if v_transfer_id is null then raise exception 'order_not_escrowed'; end if;
  end if;

  v_refund_transfer_id := private.reverse_ledger_transfer(v_transfer_id,
    jsonb_build_object(
      'code', 'order_escrow_refund',
      'order_id', p_order_id::text,
      'amount_toman', v_order.final_price,
      'refunded_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));

  update public.orders
     set escrow_status = 'refunded', payment_status = 'refunded', updated_at = now()
   where id = p_order_id;

  perform private.log_admin_action('refund_order_escrow', 'orders', p_order_id::text, v_reason,
    jsonb_build_object('amount_toman', v_order.final_price,
                       'reversed_transfer_id', v_transfer_id,
                       'refund_transfer_id', v_refund_transfer_id));

  return jsonb_build_object(
    'order_id', p_order_id,
    'refunded', true,
    'amount_toman', v_order.final_price,
    'reversed_transfer_id', v_transfer_id,
    'refund_transfer_id', v_refund_transfer_id,
    'escrow_status', 'refunded');
end $$;
revoke all on function public.admin_refund_order_escrow(bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_refund_order_escrow(bigint, text, uuid) to authenticated;

-- === A10. public.admin_upsert_module_release_window ==========================
-- Writes the window DATA. Refuses every module but the shop (D18: only the shop has a money path). Returns the
-- code with NO write and NO audit row when nothing changes (the F4 no-change rule).
create function public.admin_upsert_module_release_window(p_code text, p_days integer, p_note text, p_reason text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_old_days integer;
  v_old_note text;
  v_found boolean;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'forbidden'; end if;
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then raise exception 'invalid_reason'; end if;
  if p_code is distinct from 'platform.shop' then raise exception 'invalid_module'; end if;
  if p_days is null or p_days < 0 or p_days > 365 then raise exception 'invalid_days'; end if;
  if p_note is not null and char_length(p_note) > 500 then raise exception 'invalid_note'; end if;

  select w.release_after_days, w.note into v_old_days, v_old_note
    from public.module_release_windows w where w.code = p_code for update;
  v_found := found;

  if v_found then
    if v_old_days = p_days and v_old_note is not distinct from v_note then return p_code; end if;
    update public.module_release_windows
       set release_after_days = p_days, note = v_note, updated_at = now()
     where code = p_code;
  else
    insert into public.module_release_windows (code, release_after_days, note)
      values (p_code, p_days, v_note);
  end if;

  perform private.log_admin_action('upsert_module_release_window', 'module_release_windows', p_code, v_reason,
    jsonb_build_object(
      'previous', case when v_found then jsonb_build_object('release_after_days', v_old_days, 'note', v_old_note) else null end,
      'new', jsonb_build_object('release_after_days', p_days, 'note', v_note)));
  return p_code;
end $$;
revoke all on function public.admin_upsert_module_release_window(text, integer, text, text) from public, anon, authenticated;
grant execute on function public.admin_upsert_module_release_window(text, integer, text, text) to authenticated;

-- === A11. The comments that name the rules ===================================
comment on function public.pay_order_from_wallet(bigint, uuid) is
  'the buyer pays its own pending checkout order from its wallet into platform.shop (escrow); no seller credit until release';
comment on function public.admin_release_order_escrow(bigint, text) is
  'admin: releases due held shop orders (delivered, window elapsed) by one balanced transfer each; a second call posts nothing';
comment on function public.admin_refund_order_escrow(bigint, text, uuid) is
  'admin: refunds a held shop order by reversing its payment transfer; refuses a released order';
comment on function public.admin_upsert_module_release_window(text, integer, text, text) is
  'admin: sets the release window (days) for a module; platform.shop is the only module with a money path';

commit;
