import Link from "next/link";
import { requireAdminAccess } from "@/lib/auth-server";

export default async function AdminDashboard() {
  const { client: supabase } = await requireAdminAccess();
  const [productsRes, ordersRes, usersRes, sellersRes] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }),
    supabase.from("orders").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("product_sellers").select("id", { count: "exact", head: true }),
  ]);

  const stats = [
    { label: "محصولات", value: productsRes.count ?? 0, icon: "📦", href: "/admin/products", color: "from-[#39FF14]/20 to-transparent" },
    { label: "سفارشات", value: ordersRes.count ?? 0, icon: "🛍️", href: "/admin/orders", color: "from-blue-500/20 to-transparent" },
    { label: "کاربران", value: usersRes.count ?? 0, icon: "👥", href: "/admin/users", color: "from-purple-500/20 to-transparent" },
    { label: "فروشنده‌ها", value: sellersRes.count ?? 0, icon: "🏪", href: "/admin/products", color: "from-yellow-500/20 to-transparent" },
  ];

  return (
    <div>
      <h2 className="mb-2 text-2xl font-bold md:text-3xl">
        داشبورد <span className="text-[#39FF14]">ادمین</span>
      </h2>
      <p className="mb-8 text-gray-400">خلاصه وضعیت فروشگاه</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="group relative overflow-hidden rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6 transition hover:border-[#39FF14]/70 hover:shadow-[0_0_25px_rgba(57,255,20,0.15)]"
          >
            <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${s.color} opacity-0 transition group-hover:opacity-100`} />
            <div className="relative">
              <div className="mb-3 text-4xl">{s.icon}</div>
              <p className="text-3xl font-bold text-[#39FF14]">
                {s.value.toLocaleString("fa-IR")}
              </p>
              <p className="mt-1 text-sm text-gray-400">{s.label}</p>
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6">
        <h3 className="mb-4 text-lg font-bold text-[#39FF14]">دسترسی سریع</h3>
        <div className="flex flex-wrap gap-3">
          <Link href="/admin/products/new" className="rounded-lg bg-[#39FF14] px-5 py-2.5 text-sm font-bold text-black transition hover:bg-[#39FF14]/90">
            ➕ افزودن محصول جدید
          </Link>
          <Link href="/admin/products" className="rounded-lg border border-[#39FF14]/40 px-5 py-2.5 text-sm font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10">
            📦 مدیریت محصولات
          </Link>
          <Link href="/shop" className="rounded-lg border border-[#39FF14]/40 px-5 py-2.5 text-sm font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10">
            🛒 دیدن فروشگاه
          </Link>
        </div>
      </div>
    </div>
  );
}
