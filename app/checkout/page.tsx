"use client";
import { getCurrentUserId } from "@/lib/auth-client";
import { secureWrite } from "@/lib/secure-write";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { CartIcon } from "@/components/CartIcon";
import {
  AddressForm,
  AddressData,
  emptyAddress,
} from "@/components/AddressForm";
import { useCart } from "@/lib/cart-context";
import { supabase } from "@/lib/supabase";

const SHIPPING_COST = 50000;

type AppliedCoupon = {
  id: number;
  code: string;
  discount_amount: number;
};

export default function CheckoutPage() {
  const router = useRouter();
  const { items, totalPrice, clearCart, loaded } = useCart();
  const restored = useRef(false);
  const completedOrder = useRef(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  type QuoteItem = { offer_id: number; price: number; quantity: number };
  const [quoted, setQuoted] = useState<{key:string;data:{subtotal:number;shipping:number;discount:number;total:number;items:QuoteItem[]}} | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [addressData, setAddressData] = useState<AddressData>(emptyAddress);
  const [notes, setNotes] = useState("");
  const [useExistingAddress, setUseExistingAddress] = useState(false);
  const [hasExistingAddress, setHasExistingAddress] = useState(false);

  // کد تخفیف
  const [couponCode, setCouponCode] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);

  useEffect(() => {
    if (!loaded || completedOrder.current) return;
    let active = true;
    const load = async () => {
      const userId = await getCurrentUserId();
      if (!userId) { router.replace("/login"); return; }
      if (!items.length) { router.replace("/cart"); return; }
      // A previous response may have been lost after the transaction committed.
      if (!restored.current) {
        restored.current = true;
        try {
          const storageKey = "mycar-checkout-attempt-" + userId;
          const pending = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
          if (pending?.key) {
            const { data: completed } = await supabase.from("orders").select("id").eq("user_id",userId).eq("checkout_key",pending.key).maybeSingle();
            if (completed && active) {
              completedOrder.current = true;
              sessionStorage.removeItem(storageKey);
              try {
                const submittedItems = JSON.parse(pending.payload).items;
                const currentItems = items.map(i => ({offer_id:i.offer_id,quantity:i.quantity})).sort((a,b)=>a.offer_id-b.offer_id);
                if (JSON.stringify(submittedItems) === JSON.stringify(currentItems)) clearCart();
              } catch { /* Do not clear a cart if its submitted snapshot cannot be verified. */ }
              router.replace("/orders/" + completed.id);
              return;
            }
          }
        } catch { /* Recovery is optional; submitting still uses the idempotency key. */ }
      }
      const { data } = await supabase.from("profiles").select("name,mobile,address_data").eq("id",userId).single();
      if (!active) return;
      if (data) { setFullName(data.name ?? ""); setMobile(data.mobile ?? "");
        if (data.address_data?.street) { setAddressData(data.address_data); setHasExistingAddress(true); setUseExistingAddress(true); }
      }
      setLoading(false);
    };
    void load(); return () => { active = false; };
  }, [loaded, router, items.length]);

  const itemPayload = JSON.stringify(items.map(i => ({ offer_id:i.offer_id,quantity:i.quantity })).sort((a,b)=>a.offer_id-b.offer_id));
  const quoteKey = itemPayload + ":" + (appliedCoupon?.code ?? "");
  const quote = quoted?.key === quoteKey ? quoted.data : null;
  useEffect(() => {
    if (!loaded || !items.length) return;
    let active = true;
    void secureWrite("quote", {items:JSON.parse(itemPayload),coupon:appliedCoupon?.code??null}).then(result => {
      if (!active) return;
      if (result.error) setError(result.error.message);
      else { setQuoted({key:quoteKey,data:result.data}); setError(""); }
    });
    return () => { active = false; };
  }, [loaded, itemPayload, appliedCoupon?.code, items.length, quoteKey]);

  // محاسبه مبلغ نهایی
  const couponDiscount = quote?.discount ?? 0;
  const finalPrice = quote?.total ?? 0;

  // اعمال کد تخفیف
  const handleApplyCoupon = async () => {
    setCouponLoading(true); setCouponError("");
    const code=couponCode.trim().toUpperCase();
    if (!code) { setCouponError("کد تخفیف را وارد کنید"); setCouponLoading(false); return; }
    const result=await secureWrite("quote",{items:JSON.parse(itemPayload),coupon:code});
    if(result.error) setCouponError(result.error.message);
    else { setAppliedCoupon({id:0,code,discount_amount:result.data.discount}); setQuoted({key:quoteKey,data:result.data}); }
    setCouponLoading(false);
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponCode("");
    setCouponError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (fullName.trim().length < 3) {
      setError("نام و نام خانوادگی رو کامل وارد کن");
      return;
    }
    if (!/^09\d{9}$/.test(mobile)) {
      setError("شماره موبایل درست نیست");
      return;
    }
    if (!addressData.province) {
      setError("استان رو انتخاب کن");
      return;
    }
    if (!addressData.city) {
      setError("شهر رو انتخاب کن");
      return;
    }
    if (addressData.street.trim().length < 3) {
      setError("خیابان اصلی رو وارد کن");
      return;
    }

    setSaving(true);

    try {
      const userId = await getCurrentUserId();
      if (!userId) {
        setError("لطفاً وارد شوید");
        setSaving(false);
        return;
      }

      const shippingAddress = {
        full_name: fullName.trim(),
        mobile,
        province: addressData.province,
        city: addressData.city,
        region: addressData.region,
        street: addressData.street,
        alley: addressData.alley,
        postal_code: addressData.postal_code,
        lat: addressData.lat,
        lng: addressData.lng,
        notes: notes.trim() || null,
      };

      if (!quote) { setError("ابتدا منتظر بررسی قیمت و موجودی بمانید"); setSaving(false); return; }
      const payload = { items:JSON.parse(itemPayload),address:shippingAddress,coupon:appliedCoupon?.code??null,expected_total:quote.total };
      const fingerprint = JSON.stringify(payload);
      const storageKey = "mycar-checkout-attempt-" + userId;
      if (!attempt.current) {
        try { attempt.current = JSON.parse(sessionStorage.getItem(storageKey) ?? "null"); } catch { /* Ignore corrupt draft. */ }
      }
      if (!attempt.current || attempt.current.payload !== fingerprint) attempt.current = {payload:fingerprint,key:crypto.randomUUID()};
      try { sessionStorage.setItem(storageKey,JSON.stringify(attempt.current)); } catch { /* Ref preserves retries within this page. */ }
      const result = await secureWrite("checkout",{...payload,key:attempt.current.key});
      if (result.error) {
        setError(result.error.message);
        if (result.error.code === "price_changed") {
          const fresh = await secureWrite("quote", {items:JSON.parse(itemPayload),coupon:appliedCoupon?.code??null});
          setQuoted(fresh.error ? null : {key:quoteKey,data:fresh.data});
          setError("قیمت تغییر کرده است؛ مبلغ جدید را بررسی و دوباره تأیید کنید");
        }
        setSaving(false); return;
      }
      const orderId=result.data.order_id;
      try { sessionStorage.removeItem(storageKey); } catch { /* No persistence available. */ }
      completedOrder.current = true;
      clearCart();
      router.push(`/orders/${orderId}`);
    } catch (err) {
      setError(
        `خطای غیرمنتظره: ${err instanceof Error ? err.message : "نامشخص"}`
      );
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">
        <div className="text-gray-400">در حال بارگذاری...</div>
      </main>
    );
  }

  const formatToman = (n: number) => n.toLocaleString("fa-IR");

  return (
    <main className="min-h-screen bg-neutral-950 text-white" dir="rtl">
      <header className="border-b border-[#39FF14]/20 bg-neutral-950/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <Logo size={36} />
            <h1 className="text-xl font-bold text-[#39FF14]">ماشین من</h1>
          </Link>
          <div className="flex items-center gap-3">
            <CartIcon />
            <Link
              href="/cart"
              className="rounded-full border border-[#39FF14]/30 px-4 py-2 text-sm text-[#39FF14] transition hover:bg-[#39FF14]/10"
            >
              بازگشت به سبد
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-12">
        <h2 className="mb-8 text-3xl font-bold">
          ثبت <span className="text-[#39FF14]">سفارش</span>
        </h2>

        {error && (
          <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            ❌ {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              {/* اطلاعات تماس */}
              <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6">
                <h3 className="mb-5 text-lg font-bold text-[#39FF14]">
                  👤 اطلاعات تماس
                </h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-bold text-gray-300">
                      نام و نام خانوادگی *
                    </label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="مثلاً مهدی محمودی"
                      className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-bold text-gray-300">
                      شماره موبایل *
                    </label>
                    <input
                      type="tel"
                      value={mobile}
                      onChange={(e) =>
                        setMobile(
                          e.target.value.replace(/\D/g, "").slice(0, 11)
                        )
                      }
                      placeholder="09xxxxxxxxx"
                      dir="ltr"
                      className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-left text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* آدرس */}
              <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6">
                <div className="mb-5 flex items-center justify-between">
                  <h3 className="text-lg font-bold text-[#39FF14]">
                    📍 آدرس ارسال
                  </h3>
                  {hasExistingAddress && (
                    <button
                      type="button"
                      onClick={() => setUseExistingAddress(!useExistingAddress)}
                      className="text-xs text-gray-400 transition hover:text-[#39FF14]"
                    >
                      {useExistingAddress ? "✏️ ویرایش آدرس" : "↩️ آدرس پیش‌فرض"}
                    </button>
                  )}
                </div>

                {hasExistingAddress && useExistingAddress ? (
                  <div className="rounded-lg border border-[#39FF14]/40 bg-[#39FF14]/5 p-4">
                    <p className="mb-2 text-xs font-bold text-[#39FF14]">
                      ✅ آدرس پیش‌فرض شما
                    </p>
                    <p className="text-sm text-gray-200">
                      {addressData.province}، {addressData.city}
                      {addressData.region && `، ${addressData.region}`}
                    </p>
                    <p className="mt-1 text-sm text-gray-300">
                      {addressData.street}
                      {addressData.alley && `، ${addressData.alley}`}
                    </p>
                  </div>
                ) : (
                  <AddressForm
                    value={addressData}
                    onChange={setAddressData}
                    showMap={true}
                  />
                )}
              </div>

              {/* توضیحات */}
              <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6">
                <label className="mb-2 block text-sm font-bold text-gray-300">
                  توضیحات سفارش{" "}
                  <span className="text-xs font-normal text-gray-500">
                    (اختیاری)
                  </span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="مثلاً: قبل از ارسال تماس بگیرید"
                  className="w-full resize-none rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
                />
              </div>

              {/* پرداخت */}
              <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6">
                <h3 className="mb-5 text-lg font-bold text-[#39FF14]">
                  💳 روش پرداخت
                </h3>
                <div className="rounded-lg border border-[#39FF14]/40 bg-[#39FF14]/5 p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">💵</span>
                    <div>
                      <p className="font-bold text-[#39FF14]">
                        پرداخت در محل (نقدی)
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        مبلغ سفارش رو هنگام تحویل به پیک پرداخت می‌کنی
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* خلاصه */}
            <div className="lg:col-span-1">
              <div className="sticky top-6 space-y-4">
                <div className="rounded-2xl border border-[#39FF14]/30 bg-neutral-900/60 p-6">
                  <h3 className="mb-5 text-lg font-bold text-[#39FF14]">
                    خلاصه سفارش
                  </h3>

                  <div className="mb-4 max-h-[250px] space-y-3 overflow-y-auto border-b border-[#39FF14]/10 pb-4">
                    {items.map((item, idx) => {
                      // Once the authoritative quote has resolved, show its
                      // per-offer price instead of the cart's add-time
                      // snapshot, so displayed lines can never disagree with
                      // the server-quoted total below. Before that, the
                      // snapshot is the only price available yet.
                      const quotedPrice = quote?.items?.find(qi => qi.offer_id === item.offer_id)?.price;
                      const unitPrice = quotedPrice ?? item.price;
                      return (
                      <div
                        key={`${item.product_id}-${item.seller_name}-${idx}`}
                        className="flex gap-3"
                      >
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#39FF14]/20 bg-neutral-950 text-lg">
                          {item.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.image}
                              alt={item.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span>🛒</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-1 text-xs font-bold text-white">
                            {item.name}
                          </p>
                          <p className="mt-0.5 text-[10px] text-gray-400">
                            {item.quantity.toLocaleString("fa-IR")} عدد
                          </p>
                        </div>
                        <p className="shrink-0 text-xs font-bold text-[#39FF14]">
                          {formatToman(unitPrice * item.quantity)}
                        </p>
                      </div>
                      );
                    })}
                  </div>

                  {/* کد تخفیف */}
                  <div className="mb-4 border-b border-[#39FF14]/10 pb-4">
                    <label className="mb-2 block text-xs font-bold text-gray-300">
                      🎫 کد تخفیف
                    </label>
                    {appliedCoupon ? (
                      <div className="flex items-center justify-between rounded-lg border border-[#39FF14]/40 bg-[#39FF14]/5 p-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-sm font-bold text-[#39FF14]" dir="ltr">
                            {appliedCoupon.code}
                          </p>
                          <p className="mt-1 text-[10px] text-gray-400">
                            {formatToman(appliedCoupon.discount_amount)} تومان تخفیف
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleRemoveCoupon}
                          className="text-xs text-red-400 transition hover:text-red-300"
                        >
                          حذف
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={couponCode}
                            onChange={(e) =>
                              setCouponCode(e.target.value.toUpperCase())
                            }
                            placeholder="کد تخفیف"
                            dir="ltr"
                            className="flex-1 rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-3 py-2 text-left text-sm text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
                          />
                          <button
                            type="button"
                            onClick={handleApplyCoupon}
                            disabled={couponLoading}
                            className="rounded-lg border border-[#39FF14]/40 px-4 py-2 text-xs font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10 disabled:opacity-50"
                          >
                            {couponLoading ? "..." : "اعمال"}
                          </button>
                        </div>
                        {couponError && (
                          <p className="mt-2 text-[10px] text-red-400">
                            ❌ {couponError}
                          </p>
                        )}
                      </>
                    )}
                  </div>

                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">جمع کالاها</span>
                      <span className="font-bold text-white">
                        {formatToman(quote?.subtotal ?? totalPrice)} تومان
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">هزینه ارسال</span>
                      <span className="font-bold text-white">
                        {formatToman(SHIPPING_COST)} تومان
                      </span>
                    </div>
                    {couponDiscount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">تخفیف</span>
                        <span className="font-bold text-red-400">
                          - {formatToman(couponDiscount)} تومان
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-[#39FF14]/20 pt-3">
                      <span className="font-bold text-gray-300">
                        مبلغ نهایی
                      </span>
                      <span className="text-lg font-bold text-[#39FF14]">
                        {formatToman(finalPrice)} تومان
                      </span>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={saving || !quote}
                    className="mt-6 w-full rounded-lg bg-[#39FF14] px-6 py-3 font-bold text-black shadow-[0_0_20px_rgba(57,255,20,0.5)] transition hover:bg-[#39FF14]/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? "در حال ثبت..." : "✅ ثبت سفارش"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </form>
      </section>
    </main>
  );
}
