"use client";

import { useState, useRef } from "react";
import { supabase } from "@/lib/supabase";

type ProductImageUploaderProps = {
  images: string[];
  onChange: (images: string[]) => void;
  maxImages?: number;
};

export function ProductImageUploader({
  images,
  onChange,
  maxImages = 6,
}: ProductImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setError("");

    if (images.length + files.length > maxImages) {
      setError(`حداکثر ${maxImages} عکس می‌تونی آپلود کنی`);
      return;
    }

    for (const file of files) {
      if (file.size > 5 * 1024 * 1024) {
        setError(`حجم عکس «${file.name}» بیشتر از ۵ مگابایت است`);
        return;
      }
      if (!file.type.startsWith("image/")) {
        setError(`فایل «${file.name}» تصویر نیست`);
        return;
      }
    }

    setUploading(true);
    const uploadedUrls: string[] = [];

    try {
      for (const file of files) {
        const ext = file.name.split(".").pop() || "jpg";
        const fileName = `${Date.now()}-${Math.random()
          .toString(36)
          .substring(2, 10)}.${ext}`;
        const filePath = `products/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from("products")
          .upload(filePath, file, {
            upsert: false,
            contentType: file.type,
          });

        if (uploadError) {
          setError(`خطا در آپلود: ${uploadError.message}`);
          break;
        }

        const { data: urlData } = supabase.storage
          .from("products")
          .getPublicUrl(filePath);

        uploadedUrls.push(urlData.publicUrl);
      }

      if (uploadedUrls.length > 0) {
        onChange([...images, ...uploadedUrls]);
      }
    } catch (err) {
      setError(
        `خطای غیرمنتظره: ${err instanceof Error ? err.message : "نامشخص"}`
      );
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeImage = async (url: string, index: number) => {
    if (!confirm("مطمئنی می‌خوای این عکس رو حذف کنی؟")) return;

    try {
      const urlParts = url.split("/products/");
      if (urlParts.length === 2) {
        const filePath = `products/${urlParts[1]}`;
        await supabase.storage.from("products").remove([filePath]);
      }
    } catch (e) {
      console.error("خطا در حذف فایل:", e);
    }

    const newImages = images.filter((_, i) => i !== index);
    onChange(newImages);
  };

  const moveImage = (index: number, direction: "up" | "down") => {
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === images.length - 1) return;

    const newImages = [...images];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    [newImages[index], newImages[targetIndex]] = [
      newImages[targetIndex],
      newImages[index],
    ];
    onChange(newImages);
  };

  return (
    <div>
      <label className="mb-2 block text-sm font-bold text-gray-300">
        عکس‌های محصول{" "}
        <span className="text-xs font-normal text-gray-500">
          (حداکثر {maxImages} عکس — عکس اول به عنوان عکس اصلی)
        </span>
      </label>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs text-red-400">
          ❌ {error}
        </div>
      )}

      {images.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((url, index) => (
            <div
              key={index}
              className="group relative overflow-hidden rounded-xl border border-[#39FF14]/20 bg-neutral-950"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`عکس ${index + 1}`}
                className="aspect-square w-full object-cover"
              />

              <div className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs font-bold text-white">
                {index === 0 ? "🏠" : index + 1}
              </div>

              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/70 opacity-0 transition group-hover:opacity-100">
                {index > 0 && (
                  <button
                    type="button"
                    onClick={() => moveImage(index, "up")}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-[#39FF14] text-black transition hover:bg-[#39FF14]/80"
                    title="جابجایی"
                  >
                    ←
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeImage(url, index)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white transition hover:bg-red-600"
                  title="حذف"
                >
                  🗑️
                </button>
                {index < images.length - 1 && (
                  <button
                    type="button"
                    onClick={() => moveImage(index, "down")}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-[#39FF14] text-black transition hover:bg-[#39FF14]/80"
                    title="جابجایی"
                  >
                    →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {images.length < maxImages && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#39FF14]/40 py-8 text-sm text-gray-400 transition hover:border-[#39FF14] hover:bg-[#39FF14]/5 hover:text-[#39FF14] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? (
            <>
              <span className="text-3xl">⏳</span>
              <p>در حال آپلود...</p>
            </>
          ) : (
            <>
              <span className="text-3xl">📷</span>
              <p className="font-bold">افزودن عکس</p>
              <p className="text-xs text-gray-500">
                JPG، PNG یا WebP — حداکثر ۵ مگابایت
              </p>
              <p className="text-xs text-gray-500">
                {images.length} از {maxImages} عکس اضافه شده
              </p>
            </>
          )}
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}