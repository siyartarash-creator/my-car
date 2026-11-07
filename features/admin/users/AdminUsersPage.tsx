import Link from "next/link";
import { requireRole } from "@/lib/auth-server";

export default async function AdminUsersPage() {
  const { client } = await requireRole("admin");
  const { data, error } = await client.from("profiles").select("id,name,mobile,user_type,is_admin,created_at").order("created_at", { ascending: false }).limit(100);
  const users = data ?? [];
  return <section dir="rtl">
    <div className="mb-6 flex items-center justify-between"><div><h2 className="text-2xl font-bold md:text-3xl">مدیریت <span className="text-[#39FF14]">کاربران</span></h2><p className="mt-1 text-sm text-gray-400">{users.length.toLocaleString("fa-IR")} کاربر اخیر</p></div><Link href="/admin" className="text-sm text-[#39FF14]">بازگشت</Link></div>
    {error ? <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-red-400">خطا در دریافت کاربران</p> : <div className="overflow-x-auto rounded-xl border border-[#39FF14]/20"><table className="w-full text-right text-sm"><thead className="bg-neutral-900 text-gray-400"><tr><th className="p-4">نام</th><th className="p-4">موبایل</th><th className="p-4">نوع</th><th className="p-4">وضعیت</th></tr></thead><tbody>{users.map((user) => <tr key={user.id} className="border-t border-white/10"><td className="p-4">{user.name}</td><td className="p-4">{user.mobile}</td><td className="p-4">{user.user_type}</td><td className="p-4">{user.is_admin ? "مدیر" : "فعال"}</td></tr>)}</tbody></table></div>}
  </section>;
}
