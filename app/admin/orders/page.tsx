import Link from "next/link";
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
const PAGE_SIZE = 50;

function pageHref(status: string | undefined, page: number): string {
  const qp = new URLSearchParams();
  if (status) qp.set("status", status);
  if (page > 1) qp.set("page", String(page));
  const qs = qp.toString();
  return qs ? `/admin/orders?${qs}` : "/admin/orders";
}

// Store Admin: read-only order inspection (orders.read). No write path --
// order/fulfillment state changes go through their own existing RPCs
// (advance_fulfillment, cancel_order), untouched by this page.
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { client } = await requirePermission("orders.read");
  const { status, page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = client
    .from("orders")
    .select("id,status,final_price,payment_status,shipping_address,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    // created_at alone is not unique; a secondary order on id (unique,
    // stable) keeps rows from shifting or repeating across pages.
    .order("id", { ascending: false })
    .range(from, to);
  if (status && (STATUSES as readonly string[]).includes(status)) {
    query = query.eq("status", status);
  }
  const { data, error, count } = await query;
  const rows = (data ?? []) as Row[];
  const totalPages = count != null ? Math.max(1, Math.ceil(count / PAGE_SIZE)) : page;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold md:text-3xl">
          مشاهده <span className="text-[#39FF14]">سفارش‌ها</span>
        </h2>
        <p className="mt-1 text-sm text-gray-400">فقط نمایش — تغییر وضعیت از این صفحه انجام نمی‌شود.</p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          href="/admin/orders"
          className={`rounded-full border px-4 py-2 text-sm font-bold transition ${
            !status ? "border-[#39FF14] bg-[#39FF14] text-black" : "border-[#39FF14]/20 text-gray-300 hover:border-[#39FF14]/60"
          }`}
        >
          همه
        </Link>
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
        <>
          <div className="space-y-2">
            {rows.map((o) => (
              <Link
                key={o.id}
                href={`/admin/orders/${o.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#39FF14]/20 bg-neutral-900/60 p-4 transition hover:border-[#39FF14]/60"
              >
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
              </Link>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between gap-3">
              {page > 1 ? (
                <a href={pageHref(status, page - 1)} className="rounded-full border border-[#39FF14]/30 px-4 py-2 text-sm text-[#39FF14] transition hover:bg-[#39FF14]/10">
                  قبلی
                </a>
              ) : (
                <span />
              )}
              <p className="text-xs text-gray-400">
                صفحه {page.toLocaleString("fa-IR")} از {totalPages.toLocaleString("fa-IR")}
              </p>
              {page < totalPages ? (
                <a href={pageHref(status, page + 1)} className="rounded-full border border-[#39FF14]/30 px-4 py-2 text-sm text-[#39FF14] transition hover:bg-[#39FF14]/10">
                  بعدی
                </a>
              ) : (
                <span />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
