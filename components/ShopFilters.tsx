"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";

export type Category = { id: number; name: string };
export type ShopFilterParams = { q?: string; category?: string; sort?: string };

const sortOptions: { value: string; label: string }[] = [
  { value: "newest", label: "جدیدترین" },
  { value: "price_asc", label: "ارزان‌ترین" },
  { value: "price_desc", label: "گران‌ترین" },
  { value: "name_asc", label: "نام (الف تا ی)" },
];

export function ShopFilters({
  categories,
  params,
}: {
  categories: Category[];
  params: ShopFilterParams;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(params.q ?? "");

  const navigate = (updates: Partial<ShopFilterParams>) => {
    const next: ShopFilterParams = { ...params, ...updates };
    const usp = new URLSearchParams();
    if (next.q) usp.set("q", next.q);
    if (next.category) usp.set("category", next.category);
    if (next.sort && next.sort !== "newest") usp.set("sort", next.sort);
    const query = usp.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate({ q: q.trim() });
  };

  return (
    <form onSubmit={handleSubmit} className="mb-8 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="🔍 جستجو با نام، برند یا کد فنی..."
        className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
      />
      <select
        value={params.category ?? ""}
        onChange={(e) => navigate({ category: e.target.value || undefined })}
        className="rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none focus:border-[#39FF14]"
      >
        <option value="">همه دسته‌بندی‌ها</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select
        value={params.sort ?? "newest"}
        onChange={(e) => navigate({ sort: e.target.value })}
        className="rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none focus:border-[#39FF14]"
      >
        {sortOptions.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </form>
  );
}

export default ShopFilters;
