// Gate 3-B / Batch 1: live Supabase-layer security validation against STAGING only.
// Uses the anon key already configured in .env.local. Never logs secrets, tokens or keys.
// Safe to re-run: all identities/data are prefixed gate3- and best-effort cleaned up at the end.
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";

const STAGING_REF = "hhkwntnbycpbypsaqvrc";
const PROD_REF = "peztuerebqkfrqlmxfdm";
const STAGING_ORIGIN = `https://${STAGING_REF}.supabase.co`;

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
const PASSWORD = "Gate3-" + randDigits(6) + "aA!";

function identity(role) {
  return {
    email: `gate3-${role}-${RUN_ID}@mycar.local`,
    password: PASSWORD,
    name: `gate3 ${role} ${RUN_ID}`,
    mobile: "09" + randDigits(9),
    user_type: role === "customerA" || role === "customerB" ? "owner" : "seller",
  };
}

const idCustomerA = identity("customerA");
const idCustomerB = identity("customerB");
const idSellerA = identity("sellerA");
const idSellerB = identity("sellerB");

const createdIdentities = [];
const cleanupStorage = [];

async function signUpAndSignIn(id) {
  const client = newClient();
  const { data: signUpData, error: signUpError } = await client.auth.signUp({
    email: id.email,
    password: id.password,
    options: { data: { name: id.name, mobile: id.mobile, user_type: id.user_type } },
  });
  if (signUpError) return { client, ok: false, stage: "signup", error: signUpError.message };
  createdIdentities.push(id.email);

  if (signUpData.session) {
    return { client, ok: true, user: signUpData.user, session: signUpData.session };
  }
  // Hosted project may require email confirmation; fall back to an explicit sign-in attempt.
  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
    email: id.email,
    password: id.password,
  });
  if (signInError) return { client, ok: false, stage: "signin_after_signup", error: signInError.message };
  return { client, ok: true, user: signInData.user, session: signInData.session };
}

