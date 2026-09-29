import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import ProductCard from "@/components/ProductCard";
import { Logo } from "@/components/Logo";
import { CartIcon } from "@/components/CartIcon";
import type { Product } from "@/components/ProductCard";

export default async function ShopPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id,name,slug,brand,images,product_sellers(id,seller_id,seller_name,price,discount_price,stock,is_active,is_hidden_by_seller)")
    .eq("is_active", true);

  const products: Product[] = (data ?? []).map(row => {
    const offers = row.product_sellers.filter(o => o.is_active === true && o.is_hidden_by_seller === false && o.stock > 0 && o.price > 0)
      .sort((a,b) => (a.discount_price ?? a.price) - (b.discount_price ?? b.price));
    const offer = offers[0];
    return { id:row.id,name:row.name,slug:row.slug,brand:row.brand??"",images:row.images??[],
      offer_id:offer?.id,seller_id:offer?.seller_id,seller_name:offer?.seller_name,
      price:offer?.price??0,discount_price:offer?.discount_price??null,stock:offer?.stock??0 };
  });
  const countLabel = products.length.toLocaleString("fa-IR");

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
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
