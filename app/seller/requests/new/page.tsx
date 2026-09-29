"use client";
import { getCurrentUserId } from "@/lib/auth-client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function NewRequestPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [productName, setProductName] = useState("");
  const [brand, setBrand] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 3 * 1024 * 1024) {
      setError("حجم عکس باید کمتر از ۳ مگابایت باشد");
      return;
    }

    if (!file.type.startsWith("image/")) {
      setError("فقط فایل تصویری مجاز است");
      return;
    }

    setError("");
    setPhotoFile(file);

    const reader = new FileReader();
    reader.onload = (ev) => {
      setPhotoPreview(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const userId = await getCurrentUserId();
    if (!userId) {
      setError("لطفاً وارد شوید");
      return;
    }

    if (productName.trim().length < 3) {
      setError("نام محصول باید حداقل ۳ حرف باشه");
      return;
    }

    if (!photoFile) {
      setError("لطفاً یه عکس از محصول آپلود کن");
      return;
    }

    setSaving(true);

    try {
      // ۱. آپلود عکس به Supabase Storage
      const ext = photoFile.name.split(".").pop() || "jpg";
      const fileName = `${userId}/requests/${userId}-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(fileName, photoFile, {
          upsert: false,
          contentType: photoFile.type,
        });

      if (uploadError) {
        setError(`خطا در آپلود عکس: ${uploadError.message}`);
        setSaving(false);
        return;
      }

      const { data: urlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(fileName);

      const photoUrl = urlData.publicUrl;

      // ۲. ذخیره درخواست در دیتابیس
      const { error: insertError } = await supabase
        .from("product_requests")
        .insert({
          seller_id: userId,
          seller_name: null,
          seller_mobile: null,
          product_name: productName.trim(),
          brand: brand.trim() || null,
          photo_url: photoUrl,
        });

      if (insertError) {
        setError(`خطا در ثبت درخواست: ${insertError.message}`);
        setSaving(false);
        return;
      }

      setSaving(false);
      router.push("/seller/requests");
    } catch (err) {
      setError(
        `خطای غیرمنتظره: ${err instanceof Error ? err.message : "نامشخص"}`
      );
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/seller/requests"
          className="text-sm text-gray-400 transition hover:text-[#39FF14]"
        >
          ← بازگشت به درخواست‌ها
        </Link>
        <h2 className="mt-3 text-2xl font-bold md:text-3xl">
          درخواست <span className="text-[#39FF14]">قطعه جدید</span>
        </h2>
        <p className="mt-2 text-sm text-gray-400">
          اگه قطعه‌ای که می‌خوای بفروشی توی لیست نیست، این فرم رو پر کن. پشتیبانی با شما تماس می‌گیره.
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
        {/* نام محصول */}
        <div>
          <label className="mb-2 block text-sm font-bold text-gray-300">
            نام محصول *
          </label>
          <input
            type="text"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder="مثلاً: کویل پژو ۲۰۶ تیپ ۵"
            className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
            required
          />
        </div>

        {/* برند */}
        <div>
          <label className="mb-2 block text-sm font-bold text-gray-300">
            برند{" "}
            <span className="text-xs font-normal text-gray-500">(اختیاری)</span>
          </label>
          <input
            type="text"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="مثلاً: بوش، وارتا، ساچم"
            className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
          />
        </div>

        {/* آپلود عکس */}
        <div>
          <label className="mb-2 block text-sm font-bold text-gray-300">
            عکس محصول *
          </label>

          {photoPreview ? (
            <div className="relative overflow-hidden rounded-xl border border-[#39FF14]/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoPreview}
                alt="پیش‌نمایش"
                className="h-64 w-full object-contain bg-neutral-950"
              />
              <button
                type="button"
                onClick={() => {
                  setPhotoFile(null);
                  setPhotoPreview(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="absolute top-3 left-3 flex h-9 w-9 items-center justify-center rounded-full bg-red-500 text-white shadow-lg transition hover:bg-red-600"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-xl border-2 border-dashed border-[#39FF14]/40 py-10 text-sm text-gray-400 transition hover:border-[#39FF14] hover:bg-[#39FF14]/5 hover:text-[#39FF14]"
            >
              <div className="mb-3 text-4xl">📷</div>
              <p>برای انتخاب عکس کلیک کن</p>
              <p className="mt-1 text-xs text-gray-500">
                JPG یا PNG — حداکثر ۳ مگابایت
              </p>
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handlePhotoSelect}
            className="hidden"
          />
        </div>

        {/* یادداشت */}
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
          <p className="text-sm text-yellow-400">
            💡 بعد از ارسال درخواست، تیم پشتیبانی با شما تماس می‌گیره، اطلاعات کامل محصول رو می‌گیره و محصول رو به لیست اضافه می‌کنه.
          </p>
        </div>

        {/* دکمه‌ها */}
        <div className="flex gap-3 border-t border-[#39FF14]/10 pt-5">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-[#39FF14] px-8 py-3 font-bold text-black shadow-[0_0_20px_rgba(57,255,20,0.5)] transition hover:bg-[#39FF14]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "در حال ارسال..." : "📨 ارسال درخواست"}
          </button>
          <Link
            href="/seller/requests"
            className="rounded-lg border border-[#39FF14]/40 px-8 py-3 font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10"
          >
            انصراف
          </Link>
        </div>
      </form>
    </div>
  );
}