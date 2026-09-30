import Link from "next/link";
import { requireAdminAccess } from "@/lib/auth-server";
import { canSeeWidget } from "@/lib/admin/dashboard";

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "در انتظار پرداخت",
  paid: "پرداخت‌شده",
  processing: "در حال آماده‌سازی",
  shipped: "ارسال‌شده",
  delivered: "تحویل‌شده",
  cancelled: "لغوشده",
};
const DISCOUNT_STATUS_LABEL: Record<string, string> = {
  pending: "در انتظار تایید",
  approved: "تایید شده",
  rejected: "رد شده",
  superseded: "جایگزین شده",
};
const REQUEST_STATUS_LABEL: Record<string, string> = {
  pending: "در انتظار بررسی",
  contacted: "در حال پیگیری",
  approved: "تایید شده",
  rejected: "رد شده",
};

function countBy<T extends string>(rows: { status: T }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

function StatTile({ label, value, icon, href }: { label: string; value: number; icon: string; href: string }) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6 transition hover:border-[#39FF14]/70 hover:shadow-[0_0_25px_rgba(57,255,20,0.15)]"
    >
      <div className="relative">
        <div className="mb-3 text-4xl">{icon}</div>
        <p className="text-3xl font-bold text-[#39FF14]">{value.toLocaleString("fa-IR")}</p>
        <p className="mt-1 text-sm text-gray-400">{label}</p>
      </div>
    </Link>
  );
}

