import Link from "next/link";
import { requireRole } from "@/lib/auth-server";

const labels: Record<string, string> = {
  pending: "در انتظار پرداخت", paid: "پرداخت شده", processing: "در حال پردازش",
  shipped: "ارسال شده", delivered: "تحویل شده", cancelled: "لغو شده",
};

export default async function AdminOrdersPage() {
  const { client } = await requireRole("admin");
  const { data, error } = await client.from("orders").select("id,user_id,status,final_price,payment_status,created_at,profiles(name,mobile)").order("created_at", { ascending: false }).limit(100);
  const orders = (data ?? []) as Array<{ id: number; user_id: string | null; status: string; final_price: number; payment_status: string; created_at: string; profiles: { name: string; mobile: string } | Array<{ name: string; mobile: string }> | null }>;

  return <section dir="rtl">
    <div className="mb-6 flex items-center justify-between"><div><h2 className="text-2xl font-bold md:text-3xl">مدیریت <span className="text-[#39FF14]">سفارشات</span></h2><p className="mt-1 text-sm text-gray-400">{orders.length.toLocaleString("fa-IR")} سفارش اخیر</p></div><Link href="/admin" className="text-sm text-[#39FF14]">بازگشت</Link></div>
    {error ? <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-red-400">خطا در دریافت سفارش‌ها</p> : <div className="overflow-x-auto rounded-xl border border-[#39FF14]/20"><table className="w-full text-right text-sm"><thead className="bg-neutral-900 text-gray-400"><tr><th className="p-4">شماره</th><th className="p-4">مشتری</th><th className="p-4">وضعیت</th><th className="p-4">مبلغ</th><th className="p-4">تاریخ</th></tr></thead><tbody>{orders.map((order) => { const profile = Array.isArray(order.profiles) ? order.profiles[0] : order.profiles; return <tr key={order.id} className="border-t border-white/10"><td className="p-4 font-bold text-[#39FF14]">#{order.id.toLocaleString("fa-IR")}</td><td className="p-4">{profile?.name ?? "—"}<div className="text-xs text-gray-500">{profile?.mobile ?? "—"}</div></td><td className="p-4">{labels[order.status] ?? order.status}</td><td className="p-4">{order.final_price.toLocaleString("fa-IR")} تومان</td><td className="p-4 text-gray-400">{new Date(order.created_at).toLocaleDateString("fa-IR")}</td></tr>; })}</tbody></table>{orders.length === 0 && <p className="p-8 text-center text-gray-400">سفارشی وجود ندارد</p>}</div>}
  </section>;
}
