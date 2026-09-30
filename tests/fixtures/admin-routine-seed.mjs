// Admin Panel Completion, Checkpoint D: deterministic routine test dataset.
//
// LOCAL/EPHEMERAL ONLY. This module never touches Production or Staging --
// it takes a PGlite `db` handle (an in-memory Postgres instance the caller
// created and migrated, exactly like tests/database-security.mjs's own
// `run()`) and writes into that ephemeral instance only. It has no
// connection string, no network call, and no Supabase project reference of
// any kind, so there is no remote target it could accidentally reach.
//
// Every seeded row goes through the SAME SECURITY DEFINER RPCs the real
// app uses (save_offer, place_order, advance_fulfillment, cancel_order,
// admin_grant_permission, approve_discount_request, reject_discount_request,
// deactivate_offer, review_product_request, admin_create_coupon,
// admin_set_coupon_active) -- never a raw INSERT that bypasses the business
// rules those RPCs enforce, except for the bootstrap identity rows
// (auth.users/profiles) that nothing else can create for you and the
// historical created_at backdating (business RPCs have no such parameter).
// This keeps the seeded state exactly as reachable/attackable as real data,
// which is what a future adversarial Store Security Agent needs.
//
// Deterministic identity namespace (reserved, never reused elsewhere in
// this test suite -- tests/database-security.mjs uses 00000000-/10000000-/
// 90000000-/91-94 prefixes for its own fixtures):
//   d0000000-...-0001                 Super Admin
//   c0000000-...-000{1-4}             4 operators, one permission combo each
//   a0000000-...-000{1-5}             5 sellers
//   b0000000-...-000{1-5}             5 buyers
//   e0000000-...-{i in 000000000000..000000000049}   order idempotency keys
//   seed-part-{1..30}                 product slugs
//   SEEDCP{1..4}                      coupon codes
// resetRoutineDataset() removes exactly these, in FK-safe order, and
// nothing else -- safe to call against a database already holding other
// (e.g. hand-written test) fixtures.

export const SEED_IDENTITIES = {
  admin: { id: "d0000000-0000-0000-0000-000000000001", name: "ادمین تست", mobile: "09180000001" },
  operators: [
    { id: "c0000000-0000-0000-0000-000000000001", name: "اپراتور تست ۱", mobile: "09180000011", permissions: ["discounts.approve"] },
    { id: "c0000000-0000-0000-0000-000000000002", name: "اپراتور تست ۲", mobile: "09180000012", permissions: ["offers.moderate"] },
    { id: "c0000000-0000-0000-0000-000000000003", name: "اپراتور تست ۳", mobile: "09180000013", permissions: ["requests.review", "coupons.manage"] },
    { id: "c0000000-0000-0000-0000-000000000004", name: "اپراتور تست ۴", mobile: "09180000014", permissions: ["orders.read"] },
  ],
  sellers: Array.from({ length: 5 }, (_, i) => ({
    id: `a0000000-0000-0000-0000-00000000000${i + 1}`,
    name: `فروشنده تست ${i + 1}`,
    mobile: `0918000002${i + 1}`,
  })),
  buyers: Array.from({ length: 5 }, (_, i) => ({
    id: `b0000000-0000-0000-0000-00000000000${i + 1}`,
    name: `خریدار تست ${i + 1}`,
    mobile: `0918000003${i + 1}`,
  })),
  couponCodes: ["SEEDCP1", "SEEDCP2", "SEEDCP3", "SEEDCP4"],
  productSlugPrefix: "seed-part-",
  orderKeyPrefix: "e0000000-0000-0000-0000-",
};

const PRODUCT_COUNT = 30;
const ORDER_COUNT = 50;
const ADDRESS_BY_BUYER = (buyer) => ({
  full_name: buyer.name,
  mobile: buyer.mobile,
  province: "تهران",
  city: "تهران",
  street: "خیابان آزمایشی، پلاک ۱",
});

