import { requirePermission } from "@/lib/auth-server";
import { DiscountRequestActions } from "./discount-request-actions";

type Row = {
  id: number;
  offer_id: number;
  seller_id: string;
  base_price_snapshot: number;
  requested_discount_price: number;
  status: "pending" | "approved" | "rejected" | "superseded";
  created_at: string;
  decided_at: string | null;
  product_sellers: { seller_name: string; products: { name: string } | null } | null;
};

// Store Admin: discount-request approval/rejection (locked rules, section
// 8). <=35% is applied live by save_offer already; this page only ever
// decides requests that save_offer already routed to "pending" for being
// above the marketplace_settings threshold.
export default async function AdminDiscountRequestsPage() {
  const { client } = await requirePermission("discounts.approve");
  const { data, error } = await client
    .from("discount_requests")
    .select(
      "id,offer_id,seller_id,base_price_snapshot,requested_discount_price,status,created_at,decided_at,product_sellers(seller_name,products(name))",
    )
    .order("status", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as unknown as Row[];
  const statusLabel: Record<Row["status"], string> = {
    pending: "در انتظار",
    approved: "تایید شده",
    rejected: "رد شده",
    superseded: "جایگزین شده",
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold md:text-3xl">
          درخواست‌های <span className="text-[#39FF14]">تخفیف بالای سقف</span>
        </h2>
        <p className="mt-1 text-sm text-gray-400">
          تخفیف‌های بالای سقف خودمختاری فروشنده که نیاز به تایید دارند.
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-center text-red-400">
          خطا: {error.message}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-12 text-center text-gray-400">
          درخواست تخفیفی وجود ندارد.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const percent = Math.round(((r.base_price_snapshot - r.requested_discount_price) / r.base_price_snapshot) * 100);
            return (
              <div key={r.id} className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-white">{r.product_sellers?.products?.name ?? `آگهی #${r.offer_id}`}</p>
                    <p className="mt-1 text-xs text-gray-400">فروشنده: {r.product_sellers?.seller_name ?? "—"}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      قیمت پایه: {r.base_price_snapshot.toLocaleString("fa-IR")} تومان · قیمت پیشنهادی:{" "}
                      {r.requested_discount_price.toLocaleString("fa-IR")} تومان ({percent.toLocaleString("fa-IR")}٪ تخفیف)
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-[#39FF14]/30 px-3 py-1 text-xs text-gray-300">
                    {statusLabel[r.status]}
                  </span>
                </div>
                {r.status === "pending" ? <DiscountRequestActions requestId={r.id} /> : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
