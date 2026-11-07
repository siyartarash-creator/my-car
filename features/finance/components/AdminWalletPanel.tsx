"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Profile = { id: string; name: string; mobile: string; user_type: string };
type Account = { id: string; profile_id: string | null; kind: string; code: string | null; is_active: boolean };
type LedgerEntry = { id: string; account_id: string; signed_amount: number; reason: string; source_type: string; source_id: string | null; created_at: string };

async function loadEntries() {
  const pageSize = 1000;
  const entries: LedgerEntry[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("ledger_entries")
      .select("id,account_id,signed_amount,reason,source_type,source_id,created_at")
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error("entries");
    entries.push(...((data ?? []) as LedgerEntry[]));
    if ((data ?? []).length < pageSize) return entries;
  }
}

async function loadHeld(userId: string) {
  const { data, error } = await supabase.from("orders").select("final_price").eq("user_id", userId).eq("escrow_status", "held");
  if (error) throw new Error("held");
  return (data ?? []).reduce((sum, order) => sum + Number(order.final_price ?? 0), 0);
}

const money = (value: number) => `${new Intl.NumberFormat("fa-IR").format(value)} تومان`;
const reasonTitle: Record<string, string> = { admin_charge: "شارژ دستی", order_wallet_payment: "پرداخت از کیف پول" };

async function write(action: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/write/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.code || "عملیات انجام نشد");
  return data;
}

