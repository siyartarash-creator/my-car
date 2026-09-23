"use client";

import { useEffect, useState } from "react";
import { useParams, notFound } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Logo } from "@/components/Logo";

type Order = {
  id: number;
  user_id: string;
  status: string;
  total_price: number;
  shipping_cost: number;
  final_price: number;
  shipping_address: {
    full_name: string;
    mobile: string;
    province: string;
    city: string;
    region?: string;
    street?: string;
    alley?: string;
    postal_code?: string | null;
    notes?: string | null;
  } | null;
  payment_method: string | null;
  payment_status: string | null;
  created_at: string;
};

type OrderItem = {
  id: number;
  product_id: number | null;
  product_name: string;
  product_price: number;
  quantity: number;
};

const statusConfig: Record<string, { label: string; color: string; icon: string }> = {
  pending: { label: "در انتظار پرداخت", color: "border-yellow-500/40 bg-yellow-500/10 text-yellow-400", icon: "⏳" },
  paid: { label: "پرداخت شده", color: "border-blue-500/40 bg-blue-500/10 text-blue-400", icon: "💳" },
  processing: { label: "در حال پردازش", color: "border-blue-500/40 bg-blue-500/10 text-blue-400", icon: "⚙️" },
  shipped: { label: "ارسال شده", color: "border-purple-500/40 bg-purple-500/10 text-purple-400", icon: "🚚" },
  delivered: { label: "تحویل داده شده", color: "border-[#39FF14]/40 bg-[#39FF14]/10 text-[#39FF14]", icon: "✅" },
  cancelled: { label: "لغو شده", color: "border-red-500/40 bg-red-500/10 text-red-400", icon: "❌" },
};

