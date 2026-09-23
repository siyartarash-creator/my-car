import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default async function AdminProductsPage() {
  const { data, error } = await supabase
    .from("products")
    .select("id, name, slug, brand, price, discount_price, stock, is_active, is_featured, images")
    .order("id", { ascending: false });

  const products = data ?? [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold md:text-3xl">
            مدیریت <span className="text-[#39FF14]">محصولات</span>
          </h2>
          <p className="mt-1 text-sm text-gray-400">
            {products.length.toLocaleString("fa-IR")} محصول
          </p>
        </div>
        <Link
          href="/admin/products/new"
          className="rounded-lg bg-[#39FF14] px-5 py-2.5 text-sm font-bold text-black transition hover:bg-[#39FF14]/90"
        >
          ➕ افزودن محصول
        </Link>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-center text-red-400">
          خطا: {error.message}
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-12 text-center text-gray-400">
          هنوز محصولی ثبت نشده. اولین محصولت رو اضافه کن!
        </div>
      ) : (
        <div className="space-y-3">
          {products.map((p) => {
            const hasDiscount = p.discount_price && p.discount_price < p.price;
            const imageSrc = (p.images as string[] | null)?.find((s) => s && s.trim().length > 0);
            return (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-4 rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-4 transition hover:border-[#39FF14]/50"
              >
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#39FF14]/20 bg-neutral-950 text-2xl">
                  {imageSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imageSrc} alt={p.name} className="h-full w-full object-cover" />
                  ) : (
                    <span>🛒</span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-white">{p.name}</h3>
                    {p.is_featured && (
                      <span className="rounded-full border border-yellow-400/40 bg-yellow-400/10 px-2 py-0.5 text-[10px] text-yellow-400">
                        ویژه
                      </span>
                    )}
                    {!p.is_active && (
                      <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-400">
                        غیرفعال
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    برند: {p.brand} • slug: {p.slug}
                  </p>
                </div>

                <div className="flex items-center gap-4 text-sm">
                  <div>
                    {hasDiscount ? (
                      <div className="flex flex-col">
                        <span className="text-xs text-gray-500 line-through">
                          {p.price.toLocaleString("fa-IR")}
                        </span>
                        <span className="font-bold text-[#39FF14]">
                          {p.discount_price!.toLocaleString("fa-IR")} تومان
                        </span>
                      </div>
                    ) : (
                      <span className="font-bold text-white">
                        {p.price.toLocaleString("fa-IR")} تومان
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400">
                    موجودی: <span className="font-bold text-gray-200">{p.stock.toLocaleString("fa-IR")}</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Link
                    href={`/shop/${p.slug}`}
                    target="_blank"
                    className="rounded-lg border border-[#39FF14]/30 px-3 py-1.5 text-xs text-[#39FF14] transition hover:bg-[#39FF14]/10"
                  >
                    👁️
                  </Link>
                  <Link
                    href={`/admin/products/${p.id}/edit`}
                    className="rounded-lg border border-[#39FF14]/30 px-3 py-1.5 text-xs text-[#39FF14] transition hover:bg-[#39FF14]/10"
                  >
                    ✏️
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}