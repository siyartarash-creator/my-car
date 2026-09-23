"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { AdminCard } from "@/components/AdminCard";
import { SellerCard } from "@/components/SellerCard";
import { UserAvatar } from "@/components/UserAvatar";
import { ProfileStatusCard } from "@/components/ProfileStatusCard";

const dashboardItems = [
  {
    id: "shop",
    icon: "🛒",
    title: "فروشگاه",
    desc: "خرید قطعات برقی، بدنه، موتور و لوازم جانبی با ضمانت",
    href: "/shop",
    color: "from-green-500/20 to-green-400/5",
  },
  {
    id: "rescue",
    icon: "🚨",
    title: "امداد سیار",
    desc: "هرجا گیر کردی، امدادگر متخصص در کمترین زمان می‌رسه",
    href: "/rescue",
    color: "from-red-500/20 to-red-400/5",
  },
  {
    id: "services",
    icon: "🔧",
    title: "خدمات فنی",
    desc: "تعمیرگاه، کارواش، تعویض روغنی و مراکز خدمات تخصصی",
    href: "/services",
    color: "from-blue-500/20 to-blue-400/5",
  },
  {
    id: "assistant",
    icon: "🤖",
    title: "دستیار تعمیراتی هوشمند",
    desc: "مشکل ماشینت رو بگو، راه‌حل و قطعه لازم رو پیدا کن",
    href: "/assistant",
    color: "from-purple-500/20 to-purple-400/5",
  },
  {
    id: "service-history",
    icon: "📅",
    title: "سرویس‌های دوره‌ای و سابقه تعمیرات",
    desc: "یادآوری سرویس بعدی و تاریخچه کامل تعمیرات خودروی تو",
    href: "/service-history",
    color: "from-yellow-500/20 to-yellow-400/5",
  },
  {
    id: "orders",
    icon: "🛍️",
    title: "سبد خرید و پیگیری سفارشات",
    desc: "سفارش‌های فعلی و قبلی‌ت رو مدیریت کن",
    href: "/orders",
    color: "from-orange-500/20 to-orange-400/5",
  },
  {
    id: "news",
    icon: "📰",
    title: "اخبار خودرویی",
    desc: "جدیدترین اخبار، معرفی خودروها و رویدادهای صنعت",
    href: "/news",
    color: "from-cyan-500/20 to-cyan-400/5",
  },
  {
    id: "learn",
    icon: "🎬",
    title: "آکادمی آموزشی",
    desc: "دوره‌های آموزشی، ویدیوها و نقشه‌های برق خودرو",
    href: "/academy",
    color: "from-pink-500/20 to-pink-400/5",
  },
  {
    id: "digital",
    icon: "💻",
    title: "خدمات دیجیتال",
    desc: "استعلام خلافی، بیمه، معاینه فنی و خدمات آنلاین",
    href: "/digital",
    color: "from-indigo-500/20 to-indigo-400/5",
  },
];

