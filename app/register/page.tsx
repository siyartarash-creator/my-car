"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { supabase } from "@/lib/supabase";

const userTypes = [
  { id: "owner", title: "صاحبان خودرو", desc: "راننده‌ای که می‌خواد قطعه بخره، خدمات بگیره یا مشکل ماشینش رو حل کنه", icon: "🚗" },
  { id: "seller", title: "فروشندگان قطعات", desc: "فروشگاه یا عمده‌فروش قطعات یدکی و لوازم خودرو", icon: "📦" },
  { id: "service", title: "ارائه‌دهندگان خدمات فنی", desc: "تعمیرکار، تعمیرگاه، کارواش، تعویض روغنی و مراکز خدماتی", icon: "🔧" },
  { id: "rescuer", title: "امداد رسان‌ها", desc: "امدادگر سیار که در جاده‌ها و شهر به خودروها کمک می‌کنه", icon: "🚨" },
];



export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [selectedType, setSelectedType] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [nameError, setNameError] = useState("");
  const [loading, setLoading] = useState(false);
  const [registerError, setRegisterError] = useState("");

  const selectedUser = userTypes.find((t) => t.id === selectedType);

  const handleNameChange = (val: string) => {
    const cleaned = val.replace(/[^\u0600-\u06FF\s\u200c]/g, "");
    setName(cleaned);
    if (val !== cleaned) {
      setNameError("لطفاً نام را با حروف فارسی وارد کنید");
      setTimeout(() => setNameError(""), 2000);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();

    if (trimmed.length < 3) { alert("نام رو کامل وارد کن (حداقل ۳ حرف)"); return; }
    if (!/^[\u0600-\u06FF\s\u200c]+$/.test(trimmed)) { alert("نام باید فقط با حروف فارسی نوشته شود"); return; }
    if (!/^09\d{9}$/.test(mobile)) { alert("شماره موبایل درست نیست (مثلاً 09123456789)"); return; }
    if (password.length < 6) { alert("رمز عبور باید حداقل ۶ کاراکتر باشد"); return; }
    if (password !== confirmPassword) { alert("رمز عبور و تکرار آن یکسان نیستند"); return; }

    if (loading) return;
    setLoading(true);
    setRegisterError("");

    try {
      const email = `${mobile}@mycar.local`;
      const { data: authData, error: authError } = await supabase.auth.signUp({ email, password, options: { data: { name: name.trim(), mobile, user_type: selectedType || "owner" } } });

      if (authError) {
        if (authError.message.includes("already registered")) {
          setRegisterError("این شماره موبایل قبلاً ثبت‌نام کرده است");
        } else {
          setRegisterError(`خطا در ثبت‌نام: ${authError.message}`);
        }
        setLoading(false);
        return;
      }

      if (!authData.user) {
        setRegisterError("خطا در ساخت حساب کاربری");
        setLoading(false);
        return;
      }




      setLoading(false);
      if (!authData.session) { setRegisterError("حساب ساخته شد؛ ورود نیازمند تأیید تنظیمات احراز هویت است"); return; }
      setStep(3);
    } catch (err) {
      setRegisterError(`خطای غیرمنتظره: ${err instanceof Error ? err.message : "نامشخص"}`);
      setLoading(false);
    }
  };

  const firstName = name.trim().split(" ")[0] || "دوست عزیز";

  return (
    <main className="min-h-screen bg-neutral-950 text-white" dir="rtl">
      <header className="border-b border-[#39FF14]/20 px-6 py-4">
        <Link href="/" className="mx-auto flex max-w-6xl items-center gap-3">
          <Logo size={36} />
          <h1 className="text-xl font-bold text-[#39FF14] drop-shadow-[0_0_8px_#39FF14]">ماشین من</h1>
        </Link>
      </header>

      <section className="mx-auto max-w-4xl px-6 py-16">
        <div className="mb-10 flex items-center justify-center gap-2 text-xs">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full border font-bold transition ${step >= n ? "border-[#39FF14] bg-[#39FF14] text-black" : "border-[#39FF14]/20 text-gray-500"}`}>
                {n}
              </div>
              {n < 3 && <div className={`h-0.5 w-8 transition ${step > n ? "bg-[#39FF14]" : "bg-[#39FF14]/20"}`} />}
            </div>
          ))}
        </div>

        {step === 1 && (
          <>
            <h2 className="mb-2 text-center text-3xl font-bold md:text-4xl">
              ثبت‌نام در <span className="text-[#39FF14]">ماشین من</span>
            </h2>
            <p className="mb-10 text-center text-gray-400">نوع کاربری خودت رو انتخاب کن</p>
            <div className="grid gap-4 md:grid-cols-2">
              {userTypes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setSelectedType(t.id); setStep(2); }}
                  className="group rounded-2xl border border-[#39FF14]/20 bg-neutral-900 p-6 text-right transition hover:border-[#39FF14]/60 hover:shadow-[0_0_20px_rgba(57,255,20,0.2)]"
                >
                  <div className="mb-3 text-4xl">{t.icon}</div>
                  <h3 className="mb-1 text-lg font-bold text-[#39FF14]">{t.title}</h3>
                  <p className="text-sm text-gray-400">{t.desc}</p>
                </button>
              ))}
            </div>
            <p className="mt-10 text-center text-sm text-gray-400">
              قبلاً ثبت‌نام کردی؟{" "}
              <Link href="/login" className="text-[#39FF14] hover:underline">وارد شو</Link>
            </p>
          </>
        )}

        {step === 2 && (
          <>
            <button
              onClick={() => setStep(1)}
              className="group mb-8 flex items-center gap-3 rounded-full border border-[#39FF14]/30 bg-neutral-900/50 px-5 py-3 text-sm font-bold text-[#39FF14] transition hover:border-[#39FF14] hover:bg-[#39FF14]/10"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:-translate-x-1">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              <span>برگرد به انتخاب نوع کاربری</span>
            </button>

            <div className="mb-8 flex items-center gap-4">
              <span className="text-5xl">{selectedUser?.icon}</span>
              <div>
                <h2 className="text-2xl font-bold md:text-3xl">
                  ثبت‌نام به عنوان <span className="text-[#39FF14]">{selectedUser?.title}</span>
                </h2>
                <p className="text-gray-400">اطلاعات پایه رو وارد کن</p>
              </div>
            </div>

            <p className="mb-3 text-sm text-gray-400">ثبت‌نام با رمز عبور انجام می‌شود؛ شماره موبایل در این مرحله تأیید پیامکی نمی‌شود.</p>
            {registerError && <p className="text-red-400">{registerError}</p>}
            <form onSubmit={handleRegisterSubmit} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-gray-300">نام و نام خانوادگی</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="مثلاً مهدی رضایی"
                  className={`w-full rounded-lg border bg-neutral-900 px-4 py-3 text-white outline-none transition placeholder:text-gray-600 focus:shadow-[0_0_15px_rgba(57,255,20,0.3)] ${nameError ? "border-red-500/60 focus:border-red-500" : "border-[#39FF14]/20 focus:border-[#39FF14]"}`}
                />
                {nameError && <p className="mt-2 text-xs text-red-400">{nameError}</p>}
              </div>

              <div>
                <label className="mb-2 block text-sm text-gray-300">شماره موبایل</label>
                <input
                  type="tel"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 11))}
                  placeholder="09xxxxxxxxx"
                  dir="ltr"
                  className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-900 px-4 py-3 text-left text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14] focus:shadow-[0_0_15px_rgba(57,255,20,0.3)]"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-gray-300">رمز عبور</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="حداقل ۶ کاراکتر"
                    dir="ltr"
                    className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-900 px-4 py-3 pl-12 text-left text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14] focus:shadow-[0_0_15px_rgba(57,255,20,0.3)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition hover:text-[#39FF14]"
                    title={showPassword ? "مخفی کردن" : "نمایش"}
                  >
                    {showPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                        <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                        <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                        <line x1="2" x2="22" y1="2" y2="22" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-gray-400">
                  <input
                    type="checkbox"
                    checked={showPassword}
                    onChange={(e) => setShowPassword(e.target.checked)}
                    className="h-4 w-4 accent-[#39FF14]"
                  />
                  نمایش رمز عبور
                </label>
              </div>

              <div>
                <label className="mb-2 block text-sm text-gray-300">تکرار رمز عبور</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="همون رمز رو دوباره وارد کن"
                    dir="ltr"
                    className={`w-full rounded-lg border bg-neutral-900 px-4 py-3 pl-12 text-left text-white outline-none transition placeholder:text-gray-600 focus:shadow-[0_0_15px_rgba(57,255,20,0.3)] ${
                      confirmPassword && confirmPassword !== password
                        ? "border-red-500/60 focus:border-red-500"
                        : "border-[#39FF14]/20 focus:border-[#39FF14]"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition hover:text-[#39FF14]"
                    title={showConfirmPassword ? "مخفی کردن" : "نمایش"}
                  >
                    {showConfirmPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                        <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                        <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                        <line x1="2" x2="22" y1="2" y2="22" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                {confirmPassword && confirmPassword !== password && (
                  <p className="mt-2 text-xs text-red-400">رمز عبور و تکرار آن یکسان نیستند</p>
                )}
                {confirmPassword && confirmPassword === password && password.length >= 6 && (
                  <p className="mt-2 text-xs text-[#39FF14]">✅ رمز عبور یکسان است</p>
                )}
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-gray-400">
                  <input
                    type="checkbox"
                    checked={showConfirmPassword}
                    onChange={(e) => setShowConfirmPassword(e.target.checked)}
                    className="h-4 w-4 accent-[#39FF14]"
                  />
                  نمایش تکرار رمز
                </label>
              </div>

              <button
                type="submit"
                  disabled={loading}
                className="w-full rounded-lg bg-[#39FF14] px-8 py-3 font-bold text-black shadow-[0_0_20px_rgba(57,255,20,0.5)] transition hover:bg-[#39FF14]/80 hover:shadow-[0_0_30px_rgba(57,255,20,0.8)]"
              >
                {loading ? "در حال ثبت‌نام..." : "ساخت حساب"}
              </button>
            </form>
          </>
        )}

        {step === 3 && (
          <div className="mx-auto max-w-md text-center">
            <div className="mb-6 text-7xl">🎉</div>
            <h2 className="mb-3 text-3xl font-bold">
              تبریک، <span className="text-[#39FF14] drop-shadow-[0_0_10px_#39FF14]">{firstName}</span>
            </h2>
            <p className="mb-2 text-gray-300">حساب کاربری شما با موفقیت ساخته شد</p>
            <p className="mb-10 text-sm text-gray-500">حالا می‌توانی وارد پنل کاربری شوی</p>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => router.push("/dashboard")}
                className="inline-block rounded-lg bg-[#39FF14] px-8 py-3 font-bold text-black shadow-[0_0_20px_rgba(57,255,20,0.5)] transition hover:bg-[#39FF14]/80"
              >
                ورود به پنل کاربری
              </button>
              <Link
                href="/profile"
                className="inline-block rounded-lg border border-[#39FF14]/40 px-8 py-3 font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10"
              >
                تکمیل پروفایل (اختیاری)
              </Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}