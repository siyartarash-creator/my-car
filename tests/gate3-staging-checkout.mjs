// Gate 3-B: checkout / idempotency / order-isolation / cancellation validation against STAGING only.
// Uses the anon key already configured in .env.local. Never logs secrets, tokens or keys.
// Reuses the existing reusable gate3 product fixture (id=1, slug='gate3-test-part').
// Per owner authorization, gate3-* identities/offers/orders created here are LEFT IN PLACE (not cleaned up).
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";

const STAGING_REF = "hhkwntnbycpbypsaqvrc";
const PROD_REF = "peztuerebqkfrqlmxfdm";
const STAGING_ORIGIN = `https://${STAGING_REF}.supabase.co`;
const FIXTURE_PRODUCT_ID = 1;

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

// Exact-origin check (not substring): a URL like https://evil.example/?x=<ref>
// or https://<ref>.supabase.co.evil.example would pass a naive `.includes()`
// test. Require the scheme+host to match the authorized Staging origin exactly.
function assertExactStagingOrigin(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    console.error("RESULT=ABORT reason=invalid_supabase_url");
    process.exit(1);
  }
  if (parsed.protocol !== "https:" || parsed.origin !== STAGING_ORIGIN || parsed.hostname.includes(PROD_REF)) {
    console.error("RESULT=ABORT reason=env_not_pointed_at_staging");
    process.exit(1);
  }
}

// Refuse to silently follow a redirect away from the verified Staging origin.
function noRedirectFetch(input, init) {
  return fetch(input, { ...init, redirect: "error" });
}

const env = loadEnv(new URL("../.env.local", import.meta.url));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error("RESULT=ABORT reason=missing_env_vars");
  process.exit(1);
}
assertExactStagingOrigin(url);

const results = [];
function record(name, status, reason) {
  results.push({ name, status, reason: reason || "" });
  console.log(`[${status}] ${name}${reason ? " -- " + reason : ""}`);
}

function newClient() {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: noRedirectFetch },
  });
}

function randDigits(n) {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}
const RUN_ID = Date.now().toString(36) + randDigits(3);
const PASSWORD = "Gate3co-" + randDigits(6) + "aA!";

function identity(role, userType) {
  return {
    email: `gate3-co-${role}-${RUN_ID}@mycar.local`,
    password: PASSWORD,
    name: `gate3 co ${role} ${RUN_ID}`,
    mobile: "09" + randDigits(9),
    user_type: userType,
  };
}

const idSellerA = identity("sellerA", "seller");
const idSellerB = identity("sellerB", "seller");
const idCustomerA = identity("customerA", "owner");
const idCustomerB = identity("customerB", "owner");

const createdIdentities = [];

async function signUpAndSignIn(id) {
  const client = newClient();
  const { data: signUpData, error: signUpError } = await client.auth.signUp({
    email: id.email,
    password: id.password,
    options: { data: { name: id.name, mobile: id.mobile, user_type: id.user_type } },
  });
  if (signUpError) return { client, ok: false, stage: "signup", error: signUpError.message };
  createdIdentities.push(id.email);
  if (signUpData.session) return { client, ok: true, user: signUpData.user };
  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
    email: id.email,
    password: id.password,
  });
  if (signInError) return { client, ok: false, stage: "signin_after_signup", error: signInError.message };
  return { client, ok: true, user: signInData.user };
}

function address(mobile, line) {
  return { full_name: "Gate3 Checkout Tester", mobile, province: "Tehran", city: "Tehran", street: `gate3 checkout test street ${line}` };
}

async function getOfferStock(client, offerId) {
  const { data, error } = await client.from("product_sellers").select("stock").eq("id", offerId).single();
  if (error) throw error;
  return data.stock;
}

