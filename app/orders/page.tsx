"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { supabase } from "@/lib/supabase";

type Order = {
  id: number;
  status: string;
  final_price: number;
  created_at: string;
};

const statusConfig: Record<string, { label: string; color: string; icon: string }> = {
  pending: { label: "در انتظار پرداخت", color: "border-yellow-500/40 bg-yellow-500/10 text-yellow-400", icon: "⏳" },
  paid: { label: "پرداخت شده", color: "border-blue-500/40 bg-blue-500/10 text-blue-400", icon: "💳" },
  processing: { label: "در حال پردازش", color: "border-blue-500/40 bg-blue-500/10 text-blue-400", icon: "⚙️" },
  shipped: { label: "ارسال شده", color: "border-purple-500/40 bg-purple-500/10 text-purple-400", icon: "🚚" },
  delivered: { label: "تحویل داده شده", color: "border-[#39FF14]/40 bg-[#39FF14]/10 text-[#39FF14]", icon: "✅" },
  cancelled: { label: "لغو شده", color: "border-red-500/40 bg-red-500/10 text-red-400", icon: "❌" },
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const loadOrders = async () => {
    const userId = localStorage.getItem("userId");
    if (!userId) {
      setError("لطفاً وارد شوید");
      setLoading(false);
      return;
    }

    const { data, error: queryError } = await supabase
      .from("orders")
      .select("id, status, final_price, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (queryError) {
      setError(queryError.message);
      setLoading(false);
      return;
    }

    setOrders((data ?? []) as Order[]);
    setLoading(false);
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const handleCancel = async (orderId: number) => {
    if (!confirm("مطمئنی می‌خوای این سفارش رو لغو کنی؟ این عمل قابل بازگشت نیست.")) return;

    setCancellingId(orderId);

    const { error: updateError } = await supabase
      .from("orders")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", orderId);

    if (updateError) {
      alert(`خطا در لغو سفارش: ${updateError.message}`);
      setCancellingId(null);
      return;
    }

    // آپدیت لیست
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: "cancelled" } : o))
    );
    setCancellingId(null);
  };

  const formatToman = (n: number) => `${n.toLocaleString("fa-IR")} تومان`;
  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("fa-IR", {
        year: "numeric", month: "long", day: "numeric",
      });
    } catch { return iso; }
  };

  const canCancel = (status: string) =>
    ["pending", "paid"].includes(status);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">
        <div className="text-gray-400">در حال بارگذاری...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-white" dir="rtl">
      <header className="border-b border-[#39FF14]/20 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Logo size={36} />
            <h1 className="text-xl font-bold text-[#39FF14]">ماشین من</h1>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/shop" className="rounded-full border border-[#39FF14]/30 px-4 py-2 text-sm text-[#39FF14] transition hover:bg-[#39FF14]/10">
              فروشگاه
            </Link>
            <Link href="/dashboard" className="rounded-full border border-[#39FF14]/30 px-4 py-2 text-sm text-[#39FF14] transition hover:bg-[#39FF14]/10">
              بازگشت به پنل
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-12">
        <h2 className="mb-2 text-3xl font-bold">
          پیگیری <span className="text-[#39FF14]">سفارشات</span>
        </h2>
        <p className="mb-8 text-sm text-gray-400">
          سابقه خرید و پیگیری وضعیت سفارش‌های شما
        </p>

        {error && (
          <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            ❌ {error}
          </div>
        )}

        {orders.length === 0 && !error ? (
          <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-12 text-center">
            <div className="mb-4 text-6xl">📋</div>
            <p className="mb-6 text-lg text-gray-300">هنوز سفارشی ثبت نکردی</p>
            <Link href="/shop" className="inline-block rounded-lg bg-[#39FF14] px-6 py-3 font-bold text-black transition hover:bg-[#39FF14]/90">
              🛒 رفتن به فروشگاه
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => {
              const config = statusConfig[order.status] || statusConfig.pending;
              const isCancelling = cancellingId === order.id;

              return (
                <div
                  key={order.id}
                  className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-5 transition hover:border-[#39FF14]/50"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Link href={`/orders/${order.id}`} className="group">
                      <p className="text-xs text-gray-400">شماره سفارش</p>
                      <p className="mt-1 text-xl font-bold text-[#39FF14] transition group-hover:underline">
                        #{order.id.toLocaleString("fa-IR")}
                      </p>
                    </Link>
                    <span className={`rounded-full border px-3 py-1.5 text-xs font-bold ${config.color}`}>
                      {config.icon} {config.label}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#39FF14]/10 pt-3">
                    <span className="text-xs text-gray-400">📅 {formatDate(order.created_at)}</span>
                    <span className="font-bold text-white">{formatToman(order.final_price)}</span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href={`/orders/${order.id}`}
                      className="flex-1 rounded-lg border border-[#39FF14]/40 px-4 py-2 text-center text-xs font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10"
                    >
                      👁️ مشاهده جزئیات
                    </Link>
                    {canCancel(order.status) && (
                      <button
                        type="button"
                        onClick={() => handleCancel(order.id)}
                        disabled={isCancelling}
                        className="flex-1 rounded-lg border border-red-500/40 px-4 py-2 text-xs font-bold text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
                      >
                        {isCancelling ? "در حال لغو..." : "❌ لغو سفارش"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}