export default function DashboardPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    const logged = localStorage.getItem("isLoggedIn") === "true";
    const name = localStorage.getItem("userName") || "";
    const firstName = name.trim().split(" ")[0] || "";

    if (!logged) {
      router.push("/");
      return;
    }

    setIsLoggedIn(true);
    setUserName(firstName);
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("userName");
    localStorage.removeItem("userId");
    localStorage.removeItem("userType");
    router.push("/");
  };

  if (!isLoggedIn) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">
        <div className="text-gray-400">در حال بررسی...</div>
      </main>
    );
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "صبح بخیر" : hour < 17 ? "وقت بخیر" : "شب بخیر";

  return (
    <main className="relative min-h-screen overflow-hidden bg-neutral-950 text-white" dir="rtl">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(#39FF14 1px, transparent 1px), linear-gradient(90deg, #39FF14 1px, transparent 1px)",
            backgroundSize: "50px 50px",
          }}
        />
        <div className="absolute -top-40 left-1/2 h-[400px] w-[700px] -translate-x-1/2 rounded-full bg-[#39FF14]/15 blur-[120px]" />
      </div>

      <div className="relative z-10">
        <header className="border-b border-[#39FF14]/20 bg-neutral-950/70 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
            <Link href="/" className="flex items-center gap-3">
              <Logo size={38} />
              <h1 className="text-xl font-bold text-[#39FF14] drop-shadow-[0_0_8px_#39FF14]">
                ماشین من
              </h1>
            </Link>

            <div className="relative">
              <button
                onClick={() => setAuthOpen(!authOpen)}
                className="flex items-center gap-3 rounded-full border border-[#39FF14]/40 bg-neutral-900/60 px-3 py-1.5 text-sm font-bold text-[#39FF14] transition hover:border-[#39FF14] hover:bg-[#39FF14]/10"
              >
                <UserAvatar size={32} />
                <span className="hidden sm:inline">{userName || "پروفایل من"}</span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              {authOpen && (
                <div className="absolute left-0 mt-2 w-44 overflow-hidden rounded-lg border border-[#39FF14]/20 bg-neutral-900 shadow-[0_0_20px_rgba(57,255,20,0.2)]">
                  <Link
                    href="/profile"
                    onClick={() => setAuthOpen(false)}
                    className="block px-4 py-2.5 text-right text-sm text-gray-200 transition hover:bg-[#39FF14]/10 hover:text-[#39FF14]"
                  >
                    👤 پروفایل من
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="block w-full px-4 py-2.5 text-right text-sm text-red-400 transition hover:bg-red-500/10"
                  >
                    🚪 خروج از حساب
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <section className="mx-auto max-w-7xl px-6 py-12">
          {/* خوش‌آمدگویی با آواتار */}
          <div className="mb-10 flex items-center gap-5">
            <UserAvatar size={80} />
            <div>
              <h2 className="mb-2 text-3xl font-bold md:text-4xl">
                {greeting}،{" "}
                <span className="text-[#39FF14] drop-shadow-[0_0_10px_#39FF14]">
                  {userName || "دوست عزیز"}
                </span>{" "}
                👋
              </h2>
              <p className="text-gray-400">
                از پنل کاربری، تمام خدمات ماشین من در دسترس شماست
              </p>
            </div>
          </div>

          {/* کارت‌های دسترسی */}
          <SellerCard />
          <AdminCard />

          {/* وضعیت پروفایل */}
          <ProfileStatusCard />

          {/* کارت‌های خدمات */}
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {dashboardItems.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="group relative overflow-hidden rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6 backdrop-blur-sm transition hover:border-[#39FF14]/70 hover:shadow-[0_0_30px_rgba(57,255,20,0.25)]"
              >
                <div
                  className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${item.color} opacity-0 transition group-hover:opacity-100`}
                />

                <div className="relative mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-[#39FF14]/30 bg-[#39FF14]/5 text-3xl transition group-hover:border-[#39FF14]/70 group-hover:bg-[#39FF14]/10 group-hover:shadow-[0_0_20px_rgba(57,255,20,0.3)]">
                  {item.icon}
                </div>

                <h3 className="relative mb-2 text-lg font-bold text-[#39FF14]">
                  {item.title}
                </h3>
                <p className="relative text-sm leading-relaxed text-gray-400">
                  {item.desc}
                </p>

                <div className="relative mt-4 flex items-center gap-1 text-xs font-bold text-[#39FF14] opacity-0 transition group-hover:opacity-100">
                  <span>ورود</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="rotate-180"
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <footer className="border-t border-[#39FF14]/20 bg-neutral-950/70 py-8 text-center text-sm text-gray-400 backdrop-blur-md">
          ساخته شده با{" "}
          <span className="inline-block text-[#39FF14] drop-shadow-[0_0_10px_#39FF14] animate-pulse">
            💚
          </span>{" "}
          توسط{" "}
          <span className="font-bold text-[#39FF14] drop-shadow-[0_0_8px_#39FF14]">
            مهدی
          </span>
        </footer>
      </div>
    </main>
  );
}