"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import type { AdminModule } from "@/lib/admin/modules";

// Pure presentational shell: auth/permission resolution happens once, on the
// server, in app/admin/layout.tsx (requireAdminAccess). This component never
// queries auth or profiles.is_admin itself -- it only renders what it is
// handed. Registry-driven: which links appear comes entirely from the
// `modules` prop (lib/admin/modules.ts), filtered server-side.
export default function AdminNavigation({
  children,
  isAdmin,
  modules,
  pendingProductRequests,
}: {
  children: React.ReactNode;
  isAdmin: boolean;
  modules: AdminModule[];
  pendingProductRequests: number;
}) {
  const pathname = usePathname();
  const badgeValue = (badgeKey?: "pendingProductRequests" | "pendingDiscountRequests") =>
    badgeKey === "pendingProductRequests" ? pendingProductRequests : 0;

  return (
    <main className="min-h-screen bg-neutral-950 text-white" dir="rtl">
      <header className="border-b border-[#39FF14]/20 bg-neutral-950/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <Logo size={36} />
            <h1 className="text-xl font-bold text-[#39FF14]">ماشین من</h1>
            <span className="rounded-full border border-yellow-400/40 bg-yellow-400/10 px-2.5 py-0.5 text-[10px] text-yellow-400">
              {isAdmin ? "سوپر ادمین" : "اپراتور"}
            </span>
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full border border-[#39FF14]/30 px-4 py-2 text-sm text-[#39FF14] transition hover:bg-[#39FF14]/10"
          >
            بازگشت به سایت
          </Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-6 py-8">
        <aside className="hidden w-56 shrink-0 lg:block">
          <nav className="sticky top-6 space-y-4">
            {modules.map((mod) => (
              <div key={mod.key} className="space-y-1">
                <p className="px-4 text-[11px] font-bold text-gray-500">{mod.label}</p>
                {mod.items.map((item) => {
                  const active = pathname === item.href;
                  const badge = badgeValue(item.badgeKey);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition ${
                        active
                          ? "bg-[#39FF14] font-bold text-black"
                          : "text-gray-300 hover:bg-[#39FF14]/10 hover:text-[#39FF14]"
                      }`}
                    >
                      <span className="text-lg">{item.icon}</span>
                      <span className="flex-1">{item.label}</span>
                      {badge > 0 ? (
                        <span
                          className={`flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
                            active ? "bg-black text-[#39FF14]" : "bg-red-500 text-white"
                          }`}
                        >
                          {badge.toLocaleString("fa-IR")}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </main>
  );
}
