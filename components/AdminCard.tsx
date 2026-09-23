"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export function AdminCard() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const check = async () => {
      const userId = localStorage.getItem("userId");
      if (!userId) {
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", userId)
        .single();

      if (!error && data?.is_admin) {
        setIsAdmin(true);

        const { count } = await supabase
          .from("product_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending");

        setPendingRequests(count || 0);
      }
      setLoading(false);
    };
    check();
  }, []);

  if (loading || !isAdmin) return null;

  return (
    <Link
      href="/admin"
      className="group relative mb-4 flex items-center justify-between overflow-hidden rounded-2xl border border-yellow-400/40 bg-yellow-400/5 p-5 transition hover:border-yellow-400 hover:bg-yellow-400/10 hover:shadow-[0_0_30px_rgba(250,204,21,0.25)]"
    >
      <div className="pointer-events-none absolute -top-20 left-1/2 h-40 w-72 -translate-x-1/2 rounded-full bg-yellow-400/20 blur-3xl opacity-0 transition group-hover:opacity-100" />

      <div className="relative flex items-center gap-4">
        <div className="relative flex h-14 w-14 items-center justify-center rounded-xl border border-yellow-400/40 bg-yellow-400/10 text-3xl">
          📊
          {pendingRequests > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white shadow-[0_0_10px_rgba(239,68,68,0.6)]">
              {pendingRequests.toLocaleString("fa-IR")}
            </span>
          )}
        </div>
        <div>
          <p className="text-lg font-bold text-yellow-400">پنل ادمین</p>
          <p className="text-xs text-gray-400">
            {pendingRequests > 0
              ? `🔔 ${pendingRequests.toLocaleString("fa-IR")} درخواست جدید داری!`
              : "مدیریت کامل فروشگاه، سفارشات و کاربران"}
          </p>
        </div>
      </div>

      <div className="relative flex items-center gap-2 text-sm font-bold text-yellow-400">
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