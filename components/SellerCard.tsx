"use client";
import { getCurrentUserId } from "@/lib/auth-client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export function SellerCard() {
  const [isSeller, setIsSeller] = useState(false);
  const [pendingOrders, setPendingOrders] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const check = async () => {
      const userId = await getCurrentUserId();
      if (!userId) {
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("user_type")
        .eq("id", userId)
        .single();

      if (!error && data?.user_type === "seller") {
        setIsSeller(true);

        // گرفتن سفارشات در انتظار این فروشنده
        const { data: orderItems } = await supabase
          .from("seller_fulfillments")
          .select("order_id,status")
          .eq("seller_id", userId)
          .eq("status", "pending");

        if (orderItems) {
          const uniqueOrders = new Set(orderItems.map((i) => i.order_id));
          setPendingOrders(uniqueOrders.size);
        }
      }
      setLoading(false);
    };
    check();
  }, []);

  if (loading || !isSeller) return null;

  return (
    <Link
      href="/seller"
      className="group relative mb-4 flex items-center justify-between overflow-hidden rounded-2xl border border-[#39FF14]/40 bg-[#39FF14]/5 p-5 transition hover:border-[#39FF14] hover:bg-[#39FF14]/10 hover:shadow-[0_0_30px_rgba(57,255,20,0.25)]"
    >
      <div className="pointer-events-none absolute -top-20 left-1/2 h-40 w-72 -translate-x-1/2 rounded-full bg-[#39FF14]/20 blur-3xl opacity-0 transition group-hover:opacity-100" />

      <div className="relative flex items-center gap-4">
        <div className="relative flex h-14 w-14 items-center justify-center rounded-xl border border-[#39FF14]/40 bg-[#39FF14]/10 text-3xl">
          🏪
          {pendingOrders > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white shadow-[0_0_10px_rgba(239,68,68,0.6)]">
              {pendingOrders.toLocaleString("fa-IR")}
            </span>
          )}
        </div>
        <div>
          <p className="text-lg font-bold text-[#39FF14]">پنل فروشنده</p>
          <p className="text-xs text-gray-400">
            {pendingOrders > 0
              ? `🔔 ${pendingOrders.toLocaleString("fa-IR")} سفارش جدید داری!`
              : "مدیریت محصولات، قیمت‌گذاری و سفارشات فروشگاه"}
          </p>
        </div>
      </div>

      <div className="relative flex items-center gap-2 text-sm font-bold text-[#39FF14]">
        <span className="hidden sm:inline">ورود به پنل</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="rotate-180 transition group-hover:-translate-x-1"
        >
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  );
}