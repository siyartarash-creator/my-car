"use client";
import { getCurrentUserId } from "@/lib/auth-client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type UserAvatarProps = {
  size?: number;
  className?: string;
};

export function UserAvatar({ size = 48, className = "" }: UserAvatarProps) {
  const [avatarType, setAvatarType] = useState<string>("preset");
  const [avatarValue, setAvatarValue] = useState<string>("🚗");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const userId = await getCurrentUserId();
      if (!userId) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("avatar_type, avatar_value")
        .eq("id", userId)
        .single();

      if (data) {
        setAvatarType(data.avatar_type || "preset");
        setAvatarValue(data.avatar_value || "🚗");
      }
      setLoading(false);
    };
    load();
  }, []);

  const isImage = avatarType === "upload" && avatarValue.startsWith("http");

  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#39FF14]/60 bg-neutral-900 shadow-[0_0_15px_rgba(57,255,20,0.4)] ${className}`}
      style={{ width: size, height: size }}
    >
      {loading ? (
        <div className="h-full w-full animate-pulse bg-neutral-800" />
      ) : isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarValue}
          alt="آواتار"
          className="h-full w-full object-cover"
        />
      ) : (
        <span style={{ fontSize: size * 0.55 }}>{avatarValue}</span>
      )}
    </div>
  );
}