"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type DictionaryTerm = {
  id: number;
  alias: string;
  canonical_term: string;
  locale: "fa" | "en";
  context: "general" | "part" | "brand" | "model" | "symptom";
  category_id: number | null;
  is_active: boolean;
};
type Category = { id: number; name: string };

type DictionaryForm = {
  alias: string;
  canonical_term: string;
  locale: "fa" | "en";
  context: "general" | "part" | "brand" | "model" | "symptom";
  category_id: number | null;
  is_active: boolean;
};

const emptyForm: DictionaryForm = {
  alias: "",
  canonical_term: "",
  locale: "fa" as const,
  context: "general" as const,
  category_id: null,
  is_active: true,
};

export default function SearchDictionaryPage() {
  const [terms, setTerms] = useState<DictionaryTerm[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadTerms = useCallback(async () => {
    setLoading(true);
    const result = await supabase
      .from("search_dictionary_terms")
      .select("id,alias,canonical_term,locale,context,category_id,is_active")
      .order("id", { ascending: false });
    if (result.error) setError("واژه‌نامه قابل دریافت نیست");
    else setTerms((result.data ?? []) as DictionaryTerm[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase.from("search_dictionary_terms").select("id,alias,canonical_term,locale,context,category_id,is_active").order("id", { ascending: false }),
      supabase.from("categories").select("id,name").order("sort_order"),
    ]).then(([result, categoryResult]) => {
        if (cancelled) return;
        if (result.error) setError("واژه‌نامه قابل دریافت نیست");
        else setTerms((result.data ?? []) as DictionaryTerm[]);
        if (!categoryResult.error) setCategories((categoryResult.data ?? []) as Category[]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (form.alias.trim().length < 1 || form.canonical_term.trim().length < 1) {
      setError("هر دو واژهٔ ورودی و اصلی الزامی هستند");
      return;
    }
    setSaving(true);
    const result = editingId
      ? await supabase.rpc("admin_update_search_dictionary_term", {
          p_id: editingId,
          p_alias: form.alias,
          p_canonical_term: form.canonical_term,
          p_locale: form.locale,
          p_context: form.context,
          p_category_id: form.category_id,
          p_is_active: form.is_active,
        })
      : await supabase.rpc("admin_create_search_dictionary_term", {
          p_alias: form.alias,
          p_canonical_term: form.canonical_term,
          p_locale: form.locale,
          p_context: form.context,
          p_category_id: form.category_id,
          p_is_active: form.is_active,
        });
    setSaving(false);
    if (result.error) {
      setError(result.error.message === "dictionary_alias_exists" ? "این واژه قبلاً ثبت شده است" : "ذخیرهٔ واژه انجام نشد");
      return;
    }
    setMessage(editingId ? "واژه ویرایش شد" : "واژه اضافه شد");
    resetForm();
    await loadTerms();
  };

  const editTerm = (term: DictionaryTerm) => {
    setEditingId(term.id);
    setForm({
      alias: term.alias,
      canonical_term: term.canonical_term,
      locale: term.locale,
      context: term.context,
      category_id: term.category_id,
      is_active: term.is_active,
    });
    setError("");
    setMessage("");
  };

  const deleteTerm = async (term: DictionaryTerm) => {
    if (!window.confirm(`واژهٔ «${term.alias}» حذف شود؟`)) return;
    setError("");
    const result = await supabase.rpc("admin_delete_search_dictionary_term", { p_id: term.id });
    if (result.error) setError("حذف واژه انجام نشد");
    else {
      setMessage("واژه حذف شد");
      if (editingId === term.id) resetForm();
      await loadTerms();
    }
  };

  const reindexProducts = async () => {
    setReindexing(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/search/reindex", { method: "POST" });
      const result = await response.json();
      if (!response.ok) setError(result.error || "بازسازی embedding انجام نشد");
      else setMessage(`${result.indexed} محصول index شد؛ ${result.failed} مورد ناموفق بود`);
    } catch {
      setError("ارتباط با سرویس بازسازی برقرار نشد");
    } finally {
      setReindexing(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin" className="text-sm text-gray-400 hover:text-[#39FF14]">← بازگشت به داشبورد</Link>
          <h2 className="mt-3 text-2xl font-bold md:text-3xl">واژه‌نامهٔ <span className="text-[#39FF14]">جستجو</span></h2>
          <p className="mt-2 text-sm text-gray-400">مترادف‌ها و عبارت‌های تخصصی را بدون تغییر کد مدیریت کنید.</p>
        </div>
        <button type="button" onClick={reindexProducts} disabled={reindexing} className="rounded-lg border border-yellow-400/40 px-4 py-2 text-sm font-bold text-yellow-300 disabled:opacity-50">
          {reindexing ? "در حال index محصولات..." : "بازسازی embedding محصولات"}
        </button>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">❌ {error}</div>}
      {message && <div className="mb-4 rounded-lg border border-[#39FF14]/30 bg-[#39FF14]/5 px-4 py-3 text-sm text-[#39FF14]">✅ {message}</div>}

      <form onSubmit={handleSubmit} className="mb-8 grid gap-3 rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-5 md:grid-cols-[1fr_1fr_auto_auto_auto]">
        <input value={form.alias} onChange={(event) => setForm({ ...form, alias: event.target.value })} placeholder="واژهٔ مشتری، مثلاً لنت" className="rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-[#39FF14]" />
        <input value={form.canonical_term} onChange={(event) => setForm({ ...form, canonical_term: event.target.value })} placeholder="واژهٔ اصلی، مثلاً لنت ترمز" className="rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-[#39FF14]" />
        <select value={form.context} onChange={(event) => setForm({ ...form, context: event.target.value as typeof form.context })} className="rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-3 py-2 text-white">
          <option value="general">عمومی</option><option value="part">قطعه</option><option value="brand">برند</option><option value="model">مدل</option><option value="symptom">علائم</option>
        </select>
        <select value={form.category_id ?? ""} onChange={(event) => setForm({ ...form, category_id: event.target.value ? Number(event.target.value) : null })} className="rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-3 py-2 text-white">
          <option value="">همهٔ دسته‌ها</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="rounded-lg bg-[#39FF14] px-4 py-2 text-sm font-bold text-black disabled:opacity-50">{saving ? "در حال ذخیره..." : editingId ? "ذخیره ویرایش" : "افزودن"}</button>
          {editingId && <button type="button" onClick={resetForm} className="rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-300">لغو</button>}
        </div>
      </form>

      {loading ? <p className="text-gray-400">در حال بارگذاری...</p> : terms.length === 0 ? <p className="rounded-xl border border-[#39FF14]/20 p-8 text-center text-gray-400">هنوز واژه‌ای ثبت نشده است.</p> : (
        <div className="space-y-3">
          {terms.map((term) => (
            <div key={term.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#39FF14]/20 bg-neutral-900/60 p-4">
              <div className="min-w-[10rem] flex-1"><strong>{term.alias}</strong><span className="mx-2 text-gray-500">→</span><span className="text-[#39FF14]">{term.canonical_term}</span></div>
              <span className="text-xs text-gray-500">{term.context}</span>
              {!term.is_active && <span className="text-xs text-yellow-300">غیرفعال</span>}
              <button type="button" onClick={() => editTerm(term)} className="rounded border border-[#39FF14]/30 px-3 py-1 text-xs text-[#39FF14]">ویرایش</button>
              <button type="button" onClick={() => deleteTerm(term)} className="rounded border border-red-500/30 px-3 py-1 text-xs text-red-300">حذف</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
