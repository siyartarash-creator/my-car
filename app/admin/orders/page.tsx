import { requirePermission } from "@/lib/auth-server";

type Row = {
  id: number;
  status: string;
  final_price: number;
  payment_status: string | null;
  shipping_address: { full_name?: string; city?: string } | null;
  created_at: string;
};

const STATUSES = ["pending", "paid", "processing", "shipped", "delivered", "cancelled"] as const;
const STATUS_LABEL: Record<string, string> = {
  pending: "در انتظار پرداخت",
  paid: "پرداخت‌شده",
  processing: "در حال آماده‌سازی",
  shipped: "ارسال‌شده",
  delivered: "تحویل‌شده",
  cancelled: "لغوشده",
};

// Store Admin: read-only order inspection (orders.read). No write path --
// order/fulfillment state changes go through their own existing RPCs
// (advance_fulfillment, cancel_order), untouched by this page.
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { client } = await requirePermission("orders.read");
  const { status } = await searchParams;

  let query = client
    .from("orders")
    .select("id,status,final_price,payment_status,shipping_address,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (status && (STATUSES as readonly string[]).includes(status)) {
    query = query.eq("status", status);
  }
  const { data, error } = await query;
  const rows = (data ?? []) as Row[];

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold md:text-3xl">
          مشاهده <span className="text-[#39FF14]">سفارش‌ها</span>
        </h2>
        <p className="mt-1 text-sm text-gray-400">فقط نمایش — تغییر وضعیت از این صفحه انجام نمی‌شود.</p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <a
          href="/admin/orders"
          className={`rounded-full border px-4 py-2 text-sm font-bold transition ${
            !status ? "border-[#39FF14] bg-[#39FF14] text-black" : "border-[#39FF14]/20 text-gray-300 hover:border-[#39FF14]/60"
          }`}
        >
          همه
        </a>
        {STATUSES.map((s) => (
          <a
            key={s}
            href={`/admin/orders?status=${s}`}
            className={`rounded-full border px-4 py-2 text-sm font-bold transition ${
              status === s ? "border-[#39FF14] bg-[#39FF14] text-black" : "border-[#39FF14]/20 text-gray-300 hover:border-[#39FF14]/60"
            }`}
          >
            {STATUS_LABEL[s]}
          </a>
        ))}
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-center text-red-400">
          خطا: {error.message}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-12 text-center text-gray-400">
          سفارشی پیدا نشد.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#39FF14]/20 bg-neutral-900/60 p-4">
              <div>
                <p className="font-bold text-white">سفارش #{o.id.toLocaleString("fa-IR")}</p>
                <p className="mt-1 text-xs text-gray-400">
                  {o.shipping_address?.full_name ?? "—"} · {o.shipping_address?.city ?? "—"}
                </p>
              </div>
              <div className="text-left">
                <p className="text-sm font-bold text-[#39FF14]">{o.final_price.toLocaleString("fa-IR")} تومان</p>
                <p className="mt-1 text-xs text-gray-400">{STATUS_LABEL[o.status] ?? o.status}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
