import assert from "node:assert/strict";
import { load } from "./helpers/load-typescript.mjs";

const { resolveSellerBusinessIdentity, STORE_SELLER_FALLBACK_LABEL } = load("lib/seller-identity.ts");

let passed = 0;
const check = (cond, label) => { assert.ok(cond, label); passed++; };

// Core fallback rule: business name = shopName if set, else Account name, never blank.
const withShopName = resolveSellerBusinessIdentity({
  name: "علی رضایی",
  data: { seller: { shopName: "فروشگاه برق خودرو مهدی" } },
});
check(withShopName.businessName === "فروشگاه برق خودرو مهدی", "shopName used as business name when set");
check(withShopName.usedAccountNameFallback === false, "fallback flag false when shopName present");

const withoutShopName = resolveSellerBusinessIdentity({
  name: "علی رضایی",
  data: { seller: {} },
});
check(withoutShopName.businessName === "علی رضایی", "falls back to Account name when shopName absent");
check(withoutShopName.usedAccountNameFallback === true, "fallback flag true when shopName absent");

const whitespaceShopName = resolveSellerBusinessIdentity({
  name: "علی رضایی",
  data: { seller: { shopName: "   " } },
});
check(whitespaceShopName.businessName === "علی رضایی", "whitespace-only shopName treated as unset, falls back");
check(whitespaceShopName.usedAccountNameFallback === true, "whitespace-only shopName counts as fallback used");

// Never blank, even with no profile at all.
const nullProfile = resolveSellerBusinessIdentity(null);
check(nullProfile.businessName === "", "null profile resolves to empty string, not throwing");
check(typeof STORE_SELLER_FALLBACK_LABEL === "string" && STORE_SELLER_FALLBACK_LABEL.length > 0, "store fallback label is a non-empty string");

// Passthrough fields used by Store surfaces.
const full = resolveSellerBusinessIdentity({
  name: "علی رضایی",
  phone1: "09123456789",
  phone2: "09123456780",
  about: "توضیحات فروشگاه",
  social_links: { whatsapp: "09123456789" },
  data: {
    seller: {
      shopName: "فروشگاه الف",
      specialties: ["برقی", "بدنه"],
      saleType: "خرده‌فروشی",
      minOrder: 500000,
    },
  },
});
check(full.contactPhone1 === "09123456789", "contactPhone1 passed through");
check(full.contactPhone2 === "09123456780", "contactPhone2 passed through");
check(full.about === "توضیحات فروشگاه", "about passed through");
check(full.socialLinks?.whatsapp === "09123456789", "socialLinks passed through");
check(full.specialties.length === 2, "specialties passed through");
check(full.saleType === "خرده‌فروشی", "saleType passed through");
check(full.minOrder === 500000, "minOrder passed through");

// Missing nested fields degrade to safe defaults, not throwing.
const sparse = resolveSellerBusinessIdentity({ name: "علی رضایی" });
check(sparse.specialties.length === 0, "missing specialties defaults to empty array");
check(sparse.saleType === null, "missing saleType defaults to null");
check(sparse.contactPhone1 === null, "missing phone1 defaults to null");

console.log(`${passed} seller-identity assertions passed.`);
