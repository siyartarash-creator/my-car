"use client";
import { getCurrentUserId } from "@/lib/auth-client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Request = {
  id: number;
  product_name: string;
  brand: string | null;
  photo_url: string | null;
  status: "pending" | "contacted" | "approved" | "rejected";
  admin_notes: string | null;
  created_at: string;
};

const statusConfig = {
  pending: {
    label: "در انتظار بررسی",
    color: "border-yellow-500/40 bg-yellow-500/10 text-yellow-400",
    icon: "⏳",
  },
  contacted: {
    label: "در حال پیگیری",
    color: "border-blue-500/40 bg-blue-500/10 text-blue-400",
    icon: "📞",
  },
  approved: {
    label: "تایید شد",
    color: "border-[#39FF14]/40 bg-[#39FF14]/10 text-[#39FF14]",
    icon: "✅",
  },
  rejected: {
    label: "رد شد",
    color: "border-red-500/40 bg-red-500/10 text-red-400",
    icon: "❌",
  },
};

export default function SellerRequestsPage() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const userId = await getCurrentUserId();
      if (!userId) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("product_requests")
        .select("id, product_name, brand, photo_url, status, admin_notes, created_at")
        .eq("seller_id", userId)
        .order("created_at", { ascending: false });

      if (!error && data) {
        setRequests(data as Request[]);
      }
      setLoading(false);
    };
    load();
  }, []);

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("fa-IR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return iso;
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-gray-400">
        در حال بارگذاری...
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold md:text-3xl">
            <span className="text-[#39FF14]">درخواست‌های من</span>
          </h2>
          <p className="mt-2 text-sm text-gray-400">
            درخواست‌های قطعه جدید که فرستادی
          </p>
        </div>
        <Link
          href="/seller/requests/new"
          className="rounded-lg bg-[#39FF14] px-5 py-2.5 text-sm font-bold text-black transition hover:bg-[#39FF14]/90"
        >
          ➕ درخواست جدید
        </Link>
      </div>

      {requests.length === 0 ? (
        <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-12 text-center">
          <div className="mb-4 text-6xl">📨</div>
          <p className="mb-2 text-lg font-bold text-white">
            هنوز درخواستی نفرستادی
          </p>
          <p className="mb-6 text-sm text-gray-400">
            اگه قطعه‌ای توی لیست نیست، درخواست بده تا پشتیبانی اضافه کنه
          </p>
          <Link
            href="/seller/requests/new"
            className="inline-block rounded-lg bg-[#39FF14] px-6 py-3 font-bold text-black shadow-[0_0_20px_rgba(57,255,20,0.5)] transition hover:bg-[#39FF14]/90"
          >
            ➕ ارسال درخواست جدید
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => {
            const config = statusConfig[r.status];
            return (
              <div
                key={r.id}
                className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-4"
              >
                <div className="flex flex-wrap items-center gap-4">
                  {/* عکس */}
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#39FF14]/20 bg-neutral-950 text-2xl">
                    {r.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.photo_url}
                        alt={r.product_name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span>📷</span>
                    )}
                  </div>

                  {/* اطلاعات */}
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-white">{r.product_name}</h3>
                    <p className="mt-1 text-xs text-gray-400">
                      {r.brand ? `برند: ${r.brand}` : "بدون برند"} • {formatDate(r.created_at)}
                    </p>
                  </div>

                  {/* وضعیت */}
                  <span
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold ${config.color}`}
                  >
                    {config.icon} {config.label}
                  </span>
                </div>

                {/* یادداشت ادمین */}
                {r.admin_notes && (
                  <div className="mt-3 rounded-lg border border-[#39FF14]/20 bg-neutral-950/50 p-3">
                    <p className="text-xs font-bold text-[#39FF14]">پیام پشتیبانی:</p>
                    <p className="mt-1 text-xs text-gray-300">{r.admin_notes}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}