"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type OrderItem = {
  id: number;
  order_id: number;
  product_id: number | null;
  product_name: string;
  product_price: number;
  quantity: number;
  seller_id: string | null;
  orders: {
    id: number;
    status: string;
    created_at: string;
    shipping_address: {
      full_name: string;
      mobile: string;
      province: string;
      city: string;
      region?: string;
      street?: string;
      alley?: string;
      address?: string;
    } | null;
  } | null;
};

const statusConfig: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  pending: {
    label: "در انتظار",
    color: "border-yellow-500/40 bg-yellow-500/10 text-yellow-400",
    icon: "⏳",
  },
  paid: {
    label: "پرداخت شده",
    color: "border-blue-500/40 bg-blue-500/10 text-blue-400",
    icon: "💳",
  },
  processing: {
    label: "در حال پردازش",
    color: "border-blue-500/40 bg-blue-500/10 text-blue-400",
    icon: "⚙️",
  },
  shipped: {
    label: "ارسال شده",
    color: "border-purple-500/40 bg-purple-500/10 text-purple-400",
    icon: "🚚",
  },
  delivered: {
    label: "تحویل داده شده",
    color: "border-[#39FF14]/40 bg-[#39FF14]/10 text-[#39FF14]",
    icon: "✅",
  },
  cancelled: {
    label: "لغو شده",
    color: "border-red-500/40 bg-red-500/10 text-red-400",
    icon: "❌",
  },
};

