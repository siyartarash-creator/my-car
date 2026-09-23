"use client";

import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const presetAvatars = [
  "🚗", "🚙", "🏎️", "🚐", "🛻", "🏍️",
  "🔧", "🔩", "⚙️", "🛠️", "⚡", "🔋",
  "👨‍🔧", "👩‍🔧", "🧑‍🔧", "👤", "🧑", "👨",
];

export function AvatarPicker() {
  const [avatarType, setAvatarType] = useState<"preset" | "upload">("preset");
  const [selectedPreset, setSelectedPreset] = useState<string>("🚗");
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const loadAvatar = async () => {
      const userId = localStorage.getItem("userId");
      if (!userId) {
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("avatar_type, avatar_value")
        .eq("id", userId)
        .single();

      if (!error && data) {
        if (data.avatar_type === "upload" && data.avatar_value) {
          setAvatarType("upload");
          setUploadedImage(data.avatar_value);
        } else {
          setAvatarType("preset");
          setSelectedPreset(data.avatar_value || "🚗");
        }
      }
      setLoading(false);
    };
    loadAvatar();
  }, []);

  const saveAvatar = async (type: string, value: string) => {
    const userId = localStorage.getItem("userId");
    if (!userId) return;
    await supabase
      .from("profiles")
      .update({ avatar_type: type, avatar_value: value, updated_at: new Date().toISOString() })
      .eq("id", userId);
  };

  const handlePresetSelect = async (emoji: string) => {
    setSelectedPreset(emoji);
    setAvatarType("preset");
    setUploadedImage(null);
    setUploadError("");
    await saveAvatar("preset", emoji);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError("");

    if (file.size > 2 * 1024 * 1024) {
      setUploadError("حجم عکس باید کمتر از ۲ مگابایت باشد");
      return;
    }

    if (!file.type.startsWith("image/")) {
      setUploadError("فقط فایل تصویری مجاز است");
      return;
    }

    const userId = localStorage.getItem("userId");
    if (!userId) {
      setUploadError("لطفاً ابتدا وارد شوید");
      return;
    }

    // چک کردن session فعال
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      setUploadError("نشست شما منقضی شده. لطفاً از حساب خارج شده و دوباره وارد شوید");
      return;
    }

    setUploading(true);

    try {
      const ext = file.name.split(".").pop() || "jpg";
      const fileName = `${userId}-${Date.now()}.${ext}`;
      const filePath = `users/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, {
          upsert: true,
          contentType: file.type,
        });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        setUploadError(`خطا در آپلود: ${uploadError.message}`);
        setUploading(false);
        return;
      }

      const { data: urlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath);

      const publicUrl = urlData.publicUrl;

      await saveAvatar("upload", publicUrl);
      setUploadedImage(publicUrl);
      setAvatarType("upload");
    } catch (err) {
      console.error("Caught error:", err);
      setUploadError(
        `خطای غیرمنتظره: ${err instanceof Error ? err.message : "نامشخص"}`
      );
    }

    setUploading(false);
  };

  const handleRemoveUpload = async () => {
    const userId = localStorage.getItem("userId");
    if (!userId) return;

    setUploadedImage(null);
    setAvatarType("preset");
    setSelectedPreset("🚗");
    await saveAvatar("preset", "🚗");

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/40 p-6 text-center text-sm text-gray-400">
        در حال بارگذاری...
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/40 p-6">
      <div className="mb-5 text-center">
        <h3 className="text-lg font-bold text-[#39FF14]">عکس پروفایل</h3>
        <p className="text-xs text-gray-400">
          می‌تونی عکس خودت یا خودروت رو بذاری، یا یه آواتار انتخاب کنی
        </p>
      </div>

      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-2 border-[#39FF14]/60 bg-neutral-800 text-5xl shadow-[0_0_25px_rgba(57,255,20,0.4)]">
            {avatarType === "upload" && uploadedImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={uploadedImage}
                alt="آواتار"
                className="h-full w-full object-cover"
              />
            ) : (
              <span>{selectedPreset}</span>
            )}
          </div>
          {avatarType === "upload" && uploadedImage && (
            <button
              type="button"
              onClick={handleRemoveUpload}
              className="absolute -top-1 -left-1 flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-xs text-white shadow-lg transition hover:bg-red-600"
              title="حذف عکس"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex gap-1 rounded-full border border-[#39FF14]/20 bg-neutral-950/50 p-1">
          <button
            type="button"
            onClick={() => { setAvatarType("preset"); setUploadError(""); }}
            className={`rounded-full px-4 py-1.5 text-xs font-bold transition ${
              avatarType === "preset"
                ? "bg-[#39FF14] text-black"
                : "text-gray-400 hover:text-[#39FF14]"
            }`}
          >
            انتخاب آواتار
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={`rounded-full px-4 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
              avatarType === "upload"
                ? "bg-[#39FF14] text-black"
                : "text-gray-400 hover:text-[#39FF14]"
            }`}
          >
            {uploading ? "در حال آپلود..." : "آپلود عکس"}
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          className="hidden"
        />
      </div>

      {uploadError && (
        <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          ❌ {uploadError}
        </div>
      )}

      {avatarType === "preset" && (
        <div className="mt-6">
          <p className="mb-3 text-center text-xs text-gray-400">
            یکی از این آواتارها را انتخاب کن
          </p>
          <div className="grid grid-cols-6 gap-2">
            {presetAvatars.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => handlePresetSelect(a)}
                className={`flex h-12 items-center justify-center rounded-xl border text-2xl transition ${
                  selectedPreset === a
                    ? "border-[#39FF14] bg-[#39FF14]/20 shadow-[0_0_15px_rgba(57,255,20,0.5)]"
                    : "border-[#39FF14]/20 hover:border-[#39FF14]/60"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      )}

      {avatarType === "upload" && !uploadedImage && !uploading && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full rounded-xl border-2 border-dashed border-[#39FF14]/40 py-8 text-sm text-gray-400 transition hover:border-[#39FF14] hover:bg-[#39FF14]/5 hover:text-[#39FF14]"
          >
            <div className="mb-2 text-3xl">📷</div>
            <p>برای انتخاب عکس کلیک کن</p>
            <p className="mt-1 text-xs text-gray-500">
              فرمت JPG یا PNG — حداکثر ۲ مگابایت
            </p>
          </button>
        </div>
      )}

      {uploading && (
        <div className="mt-6 text-center text-sm text-[#39FF14]">
          ⏳ در حال آپلود عکس...
        </div>
      )}
    </div>
  );
}