import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import ProductCard from "@/components/ProductCard";
import { ShopFilters } from "@/components/ShopFilters";
import { Logo } from "@/components/Logo";
import { CartIcon } from "@/components/CartIcon";
import type { Product } from "@/components/ProductCard";

const PAGE_SIZE = 24;
const SORT_KEYS = ["newest", "price_asc", "price_desc", "name_asc"] as const;
type SortKey = (typeof SORT_KEYS)[number];

// PostgREST or-filter values need commas/parens/quotes escaped since they are
// structural characters in its filter syntax; wrapping in quotes and escaping
// backslashes/quotes keeps arbitrary user search text a single ilike value.
function escapeOrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Repeated query params (?q=a&q=b) make Next hand back string[] instead of
// string; take the first value so a malformed/duplicated param never crashes
// the page instead of being treated as a normal single value.
function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

type CatalogRow = {
  id: number;
  name: string;
  slug: string;
  brand: string | null;
  images: string[] | null;
  offer_id: number | null;
  seller_id: string | null;
  seller_name: string | null;
  price: number | null;
  discount_price: number | null;
  stock: number | null;
};

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    category?: string | string[];
    sort?: string | string[];
    page?: string | string[];
  }>;
}) {
  const sp = await searchParams;
  const q = firstParam(sp.q).trim();
  const categoryParam = firstParam(sp.category);
  const categoryId = categoryParam && /^\d+$/.test(categoryParam) ? Number(categoryParam) : null;
  const sortParam = firstParam(sp.sort);
  const sort: SortKey = (SORT_KEYS as readonly string[]).includes(sortParam)
    ? (sortParam as SortKey)
    : "newest";
  const page = Math.max(1, Number.parseInt(firstParam(sp.page) || "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = await createClient();

  let query = supabase
    .from("shop_catalog")
    .select(
      "id,name,slug,brand,part_number,images,category_id,offer_id,seller_id,seller_name,price,discount_price,stock",
      { count: "exact" }
    );

  if (q) {
    const esc = escapeOrValue(q);
    query = query.or(`name.ilike."%${esc}%",brand.ilike."%${esc}%",part_number.ilike."%${esc}%"`);
  }
  if (categoryId != null) query = query.eq("category_id", categoryId);

  // Primary sort columns are not unique (ties on price/name/created_at are
  // common, e.g. a bulk seed insert shares one created_at across rows), so a
  // secondary order on the Product id -- already unique and stable -- is
  // required before range/offset pagination, or rows can shift between
  // pages or repeat/skip across them.
  if (sort === "price_asc") query = query.order("display_price", { ascending: true, nullsFirst: false });
  else if (sort === "price_desc") query = query.order("display_price", { ascending: false, nullsFirst: false });
  else if (sort === "name_asc") query = query.order("name", { ascending: true });
  else query = query.order("created_at", { ascending: false });
  query = query.order("id", { ascending: true });

  query = query.range(from, to);

  const [{ data, error, count }, { data: categoriesData }] = await Promise.all([
    query,
    supabase.from("categories").select("id,name").order("sort_order"),
  ]);

  const rows = (data ?? []) as CatalogRow[];
  const products: Product[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    brand: row.brand ?? "",
    images: row.images ?? [],
    offer_id: row.offer_id ?? undefined,
    seller_id: row.seller_id ?? undefined,
    seller_name: row.seller_name ?? undefined,
    price: row.price ?? 0,
    discount_price: row.discount_price,
    stock: row.stock ?? 0,
  }));
  const categories = categoriesData ?? [];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const countLabel = total.toLocaleString("fa-IR");

  const hrefFor = (targetPage: number) => {
    const usp = new URLSearchParams();
    if (q) usp.set("q", q);
    if (categoryId != null) usp.set("category", String(categoryId));
    if (sort !== "newest") usp.set("sort", sort);
    if (targetPage > 1) usp.set("page", String(targetPage));
    const query = usp.toString();
    return query ? `/shop?${query}` : "/shop";
  };

  return (
    <main
      dir="rtl"
      className="relative min-h-screen overflow-hidden bg-neutral-950 text-white"
    >
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

            <div className="flex items-center gap-3">
              <CartIcon />
              <Link
                href="/"
                className="rounded-full border border-[#39FF14]/40 px-4 py-2 text-sm font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10 hover:shadow-[0_0_20px_rgba(57,255,20,0.3)]"
              >
                بازگشت به خانه
              </Link>
            </div>
          </div>
        </header>

        <section className="mx-auto max-w-7xl px-6 py-12">
          <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-3xl font-bold md:text-4xl">
                فروشگاه <span className="text-[#39FF14]">قطعات خودرو</span>
              </h2>
              <p className="mt-2 text-gray-400">
                قطعات برقی، بدنه، موتور و لوازم جانبی با ضمانت
              </p>
            </div>
            {!error && (
              <p className="rounded-full border border-[#39FF14]/30 bg-[#39FF14]/5 px-4 py-1.5 text-sm text-[#39FF14]">
                {countLabel} محصول
              </p>
            )}
          </div>

          <ShopFilters
            categories={categories}
            params={{ q: q || undefined, category: categoryId != null ? String(categoryId) : undefined, sort }}
          />

          {error ? (
            <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-8 text-center">
              <p className="mb-2 text-lg font-bold text-red-400">خطا در دریافت محصولات</p>
              <p className="text-sm text-gray-400">{error.message}</p>
            </div>
          ) : products.length === 0 ? (
            <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-12 text-center text-gray-400">
              محصولی یافت نشد
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {products.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="mt-10 flex items-center justify-center gap-3">
                  <Link
                    href={hrefFor(page - 1)}
                    aria-disabled={page <= 1}
                    className={`rounded-lg border border-[#39FF14]/40 px-5 py-2.5 text-sm font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10 ${
                      page <= 1 ? "pointer-events-none opacity-30" : ""
                    }`}
                  >
                    قبلی
                  </Link>
                  <span className="text-sm text-gray-400">
                    صفحه {page.toLocaleString("fa-IR")} از {totalPages.toLocaleString("fa-IR")}
                  </span>
                  <Link
                    href={hrefFor(page + 1)}
                    aria-disabled={page >= totalPages}
                    className={`rounded-lg border border-[#39FF14]/40 px-5 py-2.5 text-sm font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10 ${
                      page >= totalPages ? "pointer-events-none opacity-30" : ""
                    }`}
                  >
                    بعدی
                  </Link>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
