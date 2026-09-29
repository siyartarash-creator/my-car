"use client";
import { getCurrentUserId } from "@/lib/auth-client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type MyProduct = {
  id: number;
  product_id: number;
  price: number;
  discount_price: number | null;
  stock: number;
  is_active: boolean;
  is_hidden_by_seller: boolean;
  warranty: string | null;
  shipping: string | null;
  notes: string | null;
  products: {
    id: number;
    name: string;
    slug: string;
    brand: string | null;
    reference_price: number | null;
    images: string[] | null;
  } | null;
};

export default function MyProductsPage() {
  const [items, setItems] = useState<MyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive" | "outofstock">("all");

  useEffect(() => {
    const load = async () => {
      const userId = await getCurrentUserId();
      if (!userId) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("product_sellers")
        .select(
          `
          id, product_id, price, discount_price, stock, 
          is_active, is_hidden_by_seller, warranty, shipping, notes,
          products (id, name, slug, brand, reference_price, images)
        `
        )
        .eq("seller_id", userId)
        .order("id", { ascending: false });

      if (!error && data) {
        setItems(data as unknown as MyProduct[]);
      }
      setLoading(false);
    };
    load();
  }, []);

  const filtered = items.filter((item) => {
    // فیلتر وضعیت
    if (filter === "active" && !item.is_active) return false;
    if (filter === "inactive" && item.is_active) return false;
    if (filter === "outofstock" && item.stock > 0) return false;

    // جستجو
    if (search.trim() && item.products) {
      const q = search.trim().toLowerCase();
      const matchName = item.products.name.toLowerCase().includes(q);
      const matchBrand = item.products.brand?.toLowerCase().includes(q) || false;
      if (!matchName && !matchBrand) return false;
    }

    return true;
  });

  const formatPrice = (n: number) => n.toLocaleString("fa-IR");

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-gray-400">
        در حال بارگذاری...
      </div>
    );
  }

  // آمار
  const totalItems = items.length;
  const activeItems = items.filter((i) => i.is_active && i.stock > 0).length;
  const outOfStock = items.filter((i) => i.stock === 0).length;
  const totalStock = items.reduce((sum, i) => sum + (i.stock || 0), 0);

  return (
    <div>
      {/* عنوان */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold md:text-3xl">
          <span className="text-[#39FF14]">محصولات من</span>
        </h2>
        <p className="mt-2 text-sm text-gray-400">
          محصولاتی که قیمت‌گذاری کردی اینجا نمایش داده می‌شن
        </p>
      </div>

      {/* آمار */}
      {items.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-[#39FF14]/20 bg-neutral-900/60 p-4">
            <p className="text-xs text-gray-400">کل محصولات</p>
            <p className="mt-1 text-2xl font-bold text-[#39FF14]">
              {totalItems.toLocaleString("fa-IR")}
            </p>
          </div>
          <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
            <p className="text-xs text-gray-400">فعال و موجود</p>
            <p className="mt-1 text-2xl font-bold text-green-400">
              {activeItems.toLocaleString("fa-IR")}
            </p>
          </div>
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
            <p className="text-xs text-gray-400">ناموجود</p>
            <p className="mt-1 text-2xl font-bold text-red-400">
              {outOfStock.toLocaleString("fa-IR")}
            </p>
          </div>
          <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
            <p className="text-xs text-gray-400">موجودی کل</p>
            <p className="mt-1 text-2xl font-bold text-yellow-400">
              {totalStock.toLocaleString("fa-IR")}
            </p>
          </div>
        </div>
      )}

      {/* فیلتر و جستجو */}
      {items.length > 0 && (
        <div className="mb-6 space-y-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 جستجو در محصولات من..."
            className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
          />

          <div className="flex flex-wrap gap-2">
            {[
              { id: "all", label: "همه", count: totalItems },
              { id: "active", label: "فعال", count: activeItems },
              { id: "outofstock", label: "ناموجود", count: outOfStock },
              {
                id: "inactive",
                label: "غیرفعال",
                count: items.filter((i) => !i.is_active).length,
              },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id as typeof filter)}
                className={`rounded-full border px-4 py-2 text-sm font-bold transition ${
                  filter === f.id
                    ? "border-[#39FF14] bg-[#39FF14] text-black"
                    : "border-[#39FF14]/20 text-gray-300 hover:border-[#39FF14]/60"
                }`}
              >
                {f.label} ({f.count.toLocaleString("fa-IR")})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* لیست */}
      {items.length === 0 ? (
        <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-12 text-center">
          <div className="mb-4 text-6xl">📦</div>
          <p className="mb-2 text-lg font-bold text-white">
            هنوز محصولی قیمت‌گذاری نکردی
          </p>
          <p className="mb-6 text-sm text-gray-400">
            از لیست قطعات، محصولات موجود خودت رو قیمت‌گذاری کن
          </p>
          <Link
            href="/seller/products"
            className="inline-block rounded-lg bg-[#39FF14] px-6 py-3 font-bold text-black shadow-[0_0_20px_rgba(57,255,20,0.5)] transition hover:bg-[#39FF14]/90"
          >
            🔍 مشاهده لیست قطعات
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-12 text-center text-gray-400">
          محصولی با این فیلترها پیدا نشد
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            if (!item.products) return null;

            const p = item.products;
            const imageSrc = (p.images ?? []).find((s) => s && s.trim().length > 0);
            const hasDiscount =
              item.discount_price && item.discount_price < item.price;
            const isOutOfStock = item.stock === 0;

            return (
              <Link
                key={item.id}
                href={`/seller/products/${item.product_id}`}
                className="group flex flex-wrap items-center gap-4 rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-4 transition hover:border-[#39FF14]/70 hover:shadow-[0_0_25px_rgba(57,255,20,0.15)]"
              >
                {/* عکس */}
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#39FF14]/20 bg-neutral-950 text-2xl">
                  {imageSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageSrc}
                      alt={p.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span>🛒</span>
                  )}
                </div>

                {/* اطلاعات */}
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-white transition group-hover:text-[#39FF14]">
                    {p.name}
                  </h3>
                  <p className="mt-1 text-xs text-gray-400">
                    {p.brand || "بدون برند"}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {!item.is_active && (
                      <span className="rounded-full border border-gray-500/40 bg-gray-500/10 px-2 py-0.5 text-[10px] text-gray-400">
                        غیرفعال
                      </span>
                    )}
                    {isOutOfStock && (
                      <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-400">
                        ناموجود
                      </span>
                    )}
                    {item.is_hidden_by_seller && (
                      <span className="rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-[10px] text-yellow-400">
                        مخفی
                      </span>
                    )}
                    {item.warranty && (
                      <span className="rounded-full border border-[#39FF14]/30 bg-[#39FF14]/5 px-2 py-0.5 text-[10px] text-[#39FF14]">
                        🛡️ {item.warranty}
                      </span>
                    )}
                  </div>
                </div>

                {/* قیمت */}
                <div className="text-left">
                  {hasDiscount ? (
                    <div>
                      <p className="text-xs text-gray-500 line-through">
                        {formatPrice(item.price)}
                      </p>
                      <p className="font-bold text-[#39FF14]">
                        {formatPrice(item.discount_price!)} تومان
                      </p>
                    </div>
                  ) : (
                    <p className="font-bold text-white">
                      {formatPrice(item.price)} تومان
                    </p>
                  )}
                  <p className="mt-1 text-xs text-gray-400">
                    موجودی:{" "}
                    <span
                      className={
                        isOutOfStock
                          ? "font-bold text-red-400"
                          : "font-bold text-[#39FF14]"
                      }
                    >
                      {item.stock.toLocaleString("fa-IR")}
                    </span>
                  </p>
                </div>

                {/* فلش */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 rotate-180 text-gray-500 transition group-hover:text-[#39FF14]"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}