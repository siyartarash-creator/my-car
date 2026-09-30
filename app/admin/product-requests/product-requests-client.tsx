"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Request = {
  id: number;
  product_name: string;
  brand: string | null;
  photo_url: string | null;
  status: "pending" | "contacted" | "approved" | "rejected";
  admin_notes: string | null;
  seller_id: string;
  seller_name: string | null;
  seller_mobile: string | null;
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

export default function ProductRequestsClient() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | Request["status"]>("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editStatus, setEditStatus] = useState<Request["status"]>("pending");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("product_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) {
      setRequests(data as Request[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    // `load` is intentionally shared with handleSave below (re-fetch after a
    // review decision) -- inlining a separate copy here just for the mount
    // effect would duplicate that fetch logic.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount, not derived state
    load();
  }, []);

  const handleEdit = (r: Request) => {
    setEditingId(r.id);
    // "pending" is the initial state only; review_product_request only
    // accepts a decided status (contacted/approved/rejected).
    setEditStatus(r.status === "pending" ? "contacted" : r.status);
    setEditNotes(r.admin_notes || "");
  };

  const handleSave = async () => {
    if (editingId === null) return;
    setSaving(true);

    const { error } = await supabase.rpc("review_product_request", {
      p_request_id: editingId,
      p_status: editStatus,
      p_admin_notes: editNotes.trim() || null,
    });

    if (error) {
      alert(`خطا: ${error.message}`);
      setSaving(false);
      return;
    }

    setSaving(false);
    setEditingId(null);
    await load();
  };

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

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-gray-400">
        در حال بارگذاری...
      </div>
    );
  }

  const filtered =
    filter === "all" ? requests : requests.filter((r) => r.status === filter);

  const counts = {
    all: requests.length,
    pending: requests.filter((r) => r.status === "pending").length,
    contacted: requests.filter((r) => r.status === "contacted").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold md:text-3xl">
          درخواست‌های <span className="text-[#39FF14]">قطعه جدید</span>
        </h2>
        <p className="mt-2 text-sm text-gray-400">
          درخواست‌هایی که فروشنده‌ها برای اضافه کردن قطعه جدید فرستادن
        </p>
      </div>

      {/* آمار */}
      {requests.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl border border-[#39FF14]/20 bg-neutral-900/60 p-4">
            <p className="text-xs text-gray-400">کل درخواست‌ها</p>
            <p className="mt-1 text-2xl font-bold text-[#39FF14]">
              {counts.all.toLocaleString("fa-IR")}
            </p>
          </div>
          <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
            <p className="text-xs text-gray-400">در انتظار</p>
            <p className="mt-1 text-2xl font-bold text-yellow-400">
              {counts.pending.toLocaleString("fa-IR")}
            </p>
          </div>
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
            <p className="text-xs text-gray-400">در حال پیگیری</p>
            <p className="mt-1 text-2xl font-bold text-blue-400">
              {counts.contacted.toLocaleString("fa-IR")}
            </p>
          </div>
          <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
            <p className="text-xs text-gray-400">تایید شده</p>
            <p className="mt-1 text-2xl font-bold text-green-400">
              {counts.approved.toLocaleString("fa-IR")}
            </p>
          </div>
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
            <p className="text-xs text-gray-400">رد شده</p>
            <p className="mt-1 text-2xl font-bold text-red-400">
              {counts.rejected.toLocaleString("fa-IR")}
            </p>
          </div>
        </div>
      )}

      {/* فیلتر */}
      {requests.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {[
            { id: "all", label: "همه", count: counts.all },
            { id: "pending", label: "در انتظار", count: counts.pending },
            { id: "contacted", label: "در حال پیگیری", count: counts.contacted },
            { id: "approved", label: "تایید شده", count: counts.approved },
            { id: "rejected", label: "رد شده", count: counts.rejected },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id as typeof filter)}
              className={`rounded-full border px-4 py-2 text-sm font-bold transition ${
                filter === f.id
                  ? "border-[#39FF14] bg-[#39FF14] text-black"
                  : "border-[#39FF14]/20 text-gray-300 hover:border-[#39FF14]/60"
              }`}
            >
              {f.label} ({f.count.toLocaleString("fa-IR")})
            </button>
          ))}
        </div>
      )}

      {/* لیست */}
      {requests.length === 0 ? (
        <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-12 text-center">
          <div className="mb-4 text-6xl">📨</div>
          <p className="text-lg font-bold text-white">هنوز درخواستی نیومده</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-12 text-center text-gray-400">
          درخواستی با این فیلتر پیدا نشد
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const config = statusConfig[r.status];
            const isEditing = editingId === r.id;

            return (
              <div
                key={r.id}
                className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-4"
              >
                <div className="flex flex-wrap items-start gap-4">
                  {/* عکس */}
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#39FF14]/20 bg-neutral-950 text-2xl">
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
                    <h3 className="text-lg font-bold text-white">
                      {r.product_name}
                    </h3>
                    <p className="mt-1 text-xs text-gray-400">
                      {r.brand ? `برند: ${r.brand}` : "بدون برند"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-400">
                      <span>
                        👤 فروشنده:{" "}
                        <span className="text-gray-200">
                          {r.seller_name || "—"}
                        </span>
                      </span>
                      {r.seller_mobile && (
                        <span dir="ltr">
                          📱{" "}
                          <a
                            href={`tel:${r.seller_mobile}`}
                            className="text-[#39FF14] hover:underline"
                          >
                            {r.seller_mobile}
                          </a>
                        </span>
                      )}
                      <span>📅 {formatDate(r.created_at)}</span>
                    </div>
                  </div>

                  {/* وضعیت */}
                  <span
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold ${config.color}`}
                  >
                    {config.icon} {config.label}
                  </span>
                </div>

                {/* یادداشت ادمین */}
                {r.admin_notes && !isEditing && (
                  <div className="mt-3 rounded-lg border border-[#39FF14]/20 bg-neutral-950/50 p-3">
                    <p className="text-xs font-bold text-[#39FF14]">
                      📝 یادداشت:
                    </p>
                    <p className="mt-1 text-xs text-gray-300">{r.admin_notes}</p>
                  </div>
                )}

                {/* فرم ویرایش */}
                {isEditing ? (
                  <div className="mt-4 space-y-3 rounded-lg border border-[#39FF14]/40 bg-neutral-950/70 p-4">
                    <div>
                      <label className="mb-2 block text-sm font-bold text-gray-300">
                        تغییر وضعیت
                      </label>
                      <select
                        value={editStatus}
                        onChange={(e) =>
                          setEditStatus(e.target.value as Request["status"])
                        }
                        className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-900 px-4 py-2.5 text-white outline-none focus:border-[#39FF14]"
                      >
                        <option value="contacted">📞 در حال پیگیری</option>
                        <option value="approved">✅ تایید شد</option>
                        <option value="rejected">❌ رد شد</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-bold text-gray-300">
                        یادداشت (برای فروشنده)
                      </label>
                      <textarea
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        rows={3}
                        placeholder="مثلاً: با فروشنده تماس گرفته شد، در انتظار ارسال مدارک"
                        className="w-full resize-none rounded-lg border border-[#39FF14]/20 bg-neutral-900 px-4 py-2.5 text-white outline-none placeholder:text-gray-600 focus:border-[#39FF14]"
                      />
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="rounded-lg bg-[#39FF14] px-6 py-2 text-sm font-bold text-black transition hover:bg-[#39FF14]/90 disabled:opacity-50"
                      >
                        {saving ? "در حال ذخیره..." : "💾 ذخیره"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-lg border border-gray-500/40 px-6 py-2 text-sm font-bold text-gray-400 transition hover:bg-gray-500/10"
                      >
                        انصراف
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleEdit(r)}
                    className="mt-3 rounded-lg border border-[#39FF14]/40 px-4 py-2 text-xs font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10"
                  >
                    ✏️ تغییر وضعیت و یادداشت
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}