"use client";

import { useEffect, useState } from "react";
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
  const { items, totalPrice, clearCart } = useCart();

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
    const userId = localStorage.getItem("userId");
    if (!userId) {
      router.push("/login");
      return;
    }

    if (items.length === 0) {
      router.push("/cart");
      return;
    }

    const loadProfile = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("name, mobile, address_data")
        .eq("id", userId)
        .single();

      if (data) {
        setFullName(data.name || "");
        setMobile(data.mobile || "");

        const savedAddress = data.address_data as AddressData | null;
        if (
          savedAddress &&
          savedAddress.province &&
          savedAddress.city &&
          savedAddress.street
        ) {
          setAddressData(savedAddress);
          setHasExistingAddress(true);
          setUseExistingAddress(true);
        }
      }
      setLoading(false);
    };
    loadProfile();
  }, [router, items.length]);

  // محاسبه مبلغ نهایی
  const couponDiscount = appliedCoupon?.discount_amount || 0;
  const finalPrice = Math.max(0, totalPrice + SHIPPING_COST - couponDiscount);

  // اعمال کد تخفیف
  const handleApplyCoupon = async () => {
    setCouponError("");
    setAppliedCoupon(null);

    const cleanCode = couponCode.trim().toUpperCase();
    if (!cleanCode) {
      setCouponError("کد تخفیف رو وارد کن");
      return;
    }

    setCouponLoading(true);

    const userId = localStorage.getItem("userId");
    if (!userId) {
      setCouponError("لطفاً وارد شوید");
      setCouponLoading(false);
      return;
    }

    // ۱. پیدا کردن کد
    const { data: coupon, error: couponQueryError } = await supabase
      .from("coupons")
      .select("*")
      .eq("code", cleanCode)
      .eq("is_active", true)
      .single();

    if (couponQueryError || !coupon) {
      setCouponError("کد تخفیف معتبر نیست یا غیرفعال شده");
      setCouponLoading(false);
      return;
    }

    // ۲. تاریخ انقضا
    if (coupon.valid_until && new Date(coupon.valid_until) < new Date()) {
      setCouponError("این کد تخفیف منقضی شده");
      setCouponLoading(false);
      return;
    }

    // ۳. تعداد استفاده کل
    if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
      setCouponError("ظرفیت استفاده از این کد پر شده");
      setCouponLoading(false);
      return;
    }

    // ۴. حداقل مبلغ
    if (coupon.min_order_amount > 0 && totalPrice < coupon.min_order_amount) {
      setCouponError(
        `حداقل مبلغ سفارش برای این کد ${coupon.min_order_amount.toLocaleString(
          "fa-IR"
        )} تومان است`
      );
      setCouponLoading(false);
      return;
    }

    // ۵. تعداد استفاده کاربر
    const { count: userUsageCount } = await supabase
      .from("coupon_usages")
      .select("id", { count: "exact", head: true })
      .eq("coupon_id", coupon.id)
      .eq("user_id", userId);

    if (
      coupon.max_uses_per_user &&
      (userUsageCount || 0) >= coupon.max_uses_per_user
    ) {
      setCouponError("شما قبلاً از این کد استفاده کرده‌اید");
      setCouponLoading(false);
      return;
    }

    // ۶. محاسبه تخفیف
    let discountAmount = 0;
    if (coupon.discount_type === "percent") {
      discountAmount = Math.floor((totalPrice * coupon.discount_value) / 100);
    } else {
      discountAmount = Math.min(coupon.discount_value, totalPrice);
    }

    setAppliedCoupon({
      id: coupon.id,
      code: coupon.code,
      discount_amount: discountAmount,
    });
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
      const userId = localStorage.getItem("userId");
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

      const { data: orderData, error: orderError } = await supabase
        .from("orders")
        .insert({
          user_id: userId,
          status: "pending",
          total_price: totalPrice,
          shipping_cost: SHIPPING_COST,
          discount: couponDiscount,
          final_price: finalPrice,
          coupon_id: appliedCoupon?.id || null,
          coupon_code: appliedCoupon?.code || null,
          coupon_discount: couponDiscount,
          shipping_address: shippingAddress,
          payment_method: "cash_on_delivery",
          payment_status: "pending",
        })
        .select("id")
        .single();

      if (orderError || !orderData) {
        setError(`خطا در ساخت سفارش: ${orderError?.message || "نامشخص"}`);
        setSaving(false);
        return;
      }

      const orderId = orderData.id;

      const orderItems = items.map((item) => ({
        order_id: orderId,
        product_id: item.product_id,
        product_name: item.name,
        product_price: item.price,
        quantity: item.quantity,
        seller_id: item.seller_id || null,
      }));

      const { error: itemsError } = await supabase
        .from("order_items")
        .insert(orderItems);

      if (itemsError) {
        setError(`خطا در ثبت آیتم‌ها: ${itemsError.message}`);
        setSaving(false);
        return;
      }

      // اگه کد تخفیف اعمال شده، ثبت کن
      if (appliedCoupon) {
        await supabase.from("coupon_usages").insert({
          coupon_id: appliedCoupon.id,
          user_id: userId,
          order_id: orderId,
        });

        // آپدیت used_count
        const { data: currentCoupon } = await supabase
          .from("coupons")
          .select("used_count")
          .eq("id", appliedCoupon.id)
          .single();

        if (currentCoupon) {
          await supabase
            .from("coupons")
            .update({ used_count: (currentCoupon.used_count || 0) + 1 })
            .eq("id", appliedCoupon.id);
        }
      }

      // ذخیره آدرس توی پروفایل
      await supabase
        .from("profiles")
        .update({ address_data: addressData })
        .eq("id", userId);

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
                    {items.map((item, idx) => (
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
                          {formatToman(item.price * item.quantity)}
                        </p>
                      </div>
                    ))}
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
                        {formatToman(totalPrice)} تومان
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
                    disabled={saving}
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