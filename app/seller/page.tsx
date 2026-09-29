"use client";
import { getCurrentUserId } from "@/lib/auth-client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function SellerDashboard() {
  const [stats, setStats] = useState({
    myPrices: 0,
    totalProducts: 0,
    requests: 0,
    totalStock: 0,
    pendingOrders: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const userId = await getCurrentUserId();
      if (!userId) {
        setLoading(false);
        return;
      }

      const [myPricesRes, productsRes, requestsRes, pendingRes] =
        await Promise.all([
          supabase
            .from("product_sellers")
            .select("stock")
            .eq("seller_id", userId)
            .eq("is_active", true),
          supabase.from("products").select("id", { count: "exact", head: true }),
          supabase
            .from("product_requests")
            .select("id", { count: "exact", head: true })
            .eq("seller_id", userId),
          supabase
            .from("seller_fulfillments")
            .select("order_id,status")
            .eq("seller_id", userId)
            .eq("status", "pending"),
        ]);

      const myPrices = myPricesRes.data || [];
      const totalStock = myPrices.reduce((sum, p) => sum + (p.stock || 0), 0);

      let pendingOrders = 0;
      if (pendingRes.data) {
        const uniqueOrders = new Set(
          pendingRes.data.map((i) => i.order_id)
        );
        pendingOrders = uniqueOrders.size;
      }

      setStats({
        myPrices: myPrices.length,
        totalProducts: productsRes.count || 0,
        requests: requestsRes.count || 0,
        totalStock,
        pendingOrders,
      });
      setLoading(false);
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-gray-400">
        در حال بارگذاری...
      </div>
    );
  }

  const cards = [
    {
      label: "سفارشات جدید",
      value: stats.pendingOrders,
      icon: "🛍️",
      href: "/seller/orders",
      color: "from-red-500/20 to-transparent",
      highlight: stats.pendingOrders > 0,
    },
    {
      label: "محصولات با قیمت من",
      value: stats.myPrices,
      icon: "💰",
      href: "/seller/my-products",
      color: "from-[#39FF14]/20 to-transparent",
      highlight: false,
    },
    {
      label: "کل قطعات موجود در سایت",
      value: stats.totalProducts,
      icon: "📚",
      href: "/seller/products",
      color: "from-blue-500/20 to-transparent",
      highlight: false,
    },
    {
      label: "موجودی کل من",
      value: stats.totalStock,
      icon: "📦",
      href: "/seller/my-products",
      color: "from-yellow-500/20 to-transparent",
      highlight: false,
    },
  ];

  return (
    <div>
      <h2 className="mb-2 text-2xl font-bold md:text-3xl">
        داشبورد <span className="text-[#39FF14]">فروشنده</span>
      </h2>
      <p className="mb-8 text-gray-400">خلاصه وضعیت فروشگاه شما</p>

      {/* هشدار سفارشات جدید */}
      {stats.pendingOrders > 0 && (
        <Link
          href="/seller/orders"
          className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-red-500/40 bg-red-500/5 p-5 transition hover:border-red-500/70 hover:bg-red-500/10"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-red-500/40 bg-red-500/10 text-2xl">
              🔔
            </div>
            <div>
              <p className="font-bold text-red-400">
                {stats.pendingOrders.toLocaleString("fa-IR")} سفارش جدید داری!
              </p>
              <p className="text-xs text-gray-400">
                برای مشاهده و پیگیری کلیک کن
              </p>
            </div>
          </div>
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
            className="shrink-0 rotate-180 text-red-400"
          >
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className={`group relative overflow-hidden rounded-2xl border p-6 transition ${
              c.highlight
                ? "border-red-500/50 bg-red-500/5 hover:border-red-500 hover:shadow-[0_0_25px_rgba(239,68,68,0.2)]"
                : "border-[#39FF14]/20 bg-neutral-900/60 hover:border-[#39FF14]/70 hover:shadow-[0_0_25px_rgba(57,255,20,0.15)]"
            }`}
          >
            <div
              className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${c.color} opacity-0 transition group-hover:opacity-100`}
            />
            <div className="relative">
              <div className="mb-3 text-4xl">{c.icon}</div>
              <p
                className={`text-3xl font-bold ${
                  c.highlight ? "text-red-400" : "text-[#39FF14]"
                }`}
              >
                {c.value.toLocaleString("fa-IR")}
              </p>
              <p className="mt-1 text-sm text-gray-400">{c.label}</p>
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6">
        <h3 className="mb-4 text-lg font-bold text-[#39FF14]">دسترسی سریع</h3>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/seller/orders"
            className="rounded-lg bg-[#39FF14] px-5 py-2.5 text-sm font-bold text-black transition hover:bg-[#39FF14]/90"
          >
            🛍️ سفارشات من
          </Link>
          <Link
            href="/seller/products"
            className="rounded-lg border border-[#39FF14]/40 px-5 py-2.5 text-sm font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10"
          >
            🔍 مشاهده لیست قطعات
          </Link>
          <Link
            href="/seller/requests/new"
            className="rounded-lg border border-[#39FF14]/40 px-5 py-2.5 text-sm font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10"
          >
            ➕ درخواست قطعه جدید
          </Link>
          <Link
            href="/seller/my-products"
            className="rounded-lg border border-[#39FF14]/40 px-5 py-2.5 text-sm font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10"
          >
            📦 محصولات من
          </Link>
        </div>
      </div>
    </div>
  );
}