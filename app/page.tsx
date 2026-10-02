"use client";
import { useIdentity } from "@/lib/auth-client";
import { supabase } from "@/lib/supabase";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";

const features = [
  {
    icon: "🛒",
    title: "فروشگاه",
    desc: "خرید قطعات برقی، بدنه، موتور و لوازم جانبی با ضمانت",
    href: "/shop",
  },
  {
    icon: "🚨",
    title: "امداد سیار",
    desc: "هرجا گیر کردی، امدادگر متخصص در کمترین زمان می‌رسه",
    href: "/rescue",
  },
  {
    icon: "🔧",
    title: "خدمات فنی",
    desc: "تعمیرگاه، کارواش، تعویض روغنی و مراکز خدمات تخصصی",
    href: "/services",
  },
  {
    icon: "🤖",
    title: "دستیار تعمیراتی هوشمند",
    desc: "مشکل ماشینت رو بگو، راه‌حل و قطعه لازم رو پیدا کن",
    href: "/assistant",
  },
  {
    icon: "🎬",
    title: "ویدیوهای آموزشی و نقشه‌ها",
    desc: "آموزش گام‌به‌گام تعمیرات و نقشه‌های برق خودرو",
    href: "/learn",
  },
  {
    icon: "📰",
    title: "اخبار خودرویی",
    desc: "جدیدترین اخبار، معرفی خودروها و رویدادهای صنعت",
    href: "/news",
  },
  {
    icon: "💻",
    title: "خدمات دیجیتال",
    desc: "استعلام خلافی، بیمه، معاینه فنی و خدمات آنلاین",
    href: "/digital",
  },
];

const priceCategories = [
  {
    icon: "🚨",
    title: "امداد سیار",
    items: [
      { name: "باتری به باتری", price: "از ۵۰,۰۰۰" },
      { name: "بکسل شهری", price: "از ۱۵۰,۰۰۰" },
      { name: "تعویض لاستیک", price: "از ۸۰,۰۰۰" },
      { name: "سوخت‌رسانی", price: "از ۱۰۰,۰۰۰" },
    ],
  },
  {
    icon: "🔧",
    title: "خدمات فنی",
    items: [
      { name: "تعویض روغن", price: "از ۸۰,۰۰۰" },
      { name: "دیاگ و عیب‌یابی", price: "از ۱۰۰,۰۰۰" },
      { name: "تعمیرات برق خودرو", price: "از ۲۰۰,۰۰۰" },
      { name: "صافکاری و نقاشی", price: "بر اساس عیب" },
    ],
  },
  {
    icon: "💻",
    title: "خدمات دیجیتال",
    items: [
      { name: "استعلام خلافی", price: "از ۱۵,۰۰۰" },
      { name: "استعلام بیمه", price: "از ۱۰,۰۰۰" },
      { name: "نوبت معاینه فنی", price: "رایگان" },
      { name: "استعلام تخلفات", price: "از ۲۰,۰۰۰" },
    ],
  },
  {
    icon: "🚗",
    title: "خدمات تکمیلی",
    items: [
      { name: "کارواش معمولی", price: "از ۱۰۰,۰۰۰" },
      { name: "دیتیلینگ", price: "از ۸۰۰,۰۰۰" },
      { name: "تعویض شیشه", price: "بر اساس مدل" },
      { name: "تعمیر کولر", price: "از ۳۰۰,۰۰۰" },
    ],
  },
];