export function AdminWalletPanel() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountBalances, setAccountBalances] = useState<Record<string, number>>({});
  const [customerBalances, setCustomerBalances] = useState({ available: 0, held: 0 });
  const [transactions, setTransactions] = useState<LedgerEntry[]>([]);
  const [selectedUser, setSelectedUser] = useState("");
  const [creditAmount, setCreditAmount] = useState("400000");
  const [creditReason, setCreditReason] = useState("شارژ تست کیف پول");
  const [creditReference, setCreditReference] = useState("CREDIT-TEST-001");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    const requestedUser = selectedUser;
    setLoading(true);
    setError("");
    try {
      const [profilesResult, accountsResult] = await Promise.all([
        supabase.from("profiles").select("id,name,mobile,user_type").order("name"),
        supabase.from("ledger_accounts").select("id,profile_id,kind,code,is_active").order("created_at"),
      ]);
      const nextEntries = await loadEntries();
      if (profilesResult.error || accountsResult.error) throw new Error("load");
      if (generation !== loadGeneration.current) return;
      setProfiles((profilesResult.data ?? []) as Profile[]);
      if (!selectedUser) setSelectedUser(profilesResult.data?.find((profile) => profile.user_type === "owner")?.id ?? profilesResult.data?.[0]?.id ?? "");
      const nextAccounts = (accountsResult.data ?? []) as Account[];
       if (generation !== loadGeneration.current) return;
      const nextBalances: Record<string, number> = {};
      for (const entry of nextEntries) nextBalances[entry.account_id] = (nextBalances[entry.account_id] ?? 0) + Number(entry.signed_amount);
      setAccounts(nextAccounts);
      setAccountBalances(nextBalances);
      setTransactions(nextEntries);
      if (requestedUser) {
        const customerAccountIds = nextAccounts.filter((account) => account.profile_id === requestedUser && account.kind === "profile").map((account) => account.id);
         const available = customerAccountIds.reduce((sum, accountId) => sum + (nextBalances[accountId] ?? 0), 0);
         const held = await loadHeld(requestedUser);
         setCustomerBalances({ available, held });
      }
    } catch { if (generation === loadGeneration.current) { setCustomerBalances({ available: 0, held: 0 }); setError("اطلاعات مالی بارگذاری نشد"); } } finally { if (generation === loadGeneration.current) setLoading(false); }
  }, [selectedUser]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const run = async (action: string, body: Record<string, unknown>, success: string) => {
    setBusy(true); setError(""); setMessage("");
    try { await write(action, body); setMessage(success); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "عملیات انجام نشد"); } finally { setBusy(false); }
  };

  return (
    <div dir="rtl">
      <div className="mb-8"><p className="mb-2 text-sm text-[#39FF14]">MY CAR / کنترل مالی</p><h2 className="text-2xl font-bold md:text-3xl">مدیریت کیف پول</h2><p className="mt-2 text-gray-400">این بخش برای تست مالی است و به checkout وصل نیست.</p></div>
      {message && <div className="mb-4 rounded-xl border border-[#39FF14]/40 bg-[#39FF14]/10 p-4 text-sm text-[#39FF14]">{message}</div>}
      {error && <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}

       <section className="mb-6 rounded-2xl border border-yellow-400/30 bg-neutral-900/70 p-6">
        <h3 className="mb-4 text-lg font-bold text-yellow-300">حساب‌های داخلی MY CAR</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{accounts.filter((account) => account.kind !== "profile").map((account) => <div key={account.id} className="rounded-xl border border-white/10 p-4"><p className="font-bold">حساب پلتفرم</p><p className="mt-2 text-xl font-bold text-yellow-300">{money(accountBalances[account.id] ?? 0)}</p><p className="mt-1 text-xs text-gray-500">{account.code}</p></div>)}</div>
      </section>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[#39FF14]/30 bg-neutral-900/70 p-6">
          <h3 className="mb-4 text-lg font-bold text-[#39FF14]">شارژ دستی کیف پول</h3>
          <div className="space-y-3">
            <select value={selectedUser} onChange={(event) => { setSelectedUser(event.target.value); setCustomerBalances({ available: 0, held: 0 }); }} className="w-full rounded-lg border border-white/15 bg-black/30 p-3 text-white"><option value="">انتخاب کاربر</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} — {profile.mobile}</option>)}</select>
             <input value={creditAmount} onChange={(event) => setCreditAmount(event.target.value)} inputMode="numeric" placeholder="مبلغ به تومان" className="w-full rounded-lg border border-white/15 bg-black/30 p-3 text-white" />
            <input value={creditReason} onChange={(event) => setCreditReason(event.target.value)} placeholder="دلیل شارژ" className="w-full rounded-lg border border-white/15 bg-black/30 p-3 text-white" />
            <input value={creditReference} onChange={(event) => setCreditReference(event.target.value)} placeholder="شماره مرجع" className="w-full rounded-lg border border-white/15 bg-black/30 p-3 text-white" />
            <button disabled={busy || loading || !selectedUser} onClick={() => void run("manual_credit", { user_id: selectedUser, amount: Number(creditAmount), reason: creditReason, reference: creditReference, key: crypto.randomUUID() }, "شارژ دستی ثبت شد")} className="w-full rounded-lg bg-[#39FF14] px-4 py-3 font-bold text-black disabled:cursor-not-allowed disabled:opacity-40">ثبت شارژ دستی</button>
          </div>
        </section>

         <section className="rounded-2xl border border-red-400/30 bg-neutral-900/70 p-6"><h3 className="mb-4 text-lg font-bold text-red-300">وضعیت امداد مالی</h3><p className="text-sm leading-6 text-gray-400">ماژول قدیمی امداد کیف پول در staging وجود ندارد؛ چرخهٔ امداد عملیاتی جداگانه با RPCهای rescue تست شده است.</p></section>
      </div>

      <section className="mb-6 rounded-2xl border border-blue-400/30 bg-blue-400/5 p-6">
        <h3 className="mb-4 text-lg font-bold text-blue-300">کیف پول کاربر انتخاب‌شده</h3>
        <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-white/10 p-4"><p className="text-sm text-gray-400">قابل استفاده</p><p className="mt-2 text-xl font-bold text-blue-300">{money(customerBalances.available)}</p></div><div className="rounded-xl border border-white/10 p-4"><p className="text-sm text-gray-400">نگهداری‌شده</p><p className="mt-2 text-xl font-bold text-yellow-300">{money(customerBalances.held)}</p></div></div>
      </section>

       <section className="rounded-2xl border border-white/10 bg-neutral-900/70 p-6">
         <h3 className="mb-4 text-lg font-bold text-[#39FF14]">تراکنش‌های ledger</h3>
         {loading ? <p className="text-gray-400">در حال بارگذاری...</p> : transactions.length === 0 ? <p className="text-gray-400">هنوز تراکنشی ثبت نشده است.</p> : <div className="space-y-3">{transactions.slice(0, 50).map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 p-4"><div><p className="font-bold">{reasonTitle[entry.reason] ?? entry.reason}</p><p className="mt-1 text-xs text-gray-500">{entry.source_type} · {new Date(entry.created_at).toLocaleString("fa-IR")}</p></div><span className={`font-bold ${entry.signed_amount >= 0 ? "text-[#39FF14]" : "text-red-300"}`}>{entry.signed_amount >= 0 ? "+" : "-"}{money(Math.abs(Number(entry.signed_amount)))}</span></div>)}</div>}
      </section>
    </div>
  );
}
