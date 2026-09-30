"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { ProductImageUploader } from "@/components/ProductImageUploader";

type Category = { id: number; name: string };

export default function NewProductClient() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [brand, setBrand] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [description, setDescription] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [referencePrice, setReferencePrice] = useState("");
  const [isFeatured, setIsFeatured] = useState(false);
  const [images, setImages] = useState<string[]>([]);

  useEffect(() => {
    supabase
      .from("categories")
      .select("id, name")
      .order("sort_order")
      .then(({ data }) => {
        if (data) setCategories(data as Category[]);
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (name.trim().length < 3) {
      setError("نام محصول باید حداقل ۳ حرف باشه");
      return;
    }
    if (!slug.trim() || !/^[a-z0-9-]+$/.test(slug.trim())) {
      setError("slug باید فقط با حروف انگلیسی کوچک، عدد، و خط تیره باشه");
      return;
    }

    setSaving(true);

    // admin_create_product (supabase/migrations/202609300010) re-checks
    // products.write server-side and writes its admin_audit_log entry in the
    // same transaction as the insert. This component only invokes it.
    const { error: rpcError } = await supabase.rpc("admin_create_product", {
      p_name: name.trim(),
      p_slug: slug.trim(),
      p_brand: brand.trim() || null,
      p_part_number: partNumber.trim() || null,
      p_description: description.trim() || null,
      p_short_description: shortDescription.trim() || null,
      p_category_id: categoryId === "" ? null : categoryId,
      p_reference_price: referencePrice ? Number(referencePrice) : null,
      p_images: images,
      p_is_featured: isFeatured,
    });

    if (rpcError) {
      setError(`خطا در ذخیره: ${rpcError.message}`);
      setSaving(false);
      return;
    }

    setSaving(false);
    router.push("/admin/products");
  };

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/admin/products"
          className="text-sm text-gray-400 transition hover:text-[#39FF14]"
        >
          ← بازگشت به لیست محصولات
        </Link>
        <h2 className="mt-3 text-2xl font-bold md:text-3xl">
          افزودن <span className="text-[#39FF14]">محصول جدید</span>
        </h2>
        <p className="mt-2 text-sm text-gray-400">
          این محصول به لیست مرکزی اضافه می‌شه. فروشنده‌ها بعداً روی این محصول
          قیمت می‌ذارن.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          ❌ {error}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6"
      >
        {/* عکس‌ها */}
        <div className="rounded-xl border border-[#39FF14]/20 bg-neutral-950/50 p-4">
          <ProductImageUploader images={images} onChange={setImages} />
        </div>

        <div>
          <label className="mb-2 block text-sm font-bold text-gray-300">
            نام محصول *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثلاً باتری ۶۶ آمپر وارتا"
            className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
            required
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-bold text-gray-300">
            Slug (لینک انگلیسی) *
          </label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder="battery-66-varta"
            dir="ltr"
            className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-left text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
            required
          />
          <p className="mt-1 text-xs text-gray-500">
            فقط حروف انگلیسی کوچک، عدد، و خط تیره
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-bold text-gray-300">
              برند
            </label>
            <input
              type="text"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="وارتا"
              className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold text-gray-300">
              کد فنی
            </label>
            <input
              type="text"
              value={partNumber}
              onChange={(e) => setPartNumber(e.target.value)}
              placeholder="VA-66-2024"
              dir="ltr"
              className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-left text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
            />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-bold text-gray-300">
            دسته‌بندی
          </label>
          <select
            value={categoryId}
            onChange={(e) =>
              setCategoryId(e.target.value === "" ? "" : Number(e.target.value))
            }
            className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none focus:border-[#39FF14]"
          >
            <option value="">— انتخاب کن —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-bold text-gray-300">
            قیمت مرجع بازار (تومان)
            <span className="mr-2 text-xs font-normal text-gray-500">
              (اختیاری — برای بررسی قیمت فروشنده)
            </span>
          </label>
          <input
            type="text"
            value={referencePrice}
            onChange={(e) => setReferencePrice(e.target.value.replace(/\D/g, ""))}
            placeholder="4500000"
            dir="ltr"
            className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-left text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
          />
          <p className="mt-1 text-xs text-gray-500">
            💡 اگه فروشنده قیمتی خارج از محدوده منطقی بذاره، سیستم به شما هشدار
            می‌ده.
          </p>
        </div>

        <div>
          <label className="mb-2 block text-sm font-bold text-gray-300">
            توضیحات کوتاه
          </label>
          <input
            type="text"
            value={shortDescription}
            onChange={(e) => setShortDescription(e.target.value)}
            placeholder="یه جمله کوتاه درباره محصول"
            className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-bold text-gray-300">
            توضیحات کامل
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="توضیحات کامل محصول، کاربرد، مشخصات..."
            className="w-full resize-none rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-3 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={isFeatured}
            onChange={(e) => setIsFeatured(e.target.checked)}
            className="h-5 w-5 accent-[#39FF14]"
          />
          نمایش به عنوان محصول{" "}
          <span className="font-bold text-yellow-400">ویژه</span>
        </label>

        <div className="flex gap-3 border-t border-[#39FF14]/10 pt-5">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-[#39FF14] px-8 py-3 font-bold text-black shadow-[0_0_20px_rgba(57,255,20,0.5)] transition hover:bg-[#39FF14]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "در حال ذخیره..." : "ذخیره محصول"}
          </button>
          <Link
            href="/admin/products"
            className="rounded-lg border border-[#39FF14]/40 px-8 py-3 font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10"
          >
            انصراف
          </Link>
        </div>
      </form>
    </div>
  );
}
