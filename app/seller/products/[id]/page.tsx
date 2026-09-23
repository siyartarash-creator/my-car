"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Product = {
  id: number;
  name: string;
  slug: string;
  brand: string | null;
  description: string | null;
  part_number: string | null;
  reference_price: number | null;
  category_id: number | null;
  images: string[] | null;
};

type ExistingPrice = {
  id: number;
  price: number;
  discount_price: number | null;
  stock: number;
  warranty: string | null;
  shipping: string | null;
  notes: string | null;
  is_active: boolean;
  is_hidden_by_seller: boolean;
};

export default function SellerProductPricePage() {
  const router = useRouter();
  const params = useParams();
  const productId = params.id as string;

  const [product, setProduct] = useState<Product | null>(null);
  const [existing, setExisting] = useState<ExistingPrice | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // فیلدها
  const [price, setPrice] = useState("");
  const [discountPrice, setDiscountPrice] = useState("");
  const [stock, setStock] = useState("");
  const [warranty, setWarranty] = useState("");
  const [shipping, setShipping] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isHidden, setIsHidden] = useState(false);

  useEffect(() => {
    const load = async () => {
      const userId = localStorage.getItem("userId");
      if (!userId) {
        router.push("/login");
        return;
      }

      const [prodRes, priceRes] = await Promise.all([
        supabase.from("products").select("*").eq("id", productId).single(),
        supabase
          .from("product_sellers")
          .select("*")
          .eq("product_id", productId)
          .eq("seller_id", userId)
          .maybeSingle(),
      ]);

      if (prodRes.error || !prodRes.data) {
        setError("محصول پیدا نشد");
        setLoading(false);
        return;
      }

      setProduct(prodRes.data as Product);

      if (priceRes.data) {
        const p = priceRes.data as ExistingPrice;
        setExisting(p);
        setPrice(String(p.price || ""));
        setDiscountPrice(p.discount_price ? String(p.discount_price) : "");
        setStock(String(p.stock || ""));
        setWarranty(p.warranty || "");
        setShipping(p.shipping || "");
        setNotes(p.notes || "");
        setIsActive(p.is_active ?? true);
        setIsHidden(p.is_hidden_by_seller ?? false);
      }

      setLoading(false);
    };
    load();
  }, [productId, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const userId = localStorage.getItem("userId");
    if (!userId) {
      setError("لطفاً وارد شوید");
      return;
    }

    // اعتبارسنجی قیمت
    if (!price || Number(price) <= 0) {
      setError("قیمت باید بزرگ‌تر از صفر باشه");
      return;
    }

    if (discountPrice && Number(discountPrice) >= Number(price)) {
      setError("قیمت با تخفیف باید کمتر از قیمت اصلی باشه");
      return;
    }

    // هشدار قیمت مرجع
    if (product?.reference_price) {
      const ref = product.reference_price;
      const p = Number(price);

      if (p < ref * 0.3 || p > ref * 3) {
        const confirmMsg = `⚠️ هشدار: قیمت شما (${p.toLocaleString("fa-IR")} تومان) با قیمت مرجع بازار (${ref.toLocaleString("fa-IR")} تومان) اختلاف زیادی داره.\n\nآیا مطمئنی می‌خوای این قیمت رو ثبت کنی؟`;
        if (!confirm(confirmMsg)) {
          return;
        }
      }
    }

    setSaving(true);

    const priceData = {
      product_id: Number(productId),
      seller_id: userId,
      seller_name: localStorage.getItem("userName") || "فروشنده",
      price: Number(price),
      discount_price: discountPrice ? Number(discountPrice) : null,
      stock: stock ? Number(stock) : 0,
      warranty: warranty.trim() || null,
      shipping: shipping.trim() || null,
      notes: notes.trim() || null,
      is_active: isActive,
      is_hidden_by_seller: isHidden,
    };

    let result;
    if (existing) {
      // آپدیت
      result = await supabase
        .from("product_sellers")
        .update(priceData)
        .eq("id", existing.id);
    } else {
      // درج جدید
      result = await supabase.from("product_sellers").insert(priceData);
    }

    if (result.error) {
      setError(`خطا در ذخیره: ${result.error.message}`);
      setSaving(false);
      return;
    }

    setSaving(false);
    setSuccess("✅ اطلاعات با موفقیت ذخیره شد");
    setTimeout(() => {
      router.push("/seller/products");
    }, 1000);
  };

  const handleDelete = async () => {
    if (!existing) return;
    if (!confirm("مطمئنی می‌خوای قیمت این محصول رو حذف کنی؟ بعد از حذف، محصول از سبد فروشنده حذف می‌شه.")) return;

    setDeleting(true);
    const { error: deleteError } = await supabase
      .from("product_sellers")
      .delete()
      .eq("id", existing.id);

    if (deleteError) {
      setError(`خطا در حذف: ${deleteError.message}`);
      setDeleting(false);
      return;
    }

    router.push("/seller/products");
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-gray-400">
        در حال بارگذاری...
      </div>
    );
  }

  if (!product) {
    return (
      <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-8 text-center">
        <p className="mb-4 text-lg font-bold text-red-400">محصول پیدا نشد</p>
        <Link
          href="/seller/products"
          className="inline-block rounded-lg border border-[#39FF14]/40 px-5 py-2 text-sm font-bold text-[#39FF14]"
        >
          ← بازگشت به لیست
        </Link>
      </div>
    );
  }

  const imageSrc = (product.images ?? []).find((s) => s && s.trim().length > 0);

  return (
    <div>
      {/* مسیر بازگشت */}
      <div className="mb-6">
        <Link
          href="/seller/products"
          className="text-sm text-gray-400 transition hover:text-[#39FF14]"
        >
          ← بازگشت به لیست قطعات
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ستون چپ: اطلاعات محصول */}
        <div className="lg:col-span-1">
          <div className="sticky top-6 space-y-4">
            <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-5">
              <div className="mb-4 flex items-center justify-center overflow-hidden rounded-xl border border-[#39FF14]/20 bg-neutral-950 text-6xl" style={{ height: "200px" }}>
                {imageSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageSrc} alt={product.name} className="h-full w-full object-cover" />
                ) : (
                  <span>🛒</span>
                )}
              </div>
              <h2 className="mb-2 text-lg font-bold text-white">{product.name}</h2>
              <p className="text-xs text-gray-400">برند: {product.brand || "—"}</p>
              {product.part_number && (
                <p className="text-xs text-gray-400">کد فنی: {product.part_number}</p>
              )}
              {product.reference_price && (
                <div className="mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
                  <p className="text-xs text-yellow-400">💰 قیمت مرجع بازار</p>
                  <p className="mt-1 text-lg font-bold text-yellow-400">
                    {product.reference_price.toLocaleString("fa-IR")} تومان
                  </p>
                  <p className="mt-1 text-[10px] text-gray-400">
                    این عدد فقط برای راهنمایی شماست
                  </p>
                </div>
              )}
              {product.description && (
                <div className="mt-4 border-t border-[#39FF14]/10 pt-4">
                  <p className="mb-2 text-xs font-bold text-[#39FF14]">توضیحات محصول</p>
                  <p className="text-xs leading-relaxed text-gray-400">
                    {product.description}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ستون راست: فرم قیمت‌گذاری */}
        <div className="lg:col-span-2">
          <div className="mb-6">
            <h2 className="text-2xl font-bold md:text-3xl">
              <span className="text-[#39FF14]">قیمت‌گذاری</span> محصول
            </h2>
            <p className="mt-2 text-sm text-gray-400">
              {existing
                ? "قیمت و موجودی خود را برای این محصول ویرایش کن"
                : "قیمت و موجودی خود را برای این محصول تنظیم کن"}
            </p>
          </div>

          {error && (
            <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              ❌ {error}
            </div>
          )}

          {success && (
            <div className="mb-6 rounded-lg border border-[#39FF14]/40 bg-[#39FF14]/10 px-4 py-3 text-sm text-[#39FF14]">
              {success}
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className="space-y-5 rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6"
          >
            {/* قیمت */}
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-bold text-gray-300">
                  قیمت فروش شما (تومان) *
                </label>
                <input
                  type="text"
                  value={price}
                  onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
                  placeholder="مثلاً 4200000"
                  dir="ltr"
                  className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-left text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-bold text-gray-300">
                  قیمت با تخفیف{" "}
                  <span className="text-xs font-normal text-gray-500">(اختیاری)</span>
                </label>
                <input
                  type="text"
                  value={discountPrice}
                  onChange={(e) => setDiscountPrice(e.target.value.replace(/\D/g, ""))}
                  placeholder="مثلاً 3900000"
                  dir="ltr"
                  className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-left text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
                />
              </div>
            </div>

            {/* موجودی */}
            <div>
              <label className="mb-2 block text-sm font-bold text-gray-300">
                موجودی شما (تعداد) *
              </label>
              <input
                type="text"
                value={stock}
                onChange={(e) => setStock(e.target.value.replace(/\D/g, ""))}
                placeholder="مثلاً 10"
                dir="ltr"
                className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-left text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
              />
              <p className="mt-1 text-xs text-gray-500">
                💡 اگه تعداد به صفر برسه، قیمت شما خودکار از فروشگاه حذف می‌شه
              </p>
            </div>

            {/* گارانتی */}
            <div>
              <label className="mb-2 block text-sm font-bold text-gray-300">
                گارانتی / ضمانت{" "}
                <span className="text-xs font-normal text-gray-500">(اختیاری)</span>
              </label>
              <input
                type="text"
                value={warranty}
                onChange={(e) => setWarranty(e.target.value)}
                placeholder="مثلاً ۱۸ ماه گارانتی شرکتی"
                className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
              />
            </div>

            {/* روش ارسال */}
            <div>
              <label className="mb-2 block text-sm font-bold text-gray-300">
                روش ارسال{" "}
                <span className="text-xs font-normal text-gray-500">(اختیاری)</span>
              </label>
              <input
                type="text"
                value={shipping}
                onChange={(e) => setShipping(e.target.value)}
                placeholder="مثلاً ارسال رایگان تهران، تیپاکس به شهرستان"
                className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
              />
            </div>

            {/* توضیحات اضافه */}
            <div>
              <label className="mb-2 block text-sm font-bold text-gray-300">
                توضیحات اضافه فروشنده{" "}
                <span className="text-xs font-normal text-gray-500">(اختیاری)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="مثلاً: این محصول اورجینال هست، امکان بازگشت تا ۷ روز"
                className="w-full resize-none rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
              />
            </div>

            {/* چک‌باکس‌ها */}
            <div className="flex flex-wrap gap-6 border-t border-[#39FF14]/10 pt-5">
              <label className="flex cursor-pointer items-center gap-3 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-5 w-5 accent-[#39FF14]"
                />
                <span>
                  قیمت من <span className="font-bold text-[#39FF14]">فعال</span> باشه
                  (در فروشگاه نمایش داده بشه)
                </span>
              </label>
            </div>

            {/* دکمه‌ها */}
            <div className="flex flex-wrap gap-3 border-t border-[#39FF14]/10 pt-5">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-[#39FF14] px-8 py-3 font-bold text-black shadow-[0_0_20px_rgba(57,255,20,0.5)] transition hover:bg-[#39FF14]/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "در حال ذخیره..." : existing ? "💾 ذخیره تغییرات" : "💰 ثبت قیمت"}
              </button>
              {existing && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded-lg border border-red-500/40 px-6 py-3 text-sm font-bold text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
                >
                  {deleting ? "در حال حذف..." : "🗑️ حذف قیمت من"}
                </button>
              )}
              <Link
                href="/seller/products"
                className="rounded-lg border border-[#39FF14]/40 px-8 py-3 font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10"
              >
                انصراف
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}