async function asRole(db, uid, fn) {
  await db.exec(`set role ${uid ? "authenticated" : "anon"}; select set_config('request.jwt.claim.sub','${uid ?? ""}',false);`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

/**
 * Seeds the routine Checkpoint D dataset into an already-migrated PGlite
 * `db`. Returns { totals } computed from what was actually inserted --
 * these are the "exact expected deterministic dashboard totals", derived
 * from the same code that created the data, never hand-typed separately.
 */
export async function seedRoutineDataset(db) {
  const S = SEED_IDENTITIES;

  // === 1. Bootstrap identities via auth.users + raw_user_meta_data, the
  // same pattern every real identity in tests/database-security.mjs uses
  // (e.g. its own `insert into auth.users values ('${buyer}','{"name":...,
  // "mobile":...,"user_type":...}')`), NOT a direct public.profiles
  // INSERT. public.profiles has its own trigger, private.create_profile()
  // (supabase/migrations/202609290001_security_foundation.sql), that fires
  // AFTER INSERT on auth.users and derives name/user_type/mobile from
  // new.raw_user_meta_data, requiring name length>=3 and mobile matching
  // ^09[0-9]{9}$ -- an auth.users row inserted with no metadata (or a
  // separate direct profiles INSERT racing/duplicating it) is exactly the
  // "invalid_profile" contract violation this fixes. The trigger also
  // always hardcodes is_admin=false regardless of metadata (by design --
  // see the existing "Trusted server-side profile creation ignores forged
  // administrator metadata" test) -- so the Super Admin identity is
  // created the same way `other` is made Super Admin in
  // tests/database-security.mjs: a plain profile first, then a direct
  // `update profiles set is_admin=true` as a separate, explicit step. ====
  const allProfiles = [
    { ...S.admin, user_type: "owner" },
    ...S.operators.map((o) => ({ ...o, user_type: "owner" })),
    ...S.sellers.map((s) => ({ ...s, user_type: "seller" })),
    ...S.buyers.map((b) => ({ ...b, user_type: "owner" })),
  ];
  for (const p of allProfiles) {
    const metadata = JSON.stringify({ name: p.name, mobile: p.mobile, user_type: p.user_type });
    await db.exec(
      `insert into auth.users(id,raw_user_meta_data) values ('${p.id}','${metadata}') on conflict (id) do nothing;`,
    );
  }
  await db.exec(`update public.profiles set is_admin=true where id='${S.admin.id}'`);

  // === 2. Operator permission grants (admin_grant_permission, as Super
  // Admin) -- 4 distinct combinations, as required. ======================
  await asRole(db, S.admin.id, async () => {
    for (const op of S.operators) {
      for (const key of op.permissions) {
        await db.query(`select admin_grant_permission('${op.id}','${key}')`);
      }
    }
  });

  // === 3. Coupons (admin_create_coupon, as the requests.review+coupons.
  // manage operator) -- min_order_amount=0 on all of them so any seeded
  // order can validly redeem one, regardless of its subtotal. ============
  const op3 = S.operators[2]; // requests.review + coupons.manage
  await asRole(db, op3.id, async () => {
    await db.query(`select admin_create_coupon('${S.couponCodes[0]}','percent',10,0,null,10,null,'seed: 10% off')`);
    await db.query(`select admin_create_coupon('${S.couponCodes[1]}','fixed',20000,0,null,10,null,'seed: fixed 20000')`);
    await db.query(`select admin_create_coupon('${S.couponCodes[2]}','percent',50,0,null,10,null,'seed: 50% off')`);
    await db.query(`select admin_create_coupon('${S.couponCodes[3]}','percent',15,0,null,10,null,'seed: deactivated')`);
    const id4 = (await db.query(`select id from coupons where code='${S.couponCodes[3]}'`)).rows[0].id;
    await db.query(`select admin_set_coupon_active(${id4},false)`);
  });

  // === 4. Products + Offers (save_offer, as the owning seller). A 6-step
  // discount-percent cycle repeated 5x across the 30 products deterministically
  // produces: 5 no-discount, 5 at 10%, 5 at 20%, 5 at exactly the 35%
  // autonomous threshold (live), 5 at 45% and 5 at 60% (both above
  // threshold -> save_offer auto-creates a pending discount_request for
  // each, per Task 4.2A -- 10 pending requests total). =====================
  const DISCOUNT_PCT_CYCLE = [0, 10, 20, 35, 45, 60];
  const offers = []; // { id, productId, sellerIdx, price, discountPrice, pendingRequest }
  for (let i = 0; i < PRODUCT_COUNT; i++) {
    const sellerIdx = i % 5;
    const seller = S.sellers[sellerIdx];
    const price = 100000 + i * 5000;
    const pct = DISCOUNT_PCT_CYCLE[i % 6];
    const discountPrice = pct === 0 ? null : price - Math.round((price * pct) / 100);
    const pid = (
      await db.query(`insert into products(name,slug) values ('قطعه تست ${i + 1}','${S.productSlugPrefix}${i + 1}') returning id`)
    ).rows[0].id;
    const offerId = await asRole(db, seller.id, async () => {
      const r = await db.query(
        `select public.save_offer(${pid},null,${price},${discountPrice ?? "null"},50,null,null,null,false)`,
      );
      return r.rows[0].save_offer;
    });
    offers.push({ id: offerId, productId: pid, sellerIdx, price, discountPrice, pendingRequest: pct > 35 });
  }

  // === 5. Discount-request dispositions -- exercises every terminal
  // status (approved/rejected/superseded) plus a couple left pending, on
  // top of the 10 requests save_offer already created above. =============
  const pendingOfferIds = offers.filter((o) => o.pendingRequest).map((o) => o.id); // 10 ids, creation order
  const requestIdFor = async (offerId) =>
    (await db.query(`select id from discount_requests where offer_id=${offerId} and status='pending' order by id desc limit 1`)).rows[0].id;
  const op1 = S.operators[0]; // discounts.approve
  const discountStatusCounts = { pending: 0, approved: 0, rejected: 0, superseded: 0 };
  // approve: offers 0,2,4,6 of the pending list (4 total)
  for (const idx of [0, 2, 4, 6]) {
    const reqId = await requestIdFor(pendingOfferIds[idx]);
    await asRole(db, op1.id, () => db.query(`select approve_discount_request(${reqId})`));
    discountStatusCounts.approved++;
  }
  // reject: offers 1,3,5 of the pending list (3 total)
  for (const idx of [1, 3, 5]) {
    const reqId = await requestIdFor(pendingOfferIds[idx]);
    await asRole(db, op1.id, () => db.query(`select reject_discount_request(${reqId},'seed: above policy comfort zone')`));
    discountStatusCounts.rejected++;
  }
  // leave pending as-is: offers 7,8 of the pending list (2 total)
  discountStatusCounts.pending += 2;
  // supersede: offer 9 of the pending list -- a fresh above-threshold ask on
  // the same Offer (unchanged price) marks the old request 'superseded' and
  // creates a brand-new 'pending' one.
  {
    const offer = offers.find((o) => o.id === pendingOfferIds[9]);
    const seller = S.sellers[offer.sellerIdx];
    const newDiscount = offer.price - Math.round(offer.price * 0.5); // 50% off, still above threshold
    await asRole(db, seller.id, () =>
      db.query(`select public.save_offer(${offer.productId},${offer.id},${offer.price},${newDiscount},50,null,null,null,false)`),
    );
    discountStatusCounts.superseded += 1;
    discountStatusCounts.pending += 1; // the new pending request this created
  }

  // === 6. Place 50 orders (place_order, as the respective buyer). Every
  // 3rd order (i % 3 === 0) draws Offers from two different sellers
  // (multi-seller order); offerIdx2 = (offerIdx1 + 6) % 30 always lands on
  // a different seller because sellers are assigned product-index % 5 and
  // 6 mod 5 = 1 (and 30, the wrap modulus, is itself a multiple of 5, so
  // the wrap never breaks that offset). Every order's total is taken from
  // quote_checkout's own return, never computed by hand, so it always
  // matches what place_order will actually charge. ========================
  const ORDER_STATUS_CYCLE = ["pending", "processing", "shipped", "delivered", "cancelled"];
  const orderIds = [];
  let orderValueTotal = 0;
  const orderStatusCounts = { pending: 0, processing: 0, shipped: 0, delivered: 0, cancelled: 0 };
  let multiSellerOrderCount = 0;
  let couponRedemptions = 0;

  for (let i = 0; i < ORDER_COUNT; i++) {
    const buyer = S.buyers[i % 5];
    const multiSeller = i % 3 === 0;
    const offerIdx1 = (i * 7) % PRODUCT_COUNT;
    const offerIdx2 = (offerIdx1 + 6) % PRODUCT_COUNT;
    const items = multiSeller
      ? [{ offer_id: offers[offerIdx1].id, quantity: 1 }, { offer_id: offers[offerIdx2].id, quantity: 1 }]
      : [{ offer_id: offers[offerIdx1].id, quantity: 1 }];
    if (multiSeller) multiSellerOrderCount++;

    const useCoupon = i % 10 === 0; // 5 orders, all buyer[0], well under max_uses_per_user=10
    const couponArg = useCoupon ? S.couponCodes[0] : null;
    const itemsJson = JSON.stringify(items);
    const address = ADDRESS_BY_BUYER(buyer);
    const key = `${S.orderKeyPrefix}${String(i).padStart(12, "0")}`;

    const { orderId, total, sellerIdxs } = await asRole(db, buyer.id, async () => {
      const quote = (
        await db.query(`select quote_checkout('${itemsJson}',${couponArg ? `'${couponArg}'` : "null"})`)
      ).rows[0].quote_checkout;
      const placed = (
        await db.query(
          `select public.place_order('${itemsJson}','${JSON.stringify(address)}','${key}',${quote.total},${couponArg ? `'${couponArg}'` : "null"})`,
        )
      ).rows[0].place_order;
      return {
        orderId: placed.order_id,
        total: placed.total,
        sellerIdxs: multiSeller ? [offers[offerIdx1].sellerIdx, offers[offerIdx2].sellerIdx] : [offers[offerIdx1].sellerIdx],
      };
    });
    orderIds.push(orderId);
    orderValueTotal += total;
    if (useCoupon) couponRedemptions++;

    // Backdate created_at for a real historical spread (the checkout RPC
    // always uses now(); no business RPC takes a created_at parameter, so
    // this one field is set with a direct UPDATE, same as other fixtures
    // in this suite backdate timestamps).
    const daysAgo = i % 10;
    await db.query(`update orders set created_at=now() - interval '${daysAgo} days' where id=${orderId}`);

    // Drive the order to its deterministic target status.
    const target = ORDER_STATUS_CYCLE[i % 5];
    if (target === "pending") {
      // no further action
    } else if (target === "cancelled") {
      await asRole(db, buyer.id, () => db.query(`select cancel_order(${orderId})`));
    } else {
      const steps = target === "processing" ? ["processing"] : target === "shipped" ? ["processing", "shipped"] : ["processing", "shipped", "delivered"];
      for (const sellerIdx of new Set(sellerIdxs)) {
        const sellerId = S.sellers[sellerIdx].id;
        for (const step of steps) {
          await asRole(db, sellerId, () => db.query(`select advance_fulfillment(${orderId},'${step}')`));
        }
      }
    }
    orderStatusCounts[target]++;
  }

  // === 7. Offer moderation (deactivate_offer, as the offers.moderate
  // operator) -- runs AFTER orders are placed so it never blocks checkout.
  // Deactivates the 4 lowest-index no-discount Offers (indices 0,6,12,18). ===
  const op2 = S.operators[1]; // offers.moderate
  const deactivatedOfferIndices = [0, 6, 12, 18];
  for (const idx of deactivatedOfferIndices) {
    await asRole(db, op2.id, () => db.query(`select deactivate_offer(${offers[idx].id},'seed: routine dataset moderation example')`));
  }

  // === 8. Product requests (raw insert as the seller -- request_insert
  // policy requires seller_id=auth.uid(); then review_product_request, as
  // the requests.review operator, for 4 of the 6). ========================
  const productRequestStatusCounts = { pending: 0, contacted: 0, approved: 0, rejected: 0 };
  const prIds = [];
  for (let i = 0; i < 6; i++) {
    const seller = S.sellers[i % 5];
    await asRole(db, seller.id, () =>
      db.query(
        `insert into product_requests(seller_id,seller_name,product_name,brand) values (auth.uid(),'${seller.name}','قطعه درخواستی تست ${i + 1}','برند تست') returning id`,
      ),
    );
    const id = (await db.query(`select id from product_requests where product_name='قطعه درخواستی تست ${i + 1}'`)).rows[0].id;
    prIds.push(id);
  }
  const reviewPlan = [null, null, "contacted", "contacted", "approved", "rejected"]; // indices 0,1 stay pending
  for (let i = 0; i < prIds.length; i++) {
    const status = reviewPlan[i];
    if (!status) {
      productRequestStatusCounts.pending++;
      continue;
    }
    await asRole(db, op3.id, () => db.query(`select review_product_request(${prIds[i]},'${status}','seed: routine dataset review')`));
    productRequestStatusCounts[status]++;
  }

  const couponUsageTotal = couponRedemptions; // == sum(coupons.used_count) after seeding

  return {
    identities: S,
    totals: {
      productCount: PRODUCT_COUNT,
      offerCount: PRODUCT_COUNT,
      offerActive: PRODUCT_COUNT - deactivatedOfferIndices.length,
      offerInactive: deactivatedOfferIndices.length,
      sellerCount: S.sellers.length,
      orderCount: ORDER_COUNT,
      orderValueTotal,
      orderStatusCounts,
      multiSellerOrderCount,
      discountRequestStatusCounts: discountStatusCounts,
      discountRequestTotal: Object.values(discountStatusCounts).reduce((a, b) => a + b, 0),
      productRequestStatusCounts,
      productRequestTotal: prIds.length,
      couponCount: S.couponCodes.length,
      couponUsageTotal,
      operatorCount: S.operators.length,
    },
    orderIds,
    offerIds: offers.map((o) => o.id),
  };
}

/**
 * Removes exactly the rows seedRoutineDataset() creates (by the reserved
 * identity/slug/key namespace above), in FK-safe order. Safe to call even
 * if the dataset was never seeded (all deletes are conditional on matching
 * rows existing). Runs as superuser (bypasses RLS), same as bootstrap.
 */
export async function resetRoutineDataset(db) {
  const S = SEED_IDENTITIES;
  const sellerIds = S.sellers.map((s) => `'${s.id}'`).join(",");
  const operatorIds = S.operators.map((o) => `'${o.id}'`).join(",");
  const allProfileIds = [S.admin.id, ...S.operators.map((o) => o.id), ...S.sellers.map((s) => s.id), ...S.buyers.map((b) => b.id)]
    .map((id) => `'${id}'`)
    .join(",");

  await db.exec(`
    delete from order_items where order_id in (select id from orders where checkout_key::text like '${S.orderKeyPrefix}%');
    delete from seller_fulfillments where order_id in (select id from orders where checkout_key::text like '${S.orderKeyPrefix}%');
    delete from coupon_usages where coupon_id in (select id from coupons where code = any(array['${S.couponCodes.join("','")}']));
    delete from orders where checkout_key::text like '${S.orderKeyPrefix}%';
    delete from discount_requests where offer_id in (select id from product_sellers where product_id in (select id from products where slug like '${S.productSlugPrefix}%'));
    delete from product_sellers where product_id in (select id from products where slug like '${S.productSlugPrefix}%');
    delete from products where slug like '${S.productSlugPrefix}%';
    delete from product_requests where seller_id in (${sellerIds});
    delete from coupons where code = any(array['${S.couponCodes.join("','")}']);
    delete from operator_permissions where profile_id in (${operatorIds});
    delete from admin_audit_log where actor_id in (${operatorIds}, '${S.admin.id}');
    delete from profiles where id in (${allProfileIds});
    delete from auth.users where id in (${allProfileIds});
  `);
}
