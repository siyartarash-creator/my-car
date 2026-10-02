import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth-server";

type Order = {
  id: number;
  user_id: string;
  status: string;
  total_price: number;
  shipping_cost: number;
  final_price: number;
  shipping_address: {
    full_name?: string;
    mobile?: string;
    province?: string;
    city?: string;
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
  seller_id: string | null;
  offer_id: number | null;
};

type Fulfillment = {
  id: number;
  seller_id: string;
  status: string;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "در انتظار پرداخت",
  paid: "پرداخت‌شده",
  processing: "در حال آماده‌سازی",
  shipped: "ارسال‌شده",
  delivered: "تحویل‌شده",
  cancelled: "لغوشده",
};

function formatToman(amount: number): string {
  return `${amount.toLocaleString("fa-IR")} تومان`;
}

// Store Admin: read-only order + line-item inspection (orders.read). No write
// path -- order/fulfillment state changes go through their own existing RPCs
// (advance_fulfillment, cancel_order), untouched by this page. order_items
// visibility comes entirely from the existing item_orders_read RLS policy
// (supabase/migrations/202610020001_admin_order_item_read.sql); this page
// adds no new grant and no new table access.
export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { client } = await requirePermission("orders.read");
  const { id } = await params;

  if (!/^\d+$/.test(id)) notFound();

  const { data: order, error: orderError } = await client
    .from("orders")
    .select("id,user_id,status,total_price,shipping_cost,final_price,shipping_address,payment_method,payment_status,created_at")
    .eq("id", id)
    .single();

  if (orderError || !order) notFound();
  const row = order as Order;

  const [{ data: itemsData }, { data: fulfillmentsData }] = await Promise.all([
    client
      .from("order_items")
      .select("id,product_id,product_name,product_price,quantity,seller_id,offer_id")
      .eq("order_id", row.id)
      .order("id", { ascending: true }),
    client.from("seller_fulfillments").select("id,seller_id,status").eq("order_id", row.id),
  ]);

  const items = (itemsData ?? []) as OrderItem[];
  const fulfillments = (fulfillmentsData ?? []) as Fulfillment[];

  // Best-effort seller display name, same reuse as the buyer-facing order
  // page: offer_id already stored on each line, resolved via the existing
  // public offer read -- no new permission involved.
  const offerIds = [...new Set(items.map((i) => i.offer_id).filter((v): v is number => v != null))];
  const sellerNames: Record<string, string> = {};
  if (offerIds.length > 0) {
    const { data: offersData } = await client
      .from("product_sellers")
      .select("id,seller_id,seller_name")
      .in("id", offerIds);
    for (const o of (offersData ?? []) as { id: number; seller_id: string | null; seller_name: string }[]) {
      if (o.seller_id && !sellerNames[o.seller_id]) sellerNames[o.seller_id] = o.seller_name;
    }
  }

  const distinctSellerIds = [...new Set(items.map((i) => i.seller_id).filter((v): v is string => v != null))];
  const isMultiSeller = distinctSellerIds.length > 1;
  const sellerGroups = isMultiSeller
    ? distinctSellerIds.map((sellerId, idx) => ({
        sellerId,
        items: items.filter((i) => i.seller_id === sellerId),
        label: sellerNames[sellerId] || `بخش فروشنده ${(idx + 1).toLocaleString("fa-IR")}`,
        fulfillment: fulfillments.find((f) => f.seller_id === sellerId) ?? null,
      }))
    : [];
  const unassignedItems = isMultiSeller ? items.filter((i) => i.seller_id == null) : [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold md:text-3xl">
          سفارش <span className="text-[#39FF14]">#{row.id.toLocaleString("fa-IR")}</span>
        </h2>
        <Link href="/admin/orders" className="rounded-full border border-[#39FF14]/30 px-4 py-2 text-sm text-[#39FF14] transition hover:bg-[#39FF14]/10">
          بازگشت به سفارش‌ها
        </Link>
      </div>
      <p className="mb-6 text-sm text-gray-400">فقط نمایش — تغییر وضعیت از این صفحه انجام نمی‌شود.</p>

      <div className="space-y-6">
        <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs text-gray-400">وضعیت سفارش</p>
              <p className="mt-1 text-lg font-bold text-[#39FF14]">{STATUS_LABEL[row.status] ?? row.status}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">وضعیت پرداخت</p>
              <p className="mt-1 text-sm text-gray-200">{row.payment_status ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">روش پرداخت</p>
              <p className="mt-1 text-sm text-gray-200">{row.payment_method ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">تاریخ ثبت</p>
              <p className="mt-1 text-sm text-gray-200">{new Date(row.created_at).toLocaleString("fa-IR")}</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6">
          <h3 className="mb-4 text-lg font-bold text-[#39FF14]">📦 اقلام سفارش</h3>
          {items.length === 0 ? (
            <p className="text-sm text-gray-400">هیچ قلمی برای این سفارش قابل مشاهده نیست.</p>
          ) : isMultiSeller ? (
            <div className="space-y-5">
              {sellerGroups.map((group) => (
                <div key={group.sellerId} className="rounded-xl border border-[#39FF14]/10 bg-neutral-950/40 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold text-gray-200">🏪 {group.label}</p>
                    {group.fulfillment && (
                      <span className="rounded-full border border-[#39FF14]/30 px-3 py-1 text-xs font-bold text-[#39FF14]">
                        {STATUS_LABEL[group.fulfillment.status] ?? group.fulfillment.status}
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {group.items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between border-b border-[#39FF14]/10 pb-2 last:border-0 last:pb-0">
                        <div>
                          <p className="font-bold text-white">{item.product_name}</p>
                          <p className="mt-1 text-xs text-gray-400">
                            {item.quantity.toLocaleString("fa-IR")} عدد × {formatToman(item.product_price)}
                          </p>
                        </div>
                        <p className="font-bold text-[#39FF14]">{formatToman(item.product_price * item.quantity)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {unassignedItems.length > 0 && (
                <div className="rounded-xl border border-[#39FF14]/10 bg-neutral-950/40 p-4">
                  <p className="mb-3 text-sm font-bold text-gray-200">📦 سایر اقلام</p>
                  <div className="space-y-2">
                    {unassignedItems.map((item) => (
                      <div key={item.id} className="flex items-center justify-between border-b border-[#39FF14]/10 pb-2 last:border-0 last:pb-0">
                        <div>
                          <p className="font-bold text-white">{item.product_name}</p>
                          <p className="mt-1 text-xs text-gray-400">
                            {item.quantity.toLocaleString("fa-IR")} عدد × {formatToman(item.product_price)}
                          </p>
                        </div>
                        <p className="font-bold text-[#39FF14]">{formatToman(item.product_price * item.quantity)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className="flex items-center justify-between border-b border-[#39FF14]/10 pb-2 last:border-0 last:pb-0">
                  <div>
                    <p className="font-bold text-white">{item.product_name}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      {item.quantity.toLocaleString("fa-IR")} عدد × {formatToman(item.product_price)}
                    </p>
                  </div>
                  <p className="font-bold text-[#39FF14]">{formatToman(item.product_price * item.quantity)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {row.shipping_address && (
          <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6">
            <h3 className="mb-4 text-lg font-bold text-[#39FF14]">📍 آدرس ارسال</h3>
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-gray-400">نام: </span>
                <span className="text-white">{row.shipping_address.full_name ?? "—"}</span>
              </p>
              <p>
                <span className="text-gray-400">موبایل: </span>
                <span className="text-white" dir="ltr">{row.shipping_address.mobile ?? "—"}</span>
              </p>
              <p>
                <span className="text-gray-400">آدرس: </span>
                <span className="text-white">
                  {row.shipping_address.province ?? "—"}، {row.shipping_address.city ?? "—"}
                  {row.shipping_address.region && `، ${row.shipping_address.region}`}
                  {row.shipping_address.street && `، ${row.shipping_address.street}`}
                  {row.shipping_address.alley && `، ${row.shipping_address.alley}`}
                </span>
              </p>
              {row.shipping_address.postal_code && (
                <p>
                  <span className="text-gray-400">کد پستی: </span>
                  <span className="text-white" dir="ltr">{row.shipping_address.postal_code}</span>
                </p>
              )}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-[#39FF14]/30 bg-neutral-900/60 p-6">
          <h3 className="mb-4 text-lg font-bold text-[#39FF14]">💰 خلاصه مالی</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">جمع کالاها</span>
              <span className="text-white">{formatToman(row.total_price)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">هزینه ارسال</span>
              <span className="text-white">{formatToman(row.shipping_cost)}</span>
            </div>
            <div className="flex justify-between border-t border-[#39FF14]/20 pt-3">
              <span className="font-bold text-gray-300">مبلغ نهایی</span>
              <span className="text-lg font-bold text-[#39FF14]">{formatToman(row.final_price)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
