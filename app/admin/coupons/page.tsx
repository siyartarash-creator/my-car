"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Coupon = {
  id: number;
  code: string;
  discount_type: "percent" | "fixed";
  discount_value: number;
  min_order_amount: number;
  max_uses: number | null;
  used_count: number;
  max_uses_per_user: number;
  valid_from: string;
  valid_until: string | null;
  is_active: boolean;
  description: string | null;
  created_at: string;
};

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  // فرم
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "fixed">("percent");
  const [discountValue, setDiscountValue] = useState("");
  const [minOrder, setMinOrder] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [maxUsesPerUser, setMaxUsesPerUser] = useState("1");
  const [validUntil, setValidUntil] = useState("");
  const [description, setDescription] = useState("");

  const load = async () => {
    const { data, error: queryError } = await supabase
      .from("coupons")
      .select("*")
      .order("created_at", { ascending: false });

    if (queryError) {
      setError(queryError.message);
    } else {
      setCoupons((data ?? []) as Coupon[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setCode("");
    setDiscountType("percent");
    setDiscountValue("");
    setMinOrder("");
    setMaxUses("");
    setMaxUsesPerUser("1");
    setValidUntil("");
    setDescription("");
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const cleanCode = code.trim().toUpperCase().replace(/\s/g, "");

    if (cleanCode.length < 3) {
      setError("کد تخفیف باید حداقل ۳ کاراکتر باشه");
      return;
    }
    if (!/^[A-Z0-9_-]+$/.test(cleanCode)) {
      setError("کد تخفیف فقط شامل حروف انگلیسی، عدد، _ و - باشه");
      return;
    }
    if (!discountValue || Number(discountValue) <= 0) {
      setError("مقدار تخفیف باید بزرگ‌تر از صفر باشه");
      return;
    }
    if (discountType === "percent" && Number(discountValue) > 100) {
      setError("درصد تخفیف نمی‌تونه بیشتر از ۱۰۰ باشه");
      return;
    }

    setSaving(true);

    const { error: insertError } = await supabase.from("coupons").insert({
      code: cleanCode,
      discount_type: discountType,
      discount_value: Number(discountValue),
      min_order_amount: minOrder ? Number(minOrder) : 0,
      max_uses: maxUses ? Number(maxUses) : null,
      max_uses_per_user: maxUsesPerUser ? Number(maxUsesPerUser) : 1,
      valid_until: validUntil ? new Date(validUntil).toISOString() : null,
      description: description.trim() || null,
      is_active: true,
    });

    if (insertError) {
      if (insertError.message.includes("duplicate")) {
        setError("این کد تخفیف قبلاً ساخته شده");
      } else {
        setError(`خطا: ${insertError.message}`);
      }
      setSaving(false);
      return;
    }

    setSaving(false);
    resetForm();
    setShowForm(false);
    await load();
  };

  const handleToggleActive = async (id: number, current: boolean) => {
    const { error: updateError } = await supabase
      .from("coupons")
      .update({ is_active: !current })
      .eq("id", id);

    if (updateError) {
      alert(`خطا: ${updateError.message}`);
      return;
    }

    setCoupons((prev) =>
      prev.map((c) => (c.id === id ? { ...c, is_active: !current } : c))
    );
  };

  const handleDelete = async (id: number) => {
    if (!confirm("مطمئنی می‌خوای این کد تخفیف رو حذف کنی؟")) return;

    const { error: deleteError } = await supabase
      .from("coupons")
      .delete()
      .eq("id", id);

    if (deleteError) {
      alert(`خطا: ${deleteError.message}`);
      return;
    }

    setCoupons((prev) => prev.filter((c) => c.id !== id));
  };

  const formatToman = (n: number) => n.toLocaleString("fa-IR");

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString("fa-IR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return iso;
    }
  };

  const isExpired = (iso: string | null) => {
    if (!iso) return false;
    return new Date(iso) < new Date();
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-gray-400">
        در حال بارگذاری...
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold md:text-3xl">
            کدهای <span className="text-[#39FF14]">تخفیف</span>
          </h2>
          <p className="mt-2 text-sm text-gray-400">
            {coupons.length.toLocaleString("fa-IR")} کد تخفیف
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowForm(!showForm);
            resetForm();
          }}
          className="rounded-lg bg-[#39FF14] px-5 py-2.5 text-sm font-bold text-black transition hover:bg-[#39FF14]/90"
        >
          {showForm ? "بستن فرم" : "➕ کد تخفیف جدید"}
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          ❌ {error}
        </div>
      )}

      {/* فرم ساخت */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 space-y-4 rounded-2xl border border-[#39FF14]/40 bg-neutral-900/60 p-6"
        >
          <h3 className="text-lg font-bold text-[#39FF14]">
            ساخت کد تخفیف جدید
          </h3>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-bold text-gray-300">
                کد تخفیف *
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="مثلاً WELCOME10"
                dir="ltr"
                className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-left text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
                required
              />
              <p className="mt-1 text-xs text-gray-500">
                حروف انگلیسی بزرگ، عدد، _ و -
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold text-gray-300">
                نوع تخفیف *
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDiscountType("percent")}
                  className={`flex-1 rounded-lg border px-4 py-3 text-sm font-bold transition ${
                    discountType === "percent"
                      ? "border-[#39FF14] bg-[#39FF14] text-black"
                      : "border-[#39FF14]/20 text-gray-300"
                  }`}
                >
                  درصدی %
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountType("fixed")}
                  className={`flex-1 rounded-lg border px-4 py-3 text-sm font-bold transition ${
                    discountType === "fixed"
                      ? "border-[#39FF14] bg-[#39FF14] text-black"
                      : "border-[#39FF14]/20 text-gray-300"
                  }`}
                >
                  مبلغ ثابت (تومان)
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-bold text-gray-300">
                مقدار تخفیف *{" "}
                {discountType === "percent" && (
                  <span className="text-xs text-gray-500">(۱ تا ۱۰۰)</span>
                )}
              </label>
              <input
                type="text"
                value={discountValue}
                onChange={(e) =>
                  setDiscountValue(e.target.value.replace(/\D/g, ""))
                }
                placeholder={discountType === "percent" ? "10" : "50000"}
                dir="ltr"
                className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-left text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold text-gray-300">
                حداقل مبلغ سفارش (تومان)
              </label>
              <input
                type="text"
                value={minOrder}
                onChange={(e) =>
                  setMinOrder(e.target.value.replace(/\D/g, ""))
                }
                placeholder="۰ = بدون محدودیت"
                dir="ltr"
                className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-left text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm font-bold text-gray-300">
                تعداد استفاده کل
              </label>
              <input
                type="text"
                value={maxUses}
                onChange={(e) =>
                  setMaxUses(e.target.value.replace(/\D/g, ""))
                }
                placeholder="خالی = نامحدود"
                dir="ltr"
                className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-left text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold text-gray-300">
                تعداد استفاده هر کاربر
              </label>
              <input
                type="text"
                value={maxUsesPerUser}
                onChange={(e) =>
                  setMaxUsesPerUser(e.target.value.replace(/\D/g, ""))
                }
                placeholder="1"
                dir="ltr"
                className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-left text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold text-gray-300">
                تاریخ انقضا
              </label>
              <input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition focus:border-[#39FF14]"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-bold text-gray-300">
              توضیحات (اختیاری)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="مثلاً: تخفیف اولین خرید"
              className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
            />
          </div>

          <div className="flex gap-3 border-t border-[#39FF14]/10 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[#39FF14] px-6 py-3 font-bold text-black transition hover:bg-[#39FF14]/90 disabled:opacity-50"
            >
              {saving ? "در حال ذخیره..." : "✅ ساخت کد تخفیف"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="rounded-lg border border-gray-500/40 px-6 py-3 text-sm font-bold text-gray-400 transition hover:bg-gray-500/10"
            >
              انصراف
            </button>
          </div>
        </form>
      )}

      {/* لیست کدها */}
      {coupons.length === 0 ? (
        <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-12 text-center">
          <div className="mb-4 text-6xl">🎫</div>
          <p className="mb-2 text-lg font-bold text-white">
            هنوز کد تخفیفی نساختی
          </p>
          <p className="text-sm text-gray-400">
            برای جذب مشتری، یه کد تخفیف خوش‌آمدگویی بساز
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {coupons.map((c) => {
            const expired = isExpired(c.valid_until);
            const reachedMax = c.max_uses !== null && c.used_count >= c.max_uses;
            const unavailable = expired || reachedMax || !c.is_active;

            return (
              <div
                key={c.id}
                className={`rounded-2xl border p-5 transition ${
                  unavailable
                    ? "border-red-500/30 bg-red-500/5"
                    : "border-[#39FF14]/20 bg-neutral-900/60 hover:border-[#39FF14]/50"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-lg border-2 border-dashed px-3 py-1 font-mono text-lg font-bold tracking-wider ${
                          unavailable
                            ? "border-red-500/40 text-red-400 line-through"
                            : "border-[#39FF14]/60 text-[#39FF14]"
                        }`}
                        dir="ltr"
                      >
                        {c.code}
                      </span>

                      {!c.is_active && (
                        <span className="rounded-full border border-gray-500/40 bg-gray-500/10 px-2 py-0.5 text-[10px] text-gray-400">
                          غیرفعال
                        </span>
                      )}
                      {expired && (
                        <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-400">
                          منقضی شده
                        </span>
                      )}
                      {reachedMax && (
                        <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-400">
                          تعداد پر شده
                        </span>
                      )}
                    </div>

                    {c.description && (
                      <p className="mt-2 text-sm text-gray-400">
                        {c.description}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-400">
                      <span className="rounded-full border border-[#39FF14]/30 bg-[#39FF14]/5 px-2.5 py-1 text-[#39FF14]">
                        {c.discount_type === "percent"
                          ? `${formatToman(c.discount_value)}٪ تخفیف`
                          : `${formatToman(c.discount_value)} تومان تخفیف`}
                      </span>

                      {c.min_order_amount > 0 && (
                        <span className="rounded-full border border-yellow-500/30 bg-yellow-500/5 px-2.5 py-1 text-yellow-400">
                          حداقل سفارش: {formatToman(c.min_order_amount)} تومان
                        </span>
                      )}

                      <span className="rounded-full border border-blue-500/30 bg-blue-500/5 px-2.5 py-1 text-blue-400">
                        استفاده: {c.used_count.toLocaleString("fa-IR")}
                        {c.max_uses ? ` از ${c.max_uses.toLocaleString("fa-IR")}` : ""}
                      </span>

                      {c.valid_until && (
                        <span className="rounded-full border border-gray-500/30 bg-gray-500/5 px-2.5 py-1 text-gray-400">
                          تا {formatDate(c.valid_until)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(c.id, c.is_active)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                        c.is_active
                          ? "border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10"
                          : "border-[#39FF14]/40 text-[#39FF14] hover:bg-[#39FF14]/10"
                      }`}
                    >
                      {c.is_active ? "⏸️ غیرفعال" : "▶️ فعال"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id)}
                      className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-bold text-red-400 transition hover:bg-red-500/10"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}