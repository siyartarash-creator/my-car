import { requirePermission } from "@/lib/auth-server";
import { OfferModerationActions } from "./offer-moderation-actions";

type Row = {
  id: number;
  seller_name: string;
  price: number;
  discount_price: number | null;
  stock: number;
  is_active: boolean;
  products: { name: string } | null;
};

// Store Admin: Offer moderation (activate/deactivate only -- locked rules,
// section 8). Moderation never touches price/stock/discount/request state;
// seller cannot control is_active at all (save_offer takes no such
// parameter). Deactivation requires a meaningful reason, enforced server-
// side by deactivate_offer itself.
export default async function AdminOffersPage() {
  const { client } = await requirePermission("offers.moderate");
  const { data, error } = await client
    .from("product_sellers")
    .select("id,seller_name,price,discount_price,stock,is_active,products(name)")
    .order("is_active", { ascending: true })
    .order("id", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as unknown as Row[];

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold md:text-3xl">
          مدیریت <span className="text-[#39FF14]">آگهی‌های فروشنده</span>
        </h2>
        <p className="mt-1 text-sm text-gray-400">فعال/غیرفعال‌سازی آگهی‌ها. قیمت، موجودی و تخفیف از این صفحه قابل تغییر نیست.</p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-center text-red-400">
          خطا: {error.message}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-12 text-center text-gray-400">
          آگهی‌ای پیدا نشد.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-white">{r.products?.name ?? `محصول`}</p>
                  <p className="mt-1 text-xs text-gray-400">فروشنده: {r.seller_name}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    قیمت: {r.price.toLocaleString("fa-IR")} تومان
                    {r.discount_price ? ` · تخفیف: ${r.discount_price.toLocaleString("fa-IR")} تومان` : ""} · موجودی:{" "}
                    {r.stock.toLocaleString("fa-IR")}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-3 py-1 text-xs ${
                    r.is_active ? "border-[#39FF14]/40 text-[#39FF14]" : "border-red-500/40 text-red-400"
                  }`}
                >
                  {r.is_active ? "فعال" : "غیرفعال"}
                </span>
              </div>
              <OfferModerationActions offerId={r.id} isActive={r.is_active} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