export default function Home() {
  const [date, setDate] = useState("");
  const [lang, setLang] = useState<"fa" | "en">("fa");
  const [langOpen, setLangOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const { user, profile } = useIdentity();
  const isLoggedIn = !!user;
  const userName = profile?.name.trim().split(" ")[0] ?? "";
  const [showLoginModal, setShowLoginModal] = useState(false);

  useEffect(() => {
    const now = new Date();
    const faDate = now.toLocaleDateString("fa-IR", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    setDate(faDate);

  }, []);

  const handleFeatureClick = (e: React.MouseEvent) => {
    if (!isLoggedIn) {
      e.preventDefault();
      setShowLoginModal(true);
    }
  };

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) { alert("خروج انجام نشد؛ دوباره تلاش کنید"); return; }
    setAuthOpen(false);
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-neutral-950 text-white" dir="rtl">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(#39FF14 1px, transparent 1px), linear-gradient(90deg, #39FF14 1px, transparent 1px)",
            backgroundSize: "50px 50px",
          }}
        />
        <div className="absolute -top-40 left-1/2 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-[#39FF14]/20 blur-[120px]" />
        <div className="absolute -bottom-40 right-0 h-[400px] w-[600px] rounded-full bg-[#39FF14]/10 blur-[120px]" />
      </div>

      <div className="relative z-10">
        <header className="border-b border-[#39FF14]/20 bg-neutral-950/70 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
            <div className="flex items-center gap-4">
              <Link href="/" className="flex items-center gap-3">
                <Logo size={38} />
                <h1 className="text-xl font-bold text-[#39FF14] drop-shadow-[0_0_8px_#39FF14]">
                  ماشین من
                </h1>
              </Link>

              {isLoggedIn ? (
                <div className="relative">
                  <button
                    onClick={() => setAuthOpen(!authOpen)}
                    className="flex items-center gap-2 rounded-full bg-[#39FF14] px-7 py-2.5 text-base font-bold text-black shadow-[0_0_20px_rgba(57,255,20,0.6)] transition hover:bg-[#39FF14]/90"
                  >
                    <span>👤</span>
                    {userName || "پروفایل من"}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
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
                    <div className="absolute right-0 mt-2 w-44 overflow-hidden rounded-lg border border-[#39FF14]/20 bg-neutral-900 shadow-[0_0_20px_rgba(57,255,20,0.2)]">
                      <Link
                        href="/dashboard"
                        className="block px-4 py-2.5 text-right text-sm text-gray-200 transition hover:bg-[#39FF14]/10 hover:text-[#39FF14]"
                        onClick={() => setAuthOpen(false)}
                      >
                        📊 پنل کاربری
                      </Link>
                      <Link
                        href="/profile"
                        className="block px-4 py-2.5 text-right text-sm text-gray-200 transition hover:bg-[#39FF14]/10 hover:text-[#39FF14]"
                        onClick={() => setAuthOpen(false)}
                      >
                        👤 پروفایل من
                      </Link>
                      <button
                        onClick={handleLogout}
                        className="block w-full px-4 py-2.5 text-right text-sm text-red-400 transition hover:bg-red-500/10"
                      >
                        🚪 خروج
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="relative">
                  <button
                    onClick={() => setAuthOpen(!authOpen)}
                    className="flex items-center gap-2 rounded-full bg-[#39FF14] px-7 py-2.5 text-base font-bold text-black shadow-[0_0_20px_rgba(57,255,20,0.6)] transition hover:bg-[#39FF14]/90 hover:shadow-[0_0_30px_rgba(57,255,20,0.9)]"
                  >
                    ثبت‌نام/ورود
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
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
                    <div className="absolute right-0 mt-2 w-40 overflow-hidden rounded-lg border border-[#39FF14]/20 bg-neutral-900 shadow-[0_0_20px_rgba(57,255,20,0.2)]">
                      <Link
                        href="/register"
                        className="block px-4 py-2.5 text-right text-sm text-gray-200 transition hover:bg-[#39FF14]/10 hover:text-[#39FF14]"
                        onClick={() => setAuthOpen(false)}
                      >
                        ✍️ ثبت‌نام
                      </Link>
                      <Link
                        href="/login"
                        className="block px-4 py-2.5 text-right text-sm text-gray-200 transition hover:bg-[#39FF14]/10 hover:text-[#39FF14]"
                        onClick={() => setAuthOpen(false)}
                      >
                        🔑 ورود
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>

            <nav className="hidden gap-6 text-sm text-gray-300 lg:flex">
              <a href="#features" className="transition hover:text-[#39FF14]">امکانات</a>
              <a href="#pricing" className="transition hover:text-[#39FF14]">تعرفه خدمات</a>
              <a href="#services" className="transition hover:text-[#39FF14]">خدمات</a>
              <a href="#contact" className="transition hover:text-[#39FF14]">تماس</a>
            </nav>

            <div className="flex items-center gap-3">
              {date && (
                <div className="hidden items-center gap-2 rounded-full border border-[#39FF14]/20 bg-neutral-900/60 px-4 py-1.5 text-xs text-gray-300 md:flex">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#39FF14"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <path d="M16 2v4M8 2v4M3 10h18" />
                  </svg>
                  <span>{date}</span>
                </div>
              )}

              <div className="relative">
                <button
                  onClick={() => setLangOpen(!langOpen)}
                  className="flex items-center gap-2 rounded-full border border-[#39FF14]/20 bg-neutral-900/60 px-4 py-1.5 text-xs font-bold text-[#39FF14] transition hover:border-[#39FF14]/60 hover:bg-[#39FF14]/10"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  <span>{lang === "fa" ? "فا" : "En"}</span>
                </button>

                {langOpen && (
                  <div className="absolute left-0 mt-2 w-28 overflow-hidden rounded-lg border border-[#39FF14]/20 bg-neutral-900 shadow-[0_0_20px_rgba(57,255,20,0.2)]">
                    <button
                      onClick={() => { setLang("fa"); setLangOpen(false); }}
                      className={`block w-full px-4 py-2 text-right text-sm transition hover:bg-[#39FF14]/10 ${
                        lang === "fa" ? "text-[#39FF14] font-bold" : "text-gray-300"
                      }`}
                    >
                      🇮🇷 فارسی
                    </button>
                    <button
                      onClick={() => { setLang("en"); setLangOpen(false); }}
                      className={`block w-full px-4 py-2 text-right text-sm transition hover:bg-[#39FF14]/10 ${
                        lang === "en" ? "text-[#39FF14] font-bold" : "text-gray-300"
                      }`}
                    >
                      🇬🇧 English
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <section className="mx-auto flex max-w-6xl flex-col items-center justify-center px-6 py-28 text-center">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#39FF14]/30 bg-[#39FF14]/5 px-4 py-1 text-sm text-[#39FF14]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#39FF14]" />
            به زودی در دسترس
          </p>

          <h2 className="mb-6 text-5xl font-bold leading-tight md:text-7xl">
            همه چیز برای
            <br />
            <span className="text-[#39FF14] drop-shadow-[0_0_20px_rgba(57,255,20,0.5)]">
              خودروی تو
            </span>
          </h2>

          <p className="max-w-2xl text-lg text-gray-400">
            خرید قطعات، دستیار هوشمند تعمیرکار، امداد سیار، آموزش و نقشه‌ها
            و هرچی که یه راننده نیاز داره — همه توی یه اپ.
          </p>
        </section>

        <section id="features" className="mx-auto max-w-7xl px-6 pb-24">
          <div className="mb-12 text-center">
            <h3 className="mb-3 text-3xl font-bold md:text-4xl">
              هرچی برای <span className="text-[#39FF14]">خودرو</span> لازم داری
            </h3>
            <p className="text-gray-400">هفت سرویس یکپارچه در یک اپلیکیشن</p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <Link
                key={f.title}
                href={f.href}
                onClick={handleFeatureClick}
                className="group relative overflow-hidden rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6 backdrop-blur-sm transition hover:border-[#39FF14]/70 hover:shadow-[0_0_30px_rgba(57,255,20,0.25)]"
              >
                <div className="pointer-events-none absolute -top-10 -left-10 h-32 w-32 rounded-full bg-[#39FF14]/0 blur-2xl transition group-hover:bg-[#39FF14]/20" />

                <div className="relative mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-[#39FF14]/30 bg-[#39FF14]/5 text-3xl transition group-hover:border-[#39FF14]/70 group-hover:bg-[#39FF14]/10 group-hover:shadow-[0_0_20px_rgba(57,255,20,0.3)]">
                  {f.icon}
                </div>

                <h4 className="relative mb-2 text-lg font-bold text-[#39FF14]">
                  {f.title}
                </h4>
                <p className="relative text-sm leading-relaxed text-gray-400">
                  {f.desc}
                </p>

                {!isLoggedIn && (
                  <div className="absolute left-4 top-4 text-xs text-gray-600">
                    🔒
                  </div>
                )}
              </Link>
            ))}
          </div>
        </section>

        <section id="pricing" className="relative mx-auto max-w-7xl px-6 pb-24">
          <div className="mb-12 text-center">
            <p className="mb-3 inline-block rounded-full border border-[#39FF14]/30 bg-[#39FF14]/5 px-4 py-1 text-sm text-[#39FF14]">
              💰 شفاف و بدون هزینه پنهان
            </p>
            <h3 className="mb-3 text-3xl font-bold md:text-4xl">
              تعرفه <span className="text-[#39FF14]">خدمات</span>
            </h3>
            <p className="mx-auto max-w-2xl text-gray-400">
              قیمت‌های پایه خدمات ما شفاف است. قیمت نهایی بر اساس نوع خودرو،
              منطقه و شرایط اعلام می‌شود.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {priceCategories.map((cat) => (
              <div
                key={cat.title}
                className="group relative overflow-hidden rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6 backdrop-blur-sm transition hover:border-[#39FF14]/70 hover:shadow-[0_0_30px_rgba(57,255,20,0.25)]"
              >
                <div className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-[#39FF14]/0 blur-2xl transition group-hover:bg-[#39FF14]/20" />

                <div className="relative mb-5 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#39FF14]/30 bg-[#39FF14]/5 text-2xl transition group-hover:border-[#39FF14]/70 group-hover:bg-[#39FF14]/10">
                    {cat.icon}
                  </div>
                  <h4 className="text-lg font-bold text-[#39FF14]">
                    {cat.title}
                  </h4>
                </div>

                <ul className="relative space-y-3">
                  {cat.items.map((item) => (
                    <li
                      key={item.name}
                      className="flex items-center justify-between gap-3 border-b border-[#39FF14]/10 pb-3 last:border-0 last:pb-0"
                    >
                      <span className="text-sm text-gray-300">{item.name}</span>
                      <span className="whitespace-nowrap text-sm font-bold text-[#39FF14]">
                        {item.price}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-col items-center gap-4 text-center">
            <p className="text-sm text-gray-500">
              💡 قیمت‌ها به تومان است و ممکن است بر اساس منطقه و شرایط تغییر کند
            </p>
            <Link
              href="/shop"
              className="rounded-full border border-[#39FF14]/40 px-6 py-2.5 text-sm font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10 hover:shadow-[0_0_20px_rgba(57,255,20,0.3)]"
            >
              استعلام قیمت دقیق
            </Link>
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

      {showLoginModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
          onClick={() => setShowLoginModal(false)}
        >
          <div
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[#39FF14]/40 bg-neutral-900 p-8 text-center shadow-[0_0_50px_rgba(57,255,20,0.3)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pointer-events-none absolute -top-20 left-1/2 h-40 w-72 -translate-x-1/2 rounded-full bg-[#39FF14]/30 blur-3xl" />

            <button
              onClick={() => setShowLoginModal(false)}
              className="absolute left-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition hover:bg-red-500/10 hover:text-red-400"
            >
              ✕
            </button>

            <div className="relative">
              <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full border-2 border-[#39FF14]/40 bg-[#39FF14]/10 text-4xl shadow-[0_0_30px_rgba(57,255,20,0.4)]">
                🔒
              </div>

              <h3 className="mb-3 text-2xl font-bold">
                دسترسی <span className="text-[#39FF14]">محدود</span>
              </h3>

              <p className="mb-8 text-gray-300 leading-relaxed">
                برای استفاده از خدمات سایت لطفاً ابتدا{" "}
                <span className="font-bold text-[#39FF14]">ثبت‌نام</span> کنید
              </p>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/register"
                  className="flex-1 rounded-lg bg-[#39FF14] px-6 py-3 font-bold text-black shadow-[0_0_20px_rgba(57,255,20,0.5)] transition hover:bg-[#39FF14]/80 hover:shadow-[0_0_30px_rgba(57,255,20,0.8)]"
                >
                  ثبت‌نام
                </Link>
                <Link
                  href="/login"
                  className="flex-1 rounded-lg border border-[#39FF14]/50 px-6 py-3 font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10"
                >
                  ورود
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}