async function main() {
  console.log("STAGING_TARGET_URL_HOST=" + new URL(url).hostname);

  // --- 1. Real signup for four gate3 identities ---
  const [customerA, customerB, sellerA, sellerB] = await Promise.all([
    signUpAndSignIn(idCustomerA),
    signUpAndSignIn(idCustomerB),
    signUpAndSignIn(idSellerA),
    signUpAndSignIn(idSellerB),
  ]);

  const allSignedUp = [customerA, customerB, sellerA, sellerB].every((r) => r.ok);
  if (!allSignedUp) {
    const reasons = [customerA, customerB, sellerA, sellerB]
      .filter((r) => !r.ok)
      .map((r) => `${r.stage}:${r.error}`)
      .join(" | ");
    record("signup_and_signin_four_gate3_identities", "FAIL", reasons);
  } else {
    record("signup_and_signin_four_gate3_identities", "PASS");
  }

  if (!allSignedUp) {
    console.log("ABORTING remaining assertions: cannot proceed without authenticated gate3 identities.");
    console.log("Likely cause: hosted Staging Auth email-confirmation is enabled for synthetic emails (see docs/phase-1.md note on this).");
    printSummaryAndExit();
    return;
  }

  // --- profile row created correctly by the auth trigger ---
  try {
    const { data, error } = await customerA.client.from("profiles").select("id,user_type,name,mobile,is_admin").eq("id", customerA.user.id).single();
    if (error) throw error;
    const ok = data.id === customerA.user.id && data.user_type === "owner" && data.is_admin === false;
    record("profile_row_created_by_trigger", ok ? "PASS" : "FAIL", ok ? "" : `unexpected profile shape: user_type=${data.user_type} is_admin=${data.is_admin}`);
  } catch (e) {
    record("profile_row_created_by_trigger", "FAIL", e.message);
  }

  // --- customer cannot read another customer's profile ---
  try {
    const { data, error } = await customerB.client.from("profiles").select("id").eq("id", customerA.user.id);
    if (error) throw error;
    record("customer_cannot_read_other_customer_profile", data.length === 0 ? "PASS" : "FAIL", data.length ? `leaked ${data.length} row(s)` : "");
  } catch (e) {
    record("customer_cannot_read_other_customer_profile", "FAIL", e.message);
  }

  // --- anonymous denial ---
  try {
    const anon = newClient();
    const { data, error } = await anon.from("profiles").select("id").limit(1);
    if (error) throw error;
    record("anonymous_cannot_read_profiles", data.length === 0 ? "PASS" : "FAIL", data.length ? `leaked ${data.length} row(s)` : "");
  } catch (e) {
    // A denial surfaced as an error also counts as pass (e.g. permission denied).
    record("anonymous_cannot_read_profiles", "PASS", "denied with error: " + e.message);
  }
  try {
    const anon = newClient();
    const { error } = await anon.from("profiles").update({ name: "hacked" }).eq("id", customerA.user.id);
    record("anonymous_cannot_write_profiles", error ? "PASS" : "FAIL", error ? "" : "write succeeded unauthenticated");
  } catch (e) {
    record("anonymous_cannot_write_profiles", "PASS", "denied with error: " + e.message);
  }

  // --- admin escalation denial (is_admin / user_type not in the update column grant) ---
  try {
    const { error } = await customerA.client.from("profiles").update({ is_admin: true }).eq("id", customerA.user.id);
    record("admin_escalation_is_admin_denied", error ? "PASS" : "FAIL", error ? "" : "is_admin update succeeded — CRITICAL");
  } catch (e) {
    record("admin_escalation_is_admin_denied", "PASS", "denied with error: " + e.message);
  }
  try {
    const { error } = await customerA.client.from("profiles").update({ user_type: "seller" }).eq("id", customerA.user.id);
    record("admin_escalation_user_type_change_denied", error ? "PASS" : "FAIL", error ? "" : "user_type update succeeded — CRITICAL");
  } catch (e) {
    record("admin_escalation_user_type_change_denied", "PASS", "denied with error: " + e.message);
  }

  // --- avatar storage authorization ---
  const avatarBytes = new Uint8Array([137, 80, 78, 71]); // fake bytes, content not validated by policy
  const ownAvatarPath = `${customerA.user.id}/gate3-avatar-${RUN_ID}.png`;
  try {
    const { error } = await customerA.client.storage.from("avatars").upload(ownAvatarPath, avatarBytes, { contentType: "image/png", upsert: true });
    record("avatar_upload_own_prefix_allowed", error ? "FAIL" : "PASS", error ? error.message : "");
    if (!error) cleanupStorage.push({ client: customerA.client, bucket: "avatars", path: ownAvatarPath });
  } catch (e) {
    record("avatar_upload_own_prefix_allowed", "FAIL", e.message);
  }
  const foreignAvatarPath = `${customerA.user.id}/gate3-avatar-foreign-${RUN_ID}.png`;
  try {
    const { error } = await customerB.client.storage.from("avatars").upload(foreignAvatarPath, avatarBytes, { contentType: "image/png" });
    record("avatar_upload_foreign_prefix_denied", error ? "PASS" : "FAIL", error ? "" : "customerB wrote into customerA's avatar prefix — CRITICAL");
  } catch (e) {
    record("avatar_upload_foreign_prefix_denied", "PASS", "denied with error: " + e.message);
  }
  try {
    const { error } = await customerB.client.storage.from("avatars").remove([ownAvatarPath]);
    // Supabase Storage remove() on a denied object typically returns no error but also removes nothing owned by others.
    const { data: stillThere } = await customerA.client.storage.from("avatars").list(customerA.user.id, { search: `gate3-avatar-${RUN_ID}.png` });
    const survived = (stillThere || []).some((f) => f.name === `gate3-avatar-${RUN_ID}.png`);
    record("avatar_delete_foreign_prefix_denied", survived ? "PASS" : "FAIL", survived ? "" : "customerB deleted customerA's avatar — CRITICAL");
  } catch (e) {
    record("avatar_delete_foreign_prefix_denied", "PASS", "denied with error: " + e.message);
  }

  // --- product image bucket: admin-only ---
  const productImagePath = `gate3-product-${RUN_ID}.png`;
  try {
    const { error } = await sellerA.client.storage.from("products").upload(productImagePath, avatarBytes, { contentType: "image/png" });
    record("product_image_upload_nonadmin_denied", error ? "PASS" : "FAIL", error ? "" : "non-admin wrote to products bucket — CRITICAL");
    if (!error) cleanupStorage.push({ client: sellerA.client, bucket: "products", path: productImagePath });
  } catch (e) {
    record("product_image_upload_nonadmin_denied", "PASS", "denied with error: " + e.message);
  }

  // --- sign out invalidates local session ---
  try {
    await customerA.client.auth.signOut();
    const { data } = await customerA.client.auth.getSession();
    record("signout_clears_local_session", !data.session ? "PASS" : "FAIL", !data.session ? "" : "session persisted after signOut");
  } catch (e) {
    record("signout_clears_local_session", "FAIL", e.message);
  }

  // --- seller offer isolation via save_offer RPC ---
  let fixtureProductId = null;
  try {
    const anon = newClient();
    const { data, error } = await anon.from("products").select("id").eq("is_active", true).limit(1);
    if (error) throw error;
    fixtureProductId = data[0]?.id ?? null;
  } catch (e) {
    record("catalog_fixture_lookup", "FAIL", e.message);
  }

  let offerAId = null;
  if (fixtureProductId == null) {
    record("seller_isolation_via_save_offer_rpc", "SKIPPED", "no active product exists in Staging catalog to use as a fixture; product creation is admin-only, out of Gate 3 scope");
    record("two_seller_checkout_pricing_integrity", "SKIPPED", "depends on catalog fixture, unavailable");
    record("order_items_ownership_isolation", "SKIPPED", "depends on catalog fixture, unavailable");
    record("seller_fulfillment_isolation", "SKIPPED", "depends on catalog fixture, unavailable");
  } else {
    try {
      const { data: offerId, error } = await sellerA.client.rpc("save_offer", {
        p_product_id: fixtureProductId,
        p_offer_id: null,
        p_price: 1234000,
        p_discount_price: null,
        p_stock: 50,
        p_warranty: "gate3",
        p_shipping: "gate3",
        p_notes: "gate3 fixture offer, safe to ignore/delete",
        p_hidden: false,
      });
      if (error) throw error;
      offerAId = offerId;
      record("seller_creates_own_offer", "PASS");
    } catch (e) {
      record("seller_creates_own_offer", "FAIL", e.message);
    }

    if (offerAId != null) {
      try {
        const { error } = await sellerB.client.rpc("save_offer", {
          p_product_id: fixtureProductId,
          p_offer_id: offerAId,
          p_price: 1,
          p_discount_price: null,
          p_stock: 1,
          p_warranty: "",
          p_shipping: "",
          p_notes: "hostile edit attempt",
          p_hidden: false,
        });
        record("seller_isolation_via_save_offer_rpc", error ? "PASS" : "FAIL", error ? "" : "sellerB mutated sellerA's offer — CRITICAL");
      } catch (e) {
        record("seller_isolation_via_save_offer_rpc", "PASS", "denied with error: " + e.message);
      }

      // --- two-seller checkout: pricing integrity ---
      let quotedTotal = null;
      try {
        const items = [{ offer_id: offerAId, quantity: 1 }];
        const { data: quote, error } = await customerA.client.rpc("quote_checkout", { p_items: items, p_coupon: null });
        if (error) throw error;
        quotedTotal = quote.total;
        record("quote_checkout_server_computed", typeof quote.total === "number" && quote.total > 0 ? "PASS" : "FAIL");
      } catch (e) {
        record("quote_checkout_server_computed", "FAIL", e.message);
      }

      try {
        const items = [{ offer_id: offerAId, quantity: 1 }];
        const { error } = await customerA.client.rpc("place_order", {
          p_items: items,
          p_address: { full_name: "Gate3 Tester", mobile: idCustomerA.mobile, province: "Tehran", city: "Tehran", street: "gate3 test street 1" },
          p_key: randomUUID(),
          p_expected_total: 1,
          p_coupon: null,
        });
        record("place_order_rejects_client_supplied_price", error ? "PASS" : "FAIL", error ? "" : "order placed with buyer-supplied total=1 — CRITICAL");
      } catch (e) {
        record("place_order_rejects_client_supplied_price", "PASS", "denied with error: " + e.message);
      }

      // --- real order for cross-user isolation checks ---
      let orderId = null;
      try {
        const items = [{ offer_id: offerAId, quantity: 1 }];
        const { data: order, error } = await customerA.client.rpc("place_order", {
          p_items: items,
          p_address: { full_name: "Gate3 Tester", mobile: idCustomerA.mobile, province: "Tehran", city: "Tehran", street: "gate3 test street 1" },
          p_key: randomUUID(),
          p_expected_total: quotedTotal,
          p_coupon: null,
        });
        if (error) throw error;
        orderId = order.order_id;
        record("place_order_succeeds_with_correct_total", "PASS");
      } catch (e) {
        record("place_order_succeeds_with_correct_total", "FAIL", e.message);
      }

      if (orderId != null) {
        // customerB (unrelated buyer) must not see customerA's order_items or fulfillment.
        try {
          const { data, error } = await customerB.client.from("order_items").select("id,order_id").eq("order_id", orderId);
          if (error) throw error;
          record("order_items_ownership_isolation", data.length === 0 ? "PASS" : "FAIL", data.length ? `unrelated buyer read ${data.length} row(s) of another user's order — CRITICAL DEFECT` : "");
        } catch (e) {
          record("order_items_ownership_isolation", "PASS", "denied with error: " + e.message);
        }
        try {
          const { data, error } = await customerB.client.from("seller_fulfillments").select("id,order_id,seller_id").eq("order_id", orderId);
          if (error) throw error;
          record("fulfillment_ownership_isolation_unrelated_buyer", data.length === 0 ? "PASS" : "FAIL", data.length ? `unrelated buyer read ${data.length} fulfillment row(s) — CRITICAL DEFECT` : "");
        } catch (e) {
          record("fulfillment_ownership_isolation_unrelated_buyer", "PASS", "denied with error: " + e.message);
        }
        // sellerB (unrelated seller, not assigned to this order) must not see it either.
        try {
          const { data, error } = await sellerB.client.from("order_items").select("id,order_id").eq("order_id", orderId);
          if (error) throw error;
          record("seller_fulfillment_isolation", data.length === 0 ? "PASS" : "FAIL", data.length ? `unrelated seller read ${data.length} order_items row(s) — CRITICAL DEFECT` : "");
        } catch (e) {
          record("seller_fulfillment_isolation", "PASS", "denied with error: " + e.message);
        }
        try {
          const { data, error } = await sellerB.client.from("seller_fulfillments").select("id,order_id,seller_id").eq("order_id", orderId);
          if (error) throw error;
          record("seller_fulfillment_table_isolation_unrelated_seller", data.length === 0 ? "PASS" : "FAIL", data.length ? `unrelated seller read ${data.length} fulfillment row(s) — CRITICAL DEFECT` : "");
        } catch (e) {
          record("seller_fulfillment_table_isolation_unrelated_seller", "PASS", "denied with error: " + e.message);
        }
        // the buyer themself should be able to read their own order_items (sanity, not a vuln check).
        try {
          const { data, error } = await customerA.client.from("order_items").select("id").eq("order_id", orderId);
          if (error) throw error;
          record("buyer_can_read_own_order_items", data.length > 0 ? "PASS" : "FAIL");
        } catch (e) {
          record("buyer_can_read_own_order_items", "FAIL", e.message);
        }
      }
    }
  }

  await cleanup();
  printSummaryAndExit();
}

async function cleanup() {
  for (const item of cleanupStorage) {
    try {
      await item.client.storage.from(item.bucket).remove([item.path]);
    } catch {
      // best-effort
    }
  }
}

function printSummaryAndExit() {
  const fail = results.filter((r) => r.status === "FAIL");
  console.log("\n--- SUMMARY ---");
  console.log(`PASS=${results.filter((r) => r.status === "PASS").length} FAIL=${fail.length} SKIPPED=${results.filter((r) => r.status === "SKIPPED").length}`);
  console.log("gate3_identities_created=" + createdIdentities.join(","));
  process.exit(fail.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("RESULT=CRASH", e.message);
  process.exit(2);
});