export default function SellerOrdersPage() {
  const [items, setItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | string>("all");
  const [updatingOrderId, setUpdatingOrderId] = useState<number | null>(null);

  const loadOrders = async () => {
    const userId = localStorage.getItem("userId");
    if (!userId) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("order_items")
      .select(
        `
        id, order_id, product_id, product_name, product_price, 
        quantity, seller_id,
        orders (id, status, created_at, shipping_address)
      `
      )
      .eq("seller_id", userId)
      .order("id", { ascending: false });

    if (!error && data) {
      setItems(data as unknown as OrderItem[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadOrders();
  }, []);

  // تغییر وضعیت سفارش
  const handleStatusChange = async (orderId: number, newStatus: string) => {
    if (
      !confirm(
        `مطمئنی می‌خوای وضعیت این سفارش رو به «${
          statusConfig[newStatus]?.label || newStatus
        }» تغییر بدی؟`
      )
    )
      return;

    setUpdatingOrderId(orderId);

    const { error: updateError } = await supabase
      .from("orders")
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    if (updateError) {
      alert(`خطا در تغییر وضعیت: ${updateError.message}`);
      setUpdatingOrderId(null);
      return;
    }

    // آپدیت local
    setItems((prev) =>
      prev.map((item) =>
        item.order_id === orderId && item.orders
          ? { ...item, orders: { ...item.orders, status: newStatus } }
          : item
      )
    );

    setUpdatingOrderId(null);
  };

  const formatToman = (n: number) => `${n.toLocaleString("fa-IR")} تومان`;

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("fa-IR", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  // ساخت آدرس کامل از فیلدها
  const buildAddress = (addr: any) => {
    if (!addr) return "—";
    const parts = [
      addr.province,
      addr.city,
      addr.region,
      addr.street,
      addr.alley,
    ].filter(Boolean);
    return parts.join("، ");
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-gray-400">
        در حال بارگذاری...
      </div>
    );
  }

  const filtered =
    filter === "all"
      ? items
      : items.filter((i) => i.orders?.status === filter);

  const totalSales = items
    .filter((i) => i.orders?.status !== "cancelled")
    .reduce((sum, i) => sum + i.product_price * i.quantity, 0);
  const totalItems = items
    .filter((i) => i.orders?.status !== "cancelled")
    .reduce((sum, i) => sum + i.quantity, 0);
  const orderCount = new Set(items.map((i) => i.order_id)).size;
  const pendingCount = items.filter(
    (i) => i.orders?.status === "pending"
  ).length;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold md:text-3xl">
          سفارشات <span className="text-[#39FF14]">من</span>
        </h2>
        <p className="mt-2 text-sm text-gray-400">
          مدیریت سفارشات محصولات شما
        </p>
      </div>

      {/* آمار */}
      {items.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-[#39FF14]/20 bg-neutral-900/60 p-4">
            <p className="text-xs text-gray-400">کل سفارشات</p>
            <p className="mt-1 text-2xl font-bold text-[#39FF14]">
              {orderCount.toLocaleString("fa-IR")}
            </p>
          </div>
          <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
            <p className="text-xs text-gray-400">در انتظار بررسی</p>
            <p className="mt-1 text-2xl font-bold text-yellow-400">
              {pendingCount.toLocaleString("fa-IR")}
            </p>
          </div>
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
            <p className="text-xs text-gray-400">اقلام فروخته‌شده</p>
            <p className="mt-1 text-2xl font-bold text-blue-400">
              {totalItems.toLocaleString("fa-IR")}
            </p>
          </div>
          <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
            <p className="text-xs text-gray-400">درآمد کل</p>
            <p className="mt-1 text-xl font-bold text-green-400">
              {formatToman(totalSales)}
            </p>
          </div>
        </div>
      )}

      {/* فیلتر */}
      {items.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {[
            { id: "all", label: "همه" },
            { id: "pending", label: "در انتظار" },
            { id: "paid", label: "پرداخت شده" },
            { id: "processing", label: "پردازش" },
            { id: "shipped", label: "ارسال شده" },
            { id: "delivered", label: "تحویل داده شده" },
            { id: "cancelled", label: "لغو شده" },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-full border px-4 py-2 text-sm font-bold transition ${
                filter === f.id
                  ? "border-[#39FF14] bg-[#39FF14] text-black"
                  : "border-[#39FF14]/20 text-gray-300 hover:border-[#39FF14]/60"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* لیست */}
      {items.length === 0 ? (
        <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-12 text-center">
          <div className="mb-4 text-6xl">📦</div>
          <p className="mb-2 text-lg font-bold text-white">
            هنوز سفارشی نداری
          </p>
          <p className="text-sm text-gray-400">
            وقتی مشتری از محصولات تو خرید کنه، اینجا نمایش داده می‌شه
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-12 text-center text-gray-400">
          سفارشی با این فیلتر پیدا نشد
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const order = item.orders;
            if (!order) return null;
            const config = statusConfig[order.status] || statusConfig.pending;
            const isUpdating = updatingOrderId === order.id;
            const canChangeStatus = !["delivered", "cancelled"].includes(
              order.status
            );

            return (
              <div
                key={item.id}
                className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-5"
              >
                {/* سر */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <Link
                    href={`/orders/${order.id}`}
                    className="text-sm font-bold text-[#39FF14] transition hover:underline"
                  >
                    سفارش #{order.id.toLocaleString("fa-IR")}
                  </Link>
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-bold ${config.color}`}
                  >
                    {config.icon} {config.label}
                  </span>
                </div>

                {/* محصول */}
                <div className="rounded-xl border border-[#39FF14]/10 bg-neutral-950/40 p-4">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-white">
                        {item.product_name}
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        {item.quantity.toLocaleString("fa-IR")} عدد ×{" "}
                        {formatToman(item.product_price)}
                      </p>
                    </div>
                    <p className="shrink-0 font-bold text-[#39FF14]">
                      {formatToman(item.product_price * item.quantity)}
                    </p>
                  </div>
                </div>

                {/* اطلاعات مشتری */}
                {order.shipping_address && (
                  <div className="mt-3 grid gap-2 text-xs text-gray-400 sm:grid-cols-2">
                    <p>
                      👤 مشتری:{" "}
                      <span className="text-gray-200">
                        {order.shipping_address.full_name}
                      </span>
                    </p>
                    <p dir="ltr" className="sm:text-right">
                      📱{" "}
                      <a
                        href={`tel:${order.shipping_address.mobile}`}
                        className="text-[#39FF14] hover:underline"
                      >
                        {order.shipping_address.mobile}
                      </a>
                    </p>
                    <p className="sm:col-span-2">
                      📍 آدرس:{" "}
                      <span className="text-gray-200">
                        {buildAddress(order.shipping_address)}
                      </span>
                    </p>
                  </div>
                )}

                {/* تاریخ */}
                <p className="mt-3 border-t border-[#39FF14]/10 pt-3 text-xs text-gray-500">
                  📅 {formatDate(order.created_at)}
                </p>

                {/* دکمه‌های تغییر وضعیت */}
                {canChangeStatus && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-[#39FF14]/10 pt-4">
                    {order.status === "pending" && (
                      <button
                        type="button"
                        onClick={() =>
                          handleStatusChange(order.id, "processing")
                        }
                        disabled={isUpdating}
                        className="rounded-lg bg-blue-500/20 px-4 py-2 text-xs font-bold text-blue-400 transition hover:bg-blue-500/30 disabled:opacity-50"
                      >
                        ⚙️ شروع پردازش
                      </button>
                    )}

                    {(order.status === "paid" ||
                      order.status === "processing") && (
                      <button
                        type="button"
                        onClick={() => handleStatusChange(order.id, "shipped")}
                        disabled={isUpdating}
                        className="rounded-lg bg-purple-500/20 px-4 py-2 text-xs font-bold text-purple-400 transition hover:bg-purple-500/30 disabled:opacity-50"
                      >
                        🚚 ارسال شد
                      </button>
                    )}

                    {order.status === "shipped" && (
                      <button
                        type="button"
                        onClick={() =>
                          handleStatusChange(order.id, "delivered")
                        }
                        disabled={isUpdating}
                        className="rounded-lg bg-[#39FF14]/20 px-4 py-2 text-xs font-bold text-[#39FF14] transition hover:bg-[#39FF14]/30 disabled:opacity-50"
                      >
                        ✅ تحویل داده شد
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleStatusChange(order.id, "cancelled")}
                      disabled={isUpdating}
                      className="rounded-lg border border-red-500/40 px-4 py-2 text-xs font-bold text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
                    >
                      ❌ لغو
                    </button>
                  </div>
                )}

                {isUpdating && (
                  <p className="mt-2 text-center text-xs text-gray-500">
                    در حال به‌روزرسانی...
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}