async function main() {
  console.log("STAGING_TARGET_URL_HOST=" + new URL(url).hostname);

  const [sellerA, sellerB, customerA, customerB] = await Promise.all([
    signUpAndSignIn(idSellerA),
    signUpAndSignIn(idSellerB),
    signUpAndSignIn(idCustomerA),
    signUpAndSignIn(idCustomerB),
  ]);
  const allOk = [sellerA, sellerB, customerA, customerB].every((r) => r.ok);
  if (!allOk) {
    record("gate3_checkout_identities_signup", "FAIL", [sellerA, sellerB, customerA, customerB].filter((r) => !r.ok).map((r) => `${r.stage}:${r.error}`).join(" | "));
    printSummaryAndExit();
    return;
  }
  record("gate3_checkout_identities_signup", "PASS");

  // --- 1. Seller Offers ---
  let offerAId = null, offerBId = null;
  try {
    const { data, error } = await sellerA.client.rpc("save_offer", {
      p_product_id: FIXTURE_PRODUCT_ID, p_offer_id: null, p_price: 100000, p_discount_price: null,
      p_stock: 20, p_warranty: "gate3", p_shipping: "gate3", p_notes: "gate3 checkout offer A", p_hidden: false,
    });
    if (error) throw error;
    offerAId = data;
  } catch (e) {
    record("seller_offers_created", "FAIL", "sellerA save_offer: " + e.message);
  }
  try {
    const { data, error } = await sellerB.client.rpc("save_offer", {
      p_product_id: FIXTURE_PRODUCT_ID, p_offer_id: null, p_price: 150000, p_discount_price: null,
      p_stock: 15, p_warranty: "gate3", p_shipping: "gate3", p_notes: "gate3 checkout offer B", p_hidden: false,
    });
    if (error) throw error;
    offerBId = data;
  } catch (e) {
    record("seller_offers_created", "FAIL", "sellerB save_offer: " + e.message);
  }
  if (offerAId != null && offerBId != null) {
    try {
      const anon = newClient();
      const { data, error } = await anon.from("product_sellers").select("id,is_active,is_hidden_by_seller,stock").in("id", [offerAId, offerBId]);
      if (error) throw error;
      const ok = data.length === 2 && data.every((o) => o.is_active === true && o.is_hidden_by_seller === false);
      record("seller_offers_created", ok ? "PASS" : "FAIL", ok ? "" : "offers not visible/active in public catalog read");
    } catch (e) {
      record("seller_offers_created", "FAIL", "public catalog read: " + e.message);
    }
  }

  if (offerAId == null || offerBId == null) {
    record("checkout", "BLOCKED", "offer creation failed, cannot proceed");
    printSummaryAndExit();
    return;
  }

  const stockA0 = await getOfferStock(sellerA.client, offerAId);
  const stockB0 = await getOfferStock(sellerB.client, offerBId);

  // --- 2. Checkout (two-seller order1) ---
  const order1Items = [{ offer_id: offerAId, quantity: 1 }, { offer_id: offerBId, quantity: 1 }];
  const order1Address = address(idCustomerA.mobile, "order1");
  const order1Key = randomUUID();
  let order1Id = null, order1Total = null;
  try {
    const { data: quote, error: qErr } = await customerA.client.rpc("quote_checkout", { p_items: order1Items, p_coupon: null });
    if (qErr) throw qErr;
    order1Total = quote.total;
    const { data: order, error } = await customerA.client.rpc("place_order", {
      p_items: order1Items, p_address: order1Address, p_key: order1Key, p_expected_total: order1Total, p_coupon: null,
    });
    if (error) throw error;
    order1Id = order.order_id;
    const stockA1 = await getOfferStock(sellerA.client, offerAId);
    const stockB1 = await getOfferStock(sellerB.client, offerBId);
    const stockOk = stockA1 === stockA0 - 1 && stockB1 === stockB0 - 1;
    const { data: fulfillments, error: fErr } = await sellerA.client.from("seller_fulfillments").select("id,seller_id").eq("order_id", order1Id);
    // sellerA can only see their own row via RLS; use a combined check via each seller's own visibility instead of counting all rows as one caller.
    const { data: fulfillmentsA } = await sellerA.client.from("seller_fulfillments").select("id").eq("order_id", order1Id);
    const { data: fulfillmentsB } = await sellerB.client.from("seller_fulfillments").select("id").eq("order_id", order1Id);
    const twoFulfillments = (fulfillmentsA || []).length === 1 && (fulfillmentsB || []).length === 1;
    record("checkout_two_seller_order", stockOk && twoFulfillments ? "PASS" : "FAIL",
      stockOk && twoFulfillments ? "" : `stockOk=${stockOk} twoFulfillments=${twoFulfillments} (A:${stockA0}->${stockA1} B:${stockB0}->${stockB1})`);
  } catch (e) {
    record("checkout_two_seller_order", "FAIL", e.message);
  }

  if (order1Id == null) {
    record("duplicate_idempotency_protection", "BLOCKED", "no order1 to test against");
    record("order_items_ownership_isolation", "BLOCKED", "no order1 to test against");
    record("seller_fulfillment_isolation", "BLOCKED", "no order1 to test against");
    record("two_seller_pricing_stock_integrity", "BLOCKED", "no order1 to test against");
    record("customer_seller_cross_account_isolation", "BLOCKED", "no order1 to test against");
    record("cancellation", "BLOCKED", "no order1 to test against");
    printSummaryAndExit();
    return;
  }

  // --- 3. Duplicate / idempotency protection ---
  try {
    const { data: replay, error } = await customerA.client.rpc("place_order", {
      p_items: order1Items, p_address: order1Address, p_key: order1Key, p_expected_total: order1Total, p_coupon: null,
    });
    if (error) throw error;
    const sameOrder = replay.order_id === order1Id;
    record("idempotent_replay_same_payload_returns_same_order", sameOrder ? "PASS" : "FAIL", sameOrder ? "" : `replay created a different order: ${replay.order_id}`);
  } catch (e) {
    record("idempotent_replay_same_payload_returns_same_order", "FAIL", e.message);
  }
  try {
    const differentItems = [{ offer_id: offerAId, quantity: 2 }, { offer_id: offerBId, quantity: 1 }];
    const { error } = await customerA.client.rpc("place_order", {
      p_items: differentItems, p_address: order1Address, p_key: order1Key, p_expected_total: order1Total, p_coupon: null,
    });
    record("idempotency_conflict_rejected_on_changed_payload", error ? "PASS" : "FAIL", error ? "" : "changed payload with same key was accepted — CRITICAL");
  } catch (e) {
    record("idempotency_conflict_rejected_on_changed_payload", "PASS", "denied with error: " + e.message);
  }
  record("duplicate_idempotency_protection", results.slice(-2).every((r) => r.status === "PASS") ? "PASS" : "FAIL");

  // --- 4. order_items ownership isolation ---
  try {
    const { data, error } = await customerB.client.from("order_items").select("id,offer_id").eq("order_id", order1Id);
    if (error) throw error;
    const unrelatedBuyerDenied = data.length === 0;
    const { data: aItems, error: aErr } = await sellerA.client.from("order_items").select("id,offer_id").eq("order_id", order1Id);
    if (aErr) throw aErr;
    const sellerASeesOnlyOwn = aItems.length === 1 && aItems[0].offer_id === offerAId;
    const { data: bItems, error: bErr } = await sellerB.client.from("order_items").select("id,offer_id").eq("order_id", order1Id);
    if (bErr) throw bErr;
    const sellerBSeesOnlyOwn = bItems.length === 1 && bItems[0].offer_id === offerBId;
    const ok = unrelatedBuyerDenied && sellerASeesOnlyOwn && sellerBSeesOnlyOwn;
    record("order_items_ownership_isolation", ok ? "PASS" : "FAIL",
      ok ? "" : `unrelatedBuyerDenied=${unrelatedBuyerDenied} sellerASeesOnlyOwn=${sellerASeesOnlyOwn}(${aItems.length}) sellerBSeesOnlyOwn=${sellerBSeesOnlyOwn}(${bItems.length}) — this is exactly the class of defect fixed by 202609300000_fix_order_visibility.sql`);
  } catch (e) {
    record("order_items_ownership_isolation", "FAIL", e.message);
  }

  // --- 5. seller_fulfillment isolation ---
  try {
    const { data: aFul, error: aErr } = await sellerA.client.from("seller_fulfillments").select("id,seller_id").eq("order_id", order1Id);
    if (aErr) throw aErr;
    const sellerASeesOnlyOwn = aFul.length === 1 && aFul[0].seller_id === sellerA.user.id;
    const { data: bFul, error: bErr } = await sellerB.client.from("seller_fulfillments").select("id,seller_id").eq("order_id", order1Id);
    if (bErr) throw bErr;
    const sellerBSeesOnlyOwn = bFul.length === 1 && bFul[0].seller_id === sellerB.user.id;
    const ok = sellerASeesOnlyOwn && sellerBSeesOnlyOwn;
    record("seller_fulfillment_isolation", ok ? "PASS" : "FAIL", ok ? "" : `sellerASeesOnlyOwn=${sellerASeesOnlyOwn} sellerBSeesOnlyOwn=${sellerBSeesOnlyOwn}`);
  } catch (e) {
    record("seller_fulfillment_isolation", "FAIL", e.message);
  }

  // --- 6. Two-seller pricing/stock integrity: buyer cannot set price, fresh attempt ---
  try {
    const stockABefore = await getOfferStock(sellerA.client, offerAId);
    const stockBBefore = await getOfferStock(sellerB.client, offerBId);
    const { error } = await customerA.client.rpc("place_order", {
      p_items: order1Items, p_address: address(idCustomerA.mobile, "priceattack"), p_key: randomUUID(), p_expected_total: 1, p_coupon: null,
    });
    const rejected = !!error;
    const stockAAfter = await getOfferStock(sellerA.client, offerAId);
    const stockBAfter = await getOfferStock(sellerB.client, offerBId);
    const stockUnchanged = stockAAfter === stockABefore && stockBAfter === stockBBefore;
    const ok = rejected && stockUnchanged;
    record("two_seller_pricing_stock_integrity", ok ? "PASS" : "FAIL", ok ? "" : `rejected=${rejected} stockUnchanged=${stockUnchanged} (buyer-supplied total=1 vs real total=${order1Total}) — CRITICAL if not rejected`);
  } catch (e) {
    record("two_seller_pricing_stock_integrity", "FAIL", "unexpected: " + e.message);
  }

  // --- 7. customer/seller cross-account isolation ---
  try {
    const { data, error } = await customerB.client.from("orders").select("id").eq("id", order1Id);
    if (error) throw error;
    const orderHidden = data.length === 0;
    // separate order2: single-seller (sellerA only) so an unrelated seller (sellerB) has zero fulfillment rows on it.
    const order2Items = [{ offer_id: offerAId, quantity: 1 }];
    const { data: quote2, error: q2Err } = await customerA.client.rpc("quote_checkout", { p_items: order2Items, p_coupon: null });
    if (q2Err) throw q2Err;
    const { data: order2, error: o2Err } = await customerA.client.rpc("place_order", {
      p_items: order2Items, p_address: address(idCustomerA.mobile, "order2"), p_key: randomUUID(), p_expected_total: quote2.total, p_coupon: null,
    });
    if (o2Err) throw o2Err;
    const order2Id = order2.order_id;
    const { error: sbAdvErr } = await sellerB.client.rpc("advance_fulfillment", { p_order_id: order2Id, p_status: "processing" });
    const unrelatedSellerCannotAdvance = !!sbAdvErr;
    // sellerA (the real seller on order2) CAN advance their own fulfillment.
    const { error: advErrA } = await sellerA.client.rpc("advance_fulfillment", { p_order_id: order2Id, p_status: "processing" });
    const ownerSellerCanAdvance = !advErrA;
    const ok = orderHidden && unrelatedSellerCannotAdvance && ownerSellerCanAdvance;
    record("customer_seller_cross_account_isolation", ok ? "PASS" : "FAIL",
      ok ? "" : `orderHidden=${orderHidden} unrelatedSellerCannotAdvance=${unrelatedSellerCannotAdvance} ownerSellerCanAdvance=${ownerSellerCanAdvance}`);
  } catch (e) {
    record("customer_seller_cross_account_isolation", "FAIL", e.message);
  }

  // --- 8. Cancellation (on order1, still fully pending) ---
  try {
    const stockABefore = await getOfferStock(sellerA.client, offerAId);
    const stockBBefore = await getOfferStock(sellerB.client, offerBId);
    const { error } = await customerA.client.rpc("cancel_order", { p_order_id: order1Id });
    if (error) throw error;
    const stockAAfter = await getOfferStock(sellerA.client, offerAId);
    const stockBAfter = await getOfferStock(sellerB.client, offerBId);
    const restoredOnce = stockAAfter === stockABefore + 1 && stockBAfter === stockBBefore + 1;
    // Cancel again: must be a no-op (status already 'cancelled'), not a second restoration.
    const { error: err2 } = await customerA.client.rpc("cancel_order", { p_order_id: order1Id });
    const stockAAfter2 = await getOfferStock(sellerA.client, offerAId);
    const stockBAfter2 = await getOfferStock(sellerB.client, offerBId);
    const noDoubleRestore = !err2 && stockAAfter2 === stockAAfter && stockBAfter2 === stockBAfter;
    const ok = restoredOnce && noDoubleRestore;
    record("cancellation", ok ? "PASS" : "FAIL", ok ? "" : `restoredOnce=${restoredOnce} noDoubleRestore=${noDoubleRestore}`);
  } catch (e) {
    record("cancellation", "FAIL", e.message);
  }

  printSummaryAndExit();
}

function printSummaryAndExit() {
  const fail = results.filter((r) => r.status === "FAIL");
  console.log("\n--- SUMMARY ---");
  console.log(`PASS=${results.filter((r) => r.status === "PASS").length} FAIL=${fail.length} BLOCKED=${results.filter((r) => r.status === "BLOCKED").length}`);
  console.log("gate3_identities_created=" + createdIdentities.join(","));
  process.exit(fail.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("RESULT=CRASH", e.message);
  process.exit(2);
});
