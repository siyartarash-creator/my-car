"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!/^09\d{9}$/.test(mobile)) {
      setError("شماره موبایل درست نیست (مثلاً 09123456789)");
      return;
    }
    if (password.length < 6) {
      setError("رمز عبور باید حداقل ۶ کاراکتر باشد");
      return;
    }

    setLoading(true);

    try {
      const email = `${mobile}@mycar.local`;

      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({
          email,
          password,
        });

      if (authError) {
        if (authError.message.includes("Invalid login credentials")) {
          setError("شماره موبایل یا رمز عبور اشتباه است");
        } else if (authError.message.includes("Email not confirmed")) {
          setError("حساب کاربری تایید نشده است. با پشتیبانی تماس بگیرید");
        } else {
          setError(`خطا در ورود: ${authError.message}`);
        }
        setLoading(false);
        return;
      }

      if (!authData.user) {
        setError("خطا در ورود به حساب کاربری");
        setLoading(false);
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("name, user_type")
        .eq("id", authData.user.id)
        .single();

      if (profileError || !profileData) {
        setError("پروفایل کاربری پیدا نشد");
        setLoading(false);
        return;
      }

      if (typeof window !== "undefined") {
        localStorage.setItem("isLoggedIn", "true");
        localStorage.setItem("userName", profileData.name);
        localStorage.setItem("userType", profileData.user_type);
        localStorage.setItem("userId", authData.user.id);
      }

      setLoading(false);
      router.push("/dashboard");
    } catch (err) {
      setError(
        `خطای غیرمنتظره: ${err instanceof Error ? err.message : "نامشخص"}`
      );
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-white" dir="rtl">
      <header className="border-b border-[#39FF14]/20 px-6 py-4">
        <Link href="/" className="mx-auto flex max-w-6xl items-center gap-3">
          <Logo size={36} />
          <h1 className="text-xl font-bold text-[#39FF14] drop-shadow-[0_0_8px_#39FF14]">
            ماشین من
          </h1>
        </Link>
      </header>

      <section className="mx-auto max-w-md px-6 py-16">
        <div className="mb-8 text-center">
          <div className="mb-4 text-6xl">👋</div>
          <h2 className="mb-2 text-3xl font-bold">خوش برگشتی</h2>
          <p className="text-gray-400">
            با شماره موبایل و رمز عبورت وارد شو
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            ❌ {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-gray-300">
              شماره موبایل
            </label>
            <input
              type="tel"
              value={mobile}
              onChange={(e) =>
                setMobile(e.target.value.replace(/\D/g, "").slice(0, 11))
              }
              placeholder="09xxxxxxxxx"
              dir="ltr"
              disabled={loading}
              className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-900 px-4 py-3 text-left text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14] focus:shadow-[0_0_15px_rgba(57,255,20,0.3)] disabled:opacity-50"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-gray-300">
              رمز عبور
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              dir="ltr"
              disabled={loading}
              className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-900 px-4 py-3 text-left text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14] focus:shadow-[0_0_15px_rgba(57,255,20,0.3)] disabled:opacity-50"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[#39FF14] px-8 py-3 font-bold text-black shadow-[0_0_20px_rgba(57,255,20,0.5)] transition hover:bg-[#39FF14]/80 hover:shadow-[0_0_30px_rgba(57,255,20,0.8)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "در حال ورود..." : "ورود به حساب"}
          </button>

          <p className="text-center text-sm text-gray-400">
            حساب نداری؟{" "}
            <Link href="/register" className="text-[#39FF14] hover:underline">
              ثبت‌نام کن
            </Link>
          </p>
        </form>
      </section>
    </main>
  );
}