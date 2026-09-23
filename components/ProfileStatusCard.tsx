"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Profile = {
  user_type: string | null;
  avatar_type: string | null;
  avatar_value: string | null;
  address_data: {
    province?: string;
    city?: string;
    street?: string;
  } | null;
  phone1: string | null;
  data: {
    car?: { brandId?: string; modelId?: string };
    seller?: { shopName?: string; specialties?: string[] };
    serviceExpertise?: string[];
    rescuer?: { rescueTypes?: string[] };
  } | null;
};

function getMissingFields(
  profile: Profile,
  userType: string
): string[] {
  const missing: string[] = [];

  // آدرس
  const addr = profile.address_data;
  if (!addr?.province) missing.push("استان");
  if (!addr?.city) missing.push("شهر");
  if (!addr?.street) missing.push("خیابان");

  // شماره تماس
  if (!profile.phone1) missing.push("شماره تماس");

  // مخصوص هر نوع کاربر
  if (userType === "owner") {
    if (!profile.data?.car?.brandId) missing.push("برند خودرو");
    if (!profile.data?.car?.modelId) missing.push("مدل خودرو");
  } else if (userType === "seller") {
    if (!profile.data?.seller?.shopName) missing.push("نام فروشگاه");
    if (!profile.data?.seller?.specialties?.length)
      missing.push("حوزه تخصص");
  } else if (userType === "service") {
    if (!profile.data?.serviceExpertise?.length)
      missing.push("نوع خدمات");
  } else if (userType === "rescuer") {
    if (!profile.data?.rescuer?.rescueTypes?.length)
      missing.push("نوع امداد");
  }

  return missing;
}

export function ProfileStatusCard() {
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState<string[]>([]);
  const [userType, setUserType] = useState("owner");

  useEffect(() => {
    const load = async () => {
      const userId = localStorage.getItem("userId");
      if (!userId) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("user_type, avatar_type, avatar_value, address_data, phone1, data")
        .eq("id", userId)
        .single();

      if (data) {
        const p = data as Profile;
        const type = p.user_type || "owner";
        setUserType(type);
        setMissing(getMissingFields(p, type));
      }
      setLoading(false);
    };
    load();
  }, []);

  if (loading) return null;

  // اگه پروفایل کامله → نشان سبز
  if (missing.length === 0) {
    return (
      <div className="mb-8 flex items-center justify-between gap-4 rounded-2xl border border-[#39FF14]/40 bg-[#39FF14]/5 p-5 shadow-[0_0_25px_rgba(57,255,20,0.15)]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#39FF14] bg-[#39FF14]/20 text-xl shadow-[0_0_15px_rgba(57,255,20,0.5)]">
            ✅
          </div>
          <div>
            <p className="font-bold text-[#39FF14]">
              پروفایل شما کامل است
            </p>
            <p className="text-xs text-gray-400">
              همه خدمات ماشین من برات فعاله
            </p>
          </div>
        </div>
        <Link
          href={`/profile?type=${userType}`}
          className="shrink-0 rounded-full border border-[#39FF14]/40 px-4 py-2 text-xs font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10"
        >
          مشاهده پروفایل
        </Link>
      </div>
    );
  }

  // اگه ناقصه → نوار زرد با لیست کمبودها
  return (
    <div className="mb-8 rounded-2xl border border-yellow-500/30 bg-yellow-500/5 p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <span className="text-2xl">⚠️</span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-yellow-400">
              پروفایل شما کامل نیست
            </p>
            <p className="mt-1 text-sm text-gray-400">
              برای استفاده از همه خدمات، اینا رو تکمیل کن:
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {missing.map((m) => (
                <span
                  key={m}
                  className="rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-1 text-[10px] text-yellow-400"
                >
                  {m}
                </span>
              ))}
            </div>
          </div>
        </div>
        <Link
          href={`/profile?type=${userType}`}
          className="shrink-0 rounded-lg bg-yellow-500/20 px-5 py-2 text-sm font-bold text-yellow-400 transition hover:bg-yellow-500/30"
        >
          تکمیل پروفایل ←
        </Link>
      </div>
    </div>
  );
}