function BreakdownCard({
  title,
  counts,
  labels,
  href,
}: {
  title: string;
  counts: Record<string, number>;
  labels: Record<string, string>;
  href: string;
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <Link href={href} className="block rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-5 transition hover:border-[#39FF14]/50">
      <p className="mb-3 text-sm font-bold text-white">{title}</p>
      {total === 0 ? (
        <p className="text-xs text-gray-500">داده‌ای وجود ندارد</p>
      ) : (
        <div className="space-y-2">
          {Object.entries(labels).map(([key, label]) => {
            const n = counts[key] ?? 0;
            if (n === 0) return null;
            const pct = Math.round((n / total) * 100);
            return (
              <div key={key} className="text-xs">
                <div className="mb-1 flex justify-between text-gray-400">
                  <span>{label}</span>
                  <span>{n.toLocaleString("fa-IR")}</span>
                </div>
                <div className="h-1.5 rounded-full bg-neutral-800">
                  <div className="h-1.5 rounded-full bg-[#39FF14]" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Link>
  );
}

// Admin Panel Completion, Checkpoint C: dashboard widgets driven by
// lib/admin/dashboard.ts's registry. Every metric here is read from an
// authoritative column/table (see comments per widget) -- no invented
// profit/commission/payout/settlement/margin/balance figures, per the
// locked decision (none of those have an authoritative model in this
// schema yet).
export default async function AdminDashboard() {
  const { client, isAdmin, granted } = await requireAdminAccess();
  const viewer = { isAdmin, granted };

  const showOffer = canSeeWidget("offerActiveBreakdown", viewer);
  const showOrders = canSeeWidget("orderCount", viewer);
  const showDiscounts = canSeeWidget("discountRequestStatus", viewer);
  const showRequests = canSeeWidget("productRequestStatus", viewer);
  const showCoupons = canSeeWidget("couponUsage", viewer);

  const [productsRes, offersRes, orderCountRes, ordersRows, discountRows, requestRows, couponsRes] = await Promise.all([
    client.from("products").select("id", { count: "exact", head: true }),
    client.from("product_sellers").select("id,seller_id,is_active"),
    showOrders ? client.from("orders").select("id", { count: "exact", head: true }) : Promise.resolve({ count: 0 }),
    // Value/status-breakdown/7-day-trend are computed from the most recent
    // 2000 orders (cost control at this schema's row scale); the exact
    // total order count above is a separate head-count query, never capped.
    showOrders
      ? client.from("orders").select("status,final_price,created_at").order("created_at", { ascending: false }).limit(2000)
      : Promise.resolve({ data: [] as { status: string; final_price: number; created_at: string }[] }),
    showDiscounts ? client.from("discount_requests").select("status") : Promise.resolve({ data: [] as { status: string }[] }),
    showRequests ? client.from("product_requests").select("status") : Promise.resolve({ data: [] as { status: string }[] }),
    // coupon.used_count is the authoritative running counter maintained by
    // the checkout path itself (place_order) -- summing it is exact and
    // needs no new coupon_usages read-policy widening.
    showCoupons ? client.from("coupons").select("used_count") : Promise.resolve({ data: [] as { used_count: number }[] }),
  ]);

  const offers = offersRes.data ?? [];
  const offerActive = offers.filter((o) => o.is_active).length;
  const offerInactive = offers.length - offerActive;
  const sellerCount = new Set(offers.map((o) => o.seller_id)).size;

  const orders = ordersRows.data ?? [];
  const orderValueTotal = orders.reduce((sum, o) => sum + o.final_price, 0);
  const orderStatusCounts = countBy(orders);

  const now = new Date();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
  const perDay = new Map(days.map((d) => [d, { count: 0, value: 0 }]));
  for (const o of orders) {
    const day = o.created_at.slice(0, 10);
    const bucket = perDay.get(day);
    if (bucket) {
      bucket.count += 1;
      bucket.value += o.final_price;
    }
  }

  const discountCounts = countBy(discountRows.data ?? []);
  const requestCounts = countBy(requestRows.data ?? []);
  const couponUsageTotal = (couponsRes.data ?? []).reduce((sum, c) => sum + (c.used_count ?? 0), 0);

  return (
    <div>
      <h2 className="mb-2 text-2xl font-bold md:text-3xl">
        داشبورد <span className="text-[#39FF14]">ادمین</span>
      </h2>
      <p className="mb-8 text-gray-400">خلاصه وضعیت فروشگاه</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="محصولات" value={productsRes.count ?? 0} icon="📦" href="/admin/products" />
        <StatTile label="آگهی‌ها (کل)" value={offers.length} icon="🛒" href="/admin/offers" />
        {showOffer ? <StatTile label="فروشنده‌های فعال" value={sellerCount} icon="🏪" href="/admin/offers" /> : null}
        {showOrders ? <StatTile label="سفارش‌ها" value={orderCountRes.count ?? 0} icon="🛍️" href="/admin/orders" /> : null}
      </div>

      {showOrders ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <StatTile label="ارزش کل سفارش‌ها (تومان)" value={orderValueTotal} icon="💰" href="/admin/orders" />
          <StatTile label="سفارش‌های ۷ روز اخیر" value={days.reduce((s, d) => s + (perDay.get(d)?.count ?? 0), 0)} icon="📅" href="/admin/orders" />
        </div>
      ) : null}
      {showOrders && (orderCountRes.count ?? 0) > orders.length ? (
        <p className="mt-2 text-xs text-yellow-500">
          ⚠️ ارزش کل و نمودارها بر اساس {orders.length.toLocaleString("fa-IR")} سفارش اخیر محاسبه شده‌اند، نه کل{" "}
          {(orderCountRes.count ?? 0).toLocaleString("fa-IR")} سفارش.
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {showOffer ? (
          <BreakdownCard
            title="وضعیت آگهی‌ها"
            counts={{ active: offerActive, inactive: offerInactive }}
            labels={{ active: "فعال", inactive: "غیرفعال" }}
            href="/admin/offers"
          />
        ) : null}
        {showOrders ? <BreakdownCard title="وضعیت سفارش‌ها" counts={orderStatusCounts} labels={ORDER_STATUS_LABEL} href="/admin/orders" /> : null}
        {showDiscounts ? (
          <BreakdownCard title="وضعیت درخواست‌های تخفیف" counts={discountCounts} labels={DISCOUNT_STATUS_LABEL} href="/admin/discount-requests" />
        ) : null}
        {showRequests ? (
          <BreakdownCard title="وضعیت درخواست‌های محصول" counts={requestCounts} labels={REQUEST_STATUS_LABEL} href="/admin/product-requests" />
        ) : null}
        {showCoupons ? <StatTile label="تعداد استفاده از کدهای تخفیف" value={couponUsageTotal} icon="🏷️" href="/admin/coupons" /> : null}
      </div>

      {showOrders ? (
        <div className="mt-6 rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-5">
          <p className="mb-4 text-sm font-bold text-white">سفارش‌ها در ۷ روز اخیر</p>
          <div className="space-y-2">
            {days.map((d) => {
              const bucket = perDay.get(d) ?? { count: 0, value: 0 };
              const max = Math.max(1, ...days.map((x) => perDay.get(x)?.count ?? 0));
              const pct = Math.round((bucket.count / max) * 100);
              return (
                <div key={d} className="flex items-center gap-3 text-xs">
                  <span className="w-20 shrink-0 text-gray-400">{new Date(d).toLocaleDateString("fa-IR")}</span>
                  <div className="h-2 flex-1 rounded-full bg-neutral-800">
                    <div className="h-2 rounded-full bg-[#39FF14]" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-10 shrink-0 text-left text-gray-300">{bucket.count.toLocaleString("fa-IR")}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="mt-8 rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6">
        <h3 className="mb-4 text-lg font-bold text-[#39FF14]">دسترسی سریع</h3>
        <div className="flex flex-wrap gap-3">
          <Link href="/admin/products/new" className="rounded-lg bg-[#39FF14] px-5 py-2.5 text-sm font-bold text-black transition hover:bg-[#39FF14]/90">
            ➕ افزودن محصول جدید
          </Link>
          <Link href="/admin/products" className="rounded-lg border border-[#39FF14]/40 px-5 py-2.5 text-sm font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10">
            📦 مدیریت محصولات
          </Link>
          {isAdmin ? (
            <Link href="/admin/audit" className="rounded-lg border border-[#39FF14]/40 px-5 py-2.5 text-sm font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10">
              🧾 گزارش عملیات ادمین
            </Link>
          ) : null}
          <Link href="/shop" className="rounded-lg border border-[#39FF14]/40 px-5 py-2.5 text-sm font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10">
            🛒 دیدن فروشگاه
          </Link>
        </div>
      </div>
    </div>
  );
}
