"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { ProductImageUploader } from "@/components/ProductImageUploader";

type Category = { id: number; name: string };

export default function EditProductPage() {
  const router = useRouter();
  const params = useParams();
  const productId = params.id as string;

  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [brand, setBrand] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [description, setDescription] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [referencePrice, setReferencePrice] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isFeatured, setIsFeatured] = useState(false);
  const [images, setImages] = useState<string[]>([]);

  useEffect(() => {
    const load = async () => {
      const [catRes, prodRes] = await Promise.all([
        supabase.from("categories").select("id, name").order("sort_order"),
        supabase.from("products").select("*").eq("id", productId).single(),
      ]);

      if (catRes.data) setCategories(catRes.data as Category[]);

      if (prodRes.error || !prodRes.data) {
        setError("محصول پیدا نشد");
        setLoading(false);
        return;
      }

      const p = prodRes.data;
      setName(p.name || "");
      setSlug(p.slug || "");
      setBrand(p.brand || "");
      setPartNumber(p.part_number || "");
      setDescription(p.description || "");
      setShortDescription(p.short_description || "");
      setCategoryId(p.category_id ?? "");
      setReferencePrice(
        p.reference_price ? String(p.reference_price) : ""
      );
      setIsActive(p.is_active ?? true);
      setIsFeatured(p.is_featured ?? false);
      setImages(Array.isArray(p.images) ? p.images : []);
      setLoading(false);
    };
    load();
  }, [productId]);

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

    const { error: updateError } = await supabase
      .from("products")
      .update({
        name: name.trim(),
        slug: slug.trim(),
        brand: brand.trim() || null,
        part_number: partNumber.trim() || null,
        description: description.trim() || null,
        short_description: shortDescription.trim() || null,
        category_id: categoryId === "" ? null : categoryId,
        reference_price: referencePrice ? Number(referencePrice) : null,
        images: images,
        is_active: isActive,
        is_featured: isFeatured,
        updated_at: new Date().toISOString(),
      })
      .eq("id", productId);

    if (updateError) {
      setError(`خطا در ذخیره: ${updateError.message}`);
      setSaving(false);
      return;
    }

    setSaving(false);
    router.push("/admin/products");
  };

  const handleDelete = async () => {
    if (
      !confirm(
        "مطمئنی می‌خوای این محصول رو حذف کنی؟ این عمل قابل بازگشت نیست."
      )
    )
      return;

    setDeleting(true);
    const { error: deleteError } = await supabase
      .from("products")
      .delete()
      .eq("id", productId);

    if (deleteError) {
      setError(`خطا در حذف: ${deleteError.message}`);
      setDeleting(false);
      return;
    }

    router.push("/admin/products");
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
      <div className="mb-6">
        <Link
          href="/admin/products"
          className="text-sm text-gray-400 transition hover:text-[#39FF14]"
        >
          ← بازگشت به لیست محصولات
        </Link>
        <div className="mt-3 flex items-center justify-between">
          <h2 className="text-2xl font-bold md:text-3xl">
            ویرایش <span className="text-[#39FF14]">محصول</span>
          </h2>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-lg border border-red-500/40 px-4 py-2 text-sm font-bold text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
          >
            {deleting ? "در حال حذف..." : "🗑️ حذف محصول"}
          </button>
        </div>
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
            className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition focus:border-[#39FF14]"
            required
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-bold text-gray-300">
            Slug *
          </label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            dir="ltr"
            className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-left text-white outline-none transition focus:border-[#39FF14]"
            required
          />
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
              className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition focus:border-[#39FF14]"
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
              dir="ltr"
              className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-left text-white outline-none transition focus:border-[#39FF14]"
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
              (اختیاری)
            </span>
          </label>
          <input
            type="text"
            value={referencePrice}
            onChange={(e) =>
              setReferencePrice(e.target.value.replace(/\D/g, ""))
            }
            dir="ltr"
            className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-left text-white outline-none transition focus:border-[#39FF14]"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-bold text-gray-300">
            توضیحات کوتاه
          </label>
          <input
            type="text"
            value={shortDescription}
            onChange={(e) => setShortDescription(e.target.value)}
            className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition focus:border-[#39FF14]"
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
            className="w-full resize-none rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition focus:border-[#39FF14]"
          />
        </div>

        <div className="flex flex-wrap gap-6 border-t border-[#39FF14]/10 pt-5">
          <label className="flex cursor-pointer items-center gap-3 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-5 w-5 accent-[#39FF14]"
            />
            محصول <span className="font-bold text-[#39FF14]">فعال</span>
          </label>
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
        </div>

        <div className="flex gap-3 border-t border-[#39FF14]/10 pt-5">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-[#39FF14] px-8 py-3 font-bold text-black shadow-[0_0_20px_rgba(57,255,20,0.5)] transition hover:bg-[#39FF14]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "در حال ذخیره..." : "💾 ذخیره تغییرات"}
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