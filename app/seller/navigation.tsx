"use client";
import { getCurrentUserId } from "@/lib/auth-client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Logo } from "@/components/Logo";
import { resolveSellerBusinessIdentity } from "@/lib/seller-identity";

type MenuItem = {
  href: string;
  label: string;
  icon: string;
  badge?: number;
};

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [isSeller, setIsSeller] = useState(false);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [businessName, setBusinessName] = useState<string | null>(null);

  useEffect(() => {
    const check = async () => {
      const userId = await getCurrentUserId();
      if (!userId) {
        router.push("/login");
        return;
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("user_type, name, phone1, phone2, about, social_links, data")
        .eq("id", userId)
        .single();

      if (error || data?.user_type !== "seller") {
        router.push("/");
        return;
      }

      setBusinessName(resolveSellerBusinessIdentity(data).businessName);

      const { count } = await supabase
        .from("product_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");

      setPendingRequests(count || 0);
      setIsSeller(true);
      setChecking(false);
    };
    check();
  }, [router, pathname]);

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">
        <div className="text-gray-400">در حال بررسی دسترسی...</div>
      </main>
    );
  }

  if (!isSeller) return null;

  const menuItems: MenuItem[] = [
    { href: "/seller", label: "داشبورد", icon: "📊" },
    { href: "/seller/products", label: "محصولات", icon: "📦" },
    { href: "/seller/my-products", label: "پیشنهادهای من", icon: "🏪" },
    { href: "/seller/requests", label: "درخواست‌ها", icon: "📨", badge: pendingRequests },
    { href: "/seller/orders", label: "سفارشات", icon: "🛍️" },
  ];

  return (
    <main className="min-h-screen bg-neutral-950 text-white" dir="rtl">
      <header className="border-b border-[#39FF14]/20 bg-neutral-950/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <Logo size={36} />
            <h1 className="text-xl font-bold text-[#39FF14]">ماشین من</h1>
            <span className="rounded-full border border-yellow-400/40 bg-yellow-400/10 px-2.5 py-0.5 text-[10px] text-yellow-400">
              {businessName ?? "فروشنده"}
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
          <nav className="sticky top-6 space-y-1">
            {menuItems.map((item) => {
              const active = pathname === item.href;
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
                  {item.badge && item.badge > 0 ? (
                    <span
                      className={`flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
                        active
                          ? "bg-black text-[#39FF14]"
                          : "bg-red-500 text-white"
                      }`}
                    >
                      {item.badge.toLocaleString("fa-IR")}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </main>
  );
}