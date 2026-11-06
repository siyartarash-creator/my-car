"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIdentity } from "@/lib/auth-client";
import { supabase } from "@/lib/supabase";

type Account = { id: string; kind: string; code: string | null; is_active: boolean };
type Entry = { id: string; account_id: string; signed_amount: number; reason: string; source_type: string; source_id: string | null; created_at: string };

async function loadHeld(userId: string) {
  const { data, error } = await supabase.from("orders").select("final_price").eq("user_id", userId).eq("escrow_status", "held");
  if (error) throw new Error("held");
  return (data ?? []).reduce((sum, order) => sum + Number(order.final_price ?? 0), 0);
}

async function loadEntries(accountIds: string[]) {
  const pageSize = 1000;
  const entries: Entry[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("ledger_entries")
      .select("id,account_id,signed_amount,reason,source_type,source_id,created_at")
      .in("account_id", accountIds)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error("entries");
    entries.push(...((data ?? []) as Entry[]));
    if ((data ?? []).length < pageSize) return entries;
  }
}

const money = (value: number) => `${new Intl.NumberFormat("fa-IR").format(value)} تومان`;
const operationTitle: Record<string, string> = {
  admin_charge: "شارژ دستی",
  order_wallet_payment: "پرداخت از کیف پول",
  test_rescue: "امداد تستی",
  release: "تکمیل و آزادسازی وجه",
  refund: "بازپرداخت",
};

export function WalletPanel() {
  const router = useRouter();
  const { user, loading: authLoading } = useIdentity();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [entries, setEntries] = useState<Entry[]>([]);
  const [held, setHeld] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    if (!user) return;
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError("");
    try {
      const accountsResult = await supabase.from("ledger_accounts").select("id,kind,code,is_active").eq("profile_id", user.id).eq("kind", "profile").eq("is_active", true).order("created_at");
      if (accountsResult.error) throw new Error("accounts");
      const nextAccounts = (accountsResult.data ?? []) as Account[];
      const accountIds = nextAccounts.map((account) => account.id);
      const [nextEntries, nextHeld] = await Promise.all([accountIds.length ? loadEntries(accountIds) : Promise.resolve([]), loadHeld(user.id)]);
      if (generation !== loadGeneration.current) return;
      const nextBalances: Record<string, number> = {};
      for (const entry of nextEntries) nextBalances[entry.account_id] = (nextBalances[entry.account_id] ?? 0) + Number(entry.signed_amount);
      setAccounts(nextAccounts);
      setBalances(nextBalances);
      setEntries(nextEntries);
      setHeld(nextHeld);
    } catch { if (generation === loadGeneration.current) { setAccounts([]); setBalances({}); setEntries([]); setError("اطلاعات کیف پول بارگذاری نشد"); } }
    finally { if (generation === loadGeneration.current) setLoading(false); }
  }, [user]);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login?redirect=%2Fwallet");
    if (!user) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, user, router, load]);

  const available = useMemo(() => accounts.filter((account) => account.kind === "profile").reduce((sum, account) => sum + (balances[account.id] ?? 0), 0), [accounts, balances]);

  if (authLoading || !user) return <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-gray-400">در حال بررسی دسترسی...</main>;

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white" dir="rtl">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="mb-2 text-sm text-[#39FF14]">MY CAR / امور مالی</p>
            <h1 className="text-3xl font-bold">کیف پول من</h1>
            <p className="mt-2 text-sm text-gray-400">واحد نمایش کیف پول: تومان</p>
          </div>
          <Link href="/dashboard" className="rounded-lg border border-[#39FF14]/40 px-4 py-2 text-sm text-[#39FF14] hover:bg-[#39FF14]/10">بازگشت به داشبورد</Link>
        </div>

        {error && <div className="mb-5 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}
        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-[#39FF14]/30 bg-[#39FF14]/10 p-6"><p className="text-sm text-gray-300">موجودی قابل استفاده</p><p className="mt-3 text-2xl font-bold text-[#39FF14]">{money(available)}</p></div>
          <div className="rounded-2xl border border-yellow-400/30 bg-yellow-400/10 p-6"><p className="text-sm text-gray-300">موجودی نگهداری‌شده</p><p className="mt-3 text-2xl font-bold text-yellow-300">{money(held)}</p></div>
          <div className="rounded-2xl border border-blue-400/30 bg-blue-400/10 p-6"><p className="text-sm text-gray-300">تعداد تراکنش‌ها</p><p className="mt-3 text-2xl font-bold text-blue-300">{entries.length.toLocaleString("fa-IR")}</p></div>
        </div>

        <section className="mb-6 rounded-2xl border border-white/10 bg-neutral-900/70 p-6">
          <h2 className="mb-4 text-xl font-bold text-[#39FF14]">حساب‌های داخلی من</h2>
          {loading ? <p className="text-gray-400">در حال بارگذاری...</p> : accounts.length === 0 ? <p className="text-gray-400">هنوز تراکنشی برای ساخت کیف پول ثبت نشده است.</p> : (
            <div className="grid gap-3 sm:grid-cols-2">
              {accounts.map((account) => <div key={account.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-4"><div><p className="font-bold">حساب اصلی</p><p className="mt-1 text-xs text-gray-500">{account.code}</p></div><p className="font-bold text-[#39FF14]">{money(balances[account.id] ?? 0)}</p></div>)}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-neutral-900/70 p-6">
          <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-bold text-[#39FF14]">تاریخچه تراکنش‌ها</h2><button onClick={() => void load()} className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-gray-300 hover:border-[#39FF14]/50 hover:text-[#39FF14]">به‌روزرسانی</button></div>
          {loading ? <p className="text-gray-400">در حال بارگذاری...</p> : entries.length === 0 ? <p className="text-gray-400">هنوز تراکنشی ثبت نشده است.</p> : <div className="space-y-3">{entries.map((entry) => { const amount = Math.abs(Number(entry.signed_amount)); const positive = entry.signed_amount >= 0; return <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 p-4"><div><p className="font-bold">{operationTitle[entry.reason] ?? entry.reason}</p><p className="mt-1 text-xs text-gray-500">{new Date(entry.created_at).toLocaleString("fa-IR")} {entry.source_id ? `· مرجع ${entry.source_id}` : ""}</p></div><p className={`font-bold ${positive ? "text-[#39FF14]" : "text-red-300"}`}>{`${positive ? "+" : "-"}${money(amount)}`}</p></div>; })}</div>}
        </section>
      </div>
    </main>
  );
}
