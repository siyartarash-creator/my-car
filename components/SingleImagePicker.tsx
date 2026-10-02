"use client";
import { getCurrentUserId } from "@/lib/auth-client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

// Reuses the existing owner-scoped "avatars" Storage bucket/policy
// (write allowed only under auth.uid()-prefixed paths; public read already
// applies to this bucket). No new bucket or policy is introduced.

type Props = {
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  label: string;
  filePrefix: string;
};

export function SingleImagePicker({ value, onChange, label, filePrefix }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError("");

    if (file.size > 2 * 1024 * 1024) {
      setError("حجم عکس باید کمتر از ۲ مگابایت باشد");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("فقط فایل تصویری مجاز است");
      return;
    }

    const userId = await getCurrentUserId();
    if (!userId) {
      setError("لطفاً ابتدا وارد شوید");
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      setError("نشست شما منقضی شده. لطفاً از حساب خارج شده و دوباره وارد شوید");
      return;
    }

    setUploading(true);

    try {
      const ext = file.name.split(".").pop() || "jpg";
      const fileName = `${filePrefix}-${Date.now()}.${ext}`;
      const filePath = `${userId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, { upsert: true, contentType: file.type });

      if (uploadError) {
        setError(`خطا در آپلود: ${uploadError.message}`);
        setUploading(false);
        return;
      }

      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(filePath);
      onChange(urlData.publicUrl);
    } catch (err) {
      setError(`خطای غیرمنتظره: ${err instanceof Error ? err.message : "نامشخص"}`);
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRemove = () => {
    onChange(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/40 p-6">
      <h3 className="mb-4 text-base font-bold text-[#39FF14]">{label}</h3>

      {value ? (
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt={label} className="h-24 w-24 rounded-lg border border-[#39FF14]/30 object-cover" />
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="rounded-lg border border-[#39FF14]/40 px-4 py-2 text-xs font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10 disabled:opacity-50"
            >
              {uploading ? "در حال آپلود..." : "تغییر عکس"}
            </button>
            <button
              type="button"
              onClick={handleRemove}
              disabled={uploading}
              className="rounded-lg border border-red-500/30 px-4 py-2 text-xs font-bold text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
            >
              حذف عکس
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[#39FF14]/40 py-6 text-sm text-gray-400 transition hover:border-[#39FF14] hover:bg-[#39FF14]/5 hover:text-[#39FF14] disabled:opacity-50"
        >
          {uploading ? "⏳ در حال آپلود..." : "📷 افزودن عکس (حداکثر ۲ مگابایت)"}
        </button>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
      {error && <p className="mt-3 text-xs text-red-400">⚠ {error}</p>}
    </div>
  );
}