function formatToman(amount: number): string {
  return `${amount.toLocaleString("fa-IR")} تومان`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("fa-IR", {
      year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

export default function OrderPage() {
  const params = useParams();
  const id = params.id as string;

  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFoundError, setNotFoundError] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = async () => {
    const { data: orderData, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", id)
      .single();

    if (orderError || !orderData) {
      setNotFoundError(true);
      setLoading(false);
      return;
    }

    setOrder(orderData as Order);

    const { data: itemsData } = await supabase
      .from("order_items")
      .select("id, product_id, product_name, product_price, quantity")
      .eq("order_id", id);

    setItems((itemsData ?? []) as OrderItem[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [id]);

  const handleCancel = async () => {
    if (!order) return;
    if (!confirm("مطمئنی می‌خوای این سفارش رو لغو کنی؟")) return;

    setCancelling(true);
    const { error: updateError } = await supabase
      .from("orders")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", order.id);

    if (updateError) {
      alert(`خطا: ${updateError.message}`);
      setCancelling(false);
      return;
    }

    setOrder({ ...order, status: "cancelled" });
    setCancelling(false);
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">
        <div className="text-gray-400">در حال بارگذاری...</div>
      </main>
    );
  }

  if (notFoundError || !order) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white" dir="rtl">
        <div className="text-center">
          <div className="mb-4 text-6xl">🔍</div>
          <p className="mb-6 text-lg text-gray-300">سفارش پیدا نشد</p>
          <Link
            href="/orders"
            className="inline-block rounded-lg bg-[#39FF14] px-6 py-3 font-bold text-black transition hover:bg-[#39FF14]/90"
          >
            بازگشت به سفارشات
          </Link>
        </div>
      </main>
    );
  }

  const config = statusConfig[order.status] || statusConfig.pending;
  const canCancel = ["pending", "paid"].includes(order.status);

  return (
    <main className="min-h-screen bg-neutral-950 text-white" dir="rtl">
      <header className="border-b border-[#39FF14]/20 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Logo size={36} />
            <h1 className="text-xl font-bold text-[#39FF14]">ماشین من</h1>
          </Link>
          <Link
            href="/orders"
            className="rounded-full border border-[#39FF14]/30 px-4 py-2 text-sm text-[#39FF14] transition hover:bg-[#39FF14]/10"
          >
            بازگشت به سفارشات
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-8 text-center">
          <div className="mb-4 text-6xl">{config.icon}</div>
          <h2 className="mb-2 text-3xl font-bold">
            سفارش #{order.id.toLocaleString("fa-IR")}
          </h2>
          <p className="text-gray-400">جزئیات کامل سفارش شما</p>
        </div>

        <div className="space-y-6">
          {/* وضعیت */}
          <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs text-gray-400">شماره سفارش</p>
                <p className="mt-1 text-2xl font-bold text-[#39FF14]">
                  #{order.id.toLocaleString("fa-IR")}
                </p>
              </div>
              <span className={`rounded-full border px-4 py-2 text-sm font-bold ${config.color}`}>
                {config.icon} {config.label}
              </span>
            </div>
            <div className="mt-4 border-t border-[#39FF14]/10 pt-4">
              <p className="text-xs text-gray-400">
                تاریخ ثبت: {formatDate(order.created_at)}
              </p>
            </div>
          </div>

          {/* محصولات */}
          <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6">
            <h3 className="mb-4 text-lg font-bold text-[#39FF14]">📦 محصولات سفارش</h3>
            <div className="space-y-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between border-b border-[#39FF14]/10 pb-3 last:border-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-white">{item.product_name}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      {item.quantity.toLocaleString("fa-IR")} عدد ×{" "}
                      {formatToman(item.product_price)}
                    </p>
                  </div>
                  <p className="shrink-0 font-bold text-[#39FF14]">
                    {formatToman(item.product_price * item.quantity)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* آدرس */}
          {order.shipping_address && (
            <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6">
              <h3 className="mb-4 text-lg font-bold text-[#39FF14]">📍 آدرس ارسال</h3>
              <div className="space-y-2 text-sm">
                <p>
                  <span className="text-gray-400">نام: </span>
                  <span className="text-white">{order.shipping_address.full_name}</span>
                </p>
                <p>
                  <span className="text-gray-400">موبایل: </span>
                  <span className="text-white" dir="ltr">{order.shipping_address.mobile}</span>
                </p>
                <p>
                  <span className="text-gray-400">آدرس: </span>
                  <span className="text-white">
                    {order.shipping_address.province}، {order.shipping_address.city}
                    {order.shipping_address.region && `، ${order.shipping_address.region}`}
                    {order.shipping_address.street && `، ${order.shipping_address.street}`}
                    {order.shipping_address.alley && `، ${order.shipping_address.alley}`}
                  </span>
                </p>
                {order.shipping_address.postal_code && (
                  <p>
                    <span className="text-gray-400">کد پستی: </span>
                    <span className="text-white" dir="ltr">{order.shipping_address.postal_code}</span>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* مالی */}
          <div className="rounded-2xl border border-[#39FF14]/30 bg-neutral-900/60 p-6">
            <h3 className="mb-4 text-lg font-bold text-[#39FF14]">💰 خلاصه مالی</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">جمع کالاها</span>
                <span className="text-white">{formatToman(order.total_price)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">هزینه ارسال</span>
                <span className="text-white">{formatToman(order.shipping_cost)}</span>
              </div>
              <div className="flex justify-between border-t border-[#39FF14]/20 pt-3">
                <span className="font-bold text-gray-300">مبلغ نهایی</span>
                <span className="text-lg font-bold text-[#39FF14]">{formatToman(order.final_price)}</span>
              </div>
            </div>
          </div>

          {/* دکمه‌ها */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/shop"
              className="flex-1 rounded-lg bg-[#39FF14] px-6 py-3 text-center font-bold text-black transition hover:bg-[#39FF14]/90"
            >
              🛒 ادامه خرید
            </Link>
            {canCancel && (
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                className="flex-1 rounded-lg border border-red-500/40 px-6 py-3 font-bold text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
              >
                {cancelling ? "در حال لغو..." : "❌ لغو سفارش"}
              </button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}