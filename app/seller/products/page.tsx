"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Category = { id: number; name: string; slug: string };
type Product = {
  id: number;
  name: string;
  slug: string;
  brand: string | null;
  category_id: number | null;
  images: string[] | null;
  reference_price: number | null;
};
type SellerPrice = {
  product_id: number;
  price: number;
  stock: number;
  is_active: boolean;
  is_hidden_by_seller: boolean;
};

export default function SellerProductsPage() {
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [products, setProducts] = useState<Product[]>([]);
  const [myPrices, setMyPrices] = useState<Record<number, SellerPrice>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<number | "">("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const userId = localStorage.getItem("userId");
      if (!userId) {
        setLoading(false);
        return;
      }

      const [productsRes, pricesRes, catsRes] = await Promise.all([
        supabase
          .from("products")
          .select("id, name, slug, brand, reference_price, category_id, images")
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("product_sellers")
          .select("product_id, price, stock, is_active, is_hidden_by_seller")
          .eq("seller_id", userId),
        supabase.from("categories").select("id, name, slug").order("sort_order"),
      ]);

      if (productsRes.data) setProducts(productsRes.data as Product[]);
      if (catsRes.data) setCategories(catsRes.data as Category[]);

      if (pricesRes.data) {
        const map: Record<number, SellerPrice> = {};
        (pricesRes.data as SellerPrice[]).forEach((p) => {
          map[p.product_id] = p;
        });
        setMyPrices(map);
      }

      setLoading(false);
    };
    load();
  }, []);

  const filtered = products.filter((p) => {
    if (tab === "mine" && !myPrices[p.id]) return false;
    if (selectedCategory !== "" && p.category_id !== selectedCategory) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const matchName = p.name.toLowerCase().includes(q);
      const matchBrand = p.brand?.toLowerCase().includes(q) || false;
      const matchSlug = p.slug.toLowerCase().includes(q);
      if (!matchName && !matchBrand && !matchSlug) return false;
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

  const myCount = Object.keys(myPrices).length;
  const totalCount = products.length;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold md:text-3xl">
          <span className="text-[#39FF14]">لیست قطعات</span>
        </h2>
        <p className="mt-2 text-sm text-gray-400">
          محصولی که می‌خوای بفروشی رو انتخاب کن و براش قیمت بذار
        </p>
      </div>

      <div className="mb-6 flex gap-2 rounded-full border border-[#39FF14]/20 bg-neutral-900/60 p-1">
        <button
          type="button"
          onClick={() => setTab("all")}
          className={`flex-1 rounded-full px-4 py-2.5 text-sm font-bold transition ${
            tab === "all"
              ? "bg-[#39FF14] text-black"
              : "text-gray-400 hover:text-[#39FF14]"
          }`}
        >
          همه قطعات ({totalCount.toLocaleString("fa-IR")})
        </button>
        <button
          type="button"
          onClick={() => setTab("mine")}
          className={`flex-1 rounded-full px-4 py-2.5 text-sm font-bold transition ${
            tab === "mine"
              ? "bg-[#39FF14] text-black"
              : "text-gray-400 hover:text-[#39FF14]"
          }`}
        >
          محصولات من ({myCount.toLocaleString("fa-IR")})
        </button>
      </div>

      <div className="mb-6 grid gap-3 md:grid-cols-2">
        <div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 جستجو با نام محصول، برند یا slug..."
            className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
          />
        </div>
        <div>
          <select
            value={selectedCategory}
            onChange={(e) =>
              setSelectedCategory(e.target.value === "" ? "" : Number(e.target.value))
            }
            className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none focus:border-[#39FF14]"
          >
            <option value="">— همه دسته‌بندی‌ها —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-12 text-center text-gray-400">
          {tab === "mine"
            ? "هنوز محصولی قیمت‌گذاری نکردی. از تب «همه قطعات» شروع کن."
            : "محصولی با این فیلترها پیدا نشد"}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => {
            const myPrice = myPrices[p.id];
            const imageSrc = (p.images ?? []).find((s) => s && s.trim().length > 0);

            return (
              <Link
                key={p.id}
                href={`/seller/products/${p.id}`}
                className="group flex flex-wrap items-center gap-4 rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-4 transition hover:border-[#39FF14]/70 hover:shadow-[0_0_25px_rgba(57,255,20,0.15)]"
              >
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

                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-white transition group-hover:text-[#39FF14]">
                    {p.name}
                  </h3>
                  <p className="mt-1 text-xs text-gray-400">
                    {p.brand || "بدون برند"} • slug: {p.slug}
                  </p>
                  {p.reference_price && (
                    <p className="mt-1 text-xs text-gray-500">
                      قیمت مرجع بازار: {formatPrice(p.reference_price)} تومان
                    </p>
                  )}
                </div>

                <div className="text-left">
                  {myPrice ? (
                    <div>
                      <span className="inline-block rounded-full border border-[#39FF14]/40 bg-[#39FF14]/10 px-3 py-1 text-xs font-bold text-[#39FF14]">
                        ✅ قیمت‌گذاری شده
                      </span>
                      <p className="mt-1 text-xs text-gray-300">
                        قیمت شما: {formatPrice(myPrice.price)} تومان
                      </p>
                      <p className="text-xs text-gray-500">
                        موجودی: {myPrice.stock.toLocaleString("fa-IR")}
                      </p>
                    </div>
                  ) : (
                    <span className="inline-block rounded-full border border-yellow-500/40 bg-yellow-500/10 px-3 py-1 text-xs font-bold text-yellow-400">
                      💰 قیمت‌گذاری نشده
                    </span>
                  )}
                </div>

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