import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { Logo } from "@/components/Logo";
import { CartIcon } from "@/components/CartIcon";
import { ProductBuyPanel } from "@/components/ProductCard";

type ProductRow = {
  id: number;
  name: string;
  slug: string;
  brand: string | null;
  description: string | null;
  short_description: string | null;
  reference_price: number | null;
  stock: number | null;
  price: number | null;
  discount_price: number | null;
  images: string[] | null;
  specs: Record<string, unknown> | null;
};

type SellerRow = {
  id: number;
  seller_id: string;
  seller_name: string;
  price: number;
  discount_price: number | null;
  stock: number;
  warranty: string | null;
  shipping: string | null;
  notes: string | null;
};

async function getProduct(slug: string): Promise<ProductRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, name, slug, brand, description, short_description, reference_price, stock, price, discount_price, images, specs"
    )
    .eq("slug", slug)
    .eq("is_active", true)
    .single();

  if (error || !data) return null;
  return data as ProductRow;
}

async function getSellers(productId: number): Promise<SellerRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_sellers")
    .select(
      "id, seller_id, seller_name, price, discount_price, stock, warranty, shipping, notes"
    )
    .eq("product_id", productId)
    .eq("is_active", true)
    .eq("is_hidden_by_seller", false)
    .gt("stock", 0)
    .order("price", { ascending: true });

  if (error) return [];
  return (data ?? []) as SellerRow[];
}

function formatToman(amount: number): string {
  return `${amount.toLocaleString("fa-IR")} تومان`;
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProduct(slug);

  if (!product) {
    notFound();
  }

  const sellers = await getSellers(product.id);
  const imageSrc =
    (product.images ?? []).find((s) => s && s.trim().length > 0) ?? null;

  const cheapestPrice = sellers.length > 0 ? sellers[0].price : null;

  return (
    <main className="min-h-screen bg-neutral-950 text-white" dir="rtl">
      {/* پس‌زمینه */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(#39FF14 1px, transparent 1px), linear-gradient(90deg, #39FF14 1px, transparent 1px)",
            backgroundSize: "50px 50px",
          }}
        />
        <div className="absolute -top-40 right-0 h-[400px] w-[600px] rounded-full bg-[#39FF14]/15 blur-[120px]" />
      </div>

      <div className="relative z-10">
        {/* هدر */}
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
                href="/shop"
                className="rounded-full border border-[#39FF14]/40 px-4 py-2 text-sm font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10"
              >
                بازگشت به فروشگاه
              </Link>
            </div>
          </div>
        </header>

        {/* مسیر */}
        <div className="mx-auto max-w-7xl px-6 pt-6 text-xs text-gray-500">
          <Link href="/" className="transition hover:text-[#39FF14]">
            خانه
          </Link>
          <span className="mx-2">/</span>
          <Link href="/shop" className="transition hover:text-[#39FF14]">
            فروشگاه
          </Link>
          <span className="mx-2">/</span>
          <span className="text-gray-300">{product.name}</span>
        </div>

        {/* محتوا */}
        <section className="mx-auto max-w-7xl px-6 py-8">
          <div className="grid gap-8 lg:grid-cols-2">
            {/* ستون چپ: گالری + اطلاعات */}
            <div className="space-y-6">
              {/* گالری */}
              <div className="relative mx-auto h-[400px] w-full overflow-hidden rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60">
                {imageSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageSrc}
                    alt={product.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-8xl">
                    🛒
                  </div>
                )}
              </div>

              {/* نام و برند */}
              <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6">
                <h2 className="mb-2 text-2xl font-bold md:text-3xl">
                  {product.name}
                </h2>
                {product.brand && (
                  <p className="text-sm text-gray-400">برند: {product.brand}</p>
                )}
                {product.short_description && (
                  <p className="mt-3 text-sm leading-relaxed text-gray-300">
                    {product.short_description}
                  </p>
                )}
              </div>

              {/* توضیحات */}
              {product.description && (
                <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6">
                  <h3 className="mb-3 text-lg font-bold text-[#39FF14]">
                    توضیحات
                  </h3>
                  <p className="whitespace-pre-line text-sm leading-relaxed text-gray-300">
                    {product.description}
                  </p>
                </div>
              )}

              {/* مشخصات فنی */}
              <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-6">
                <h3 className="mb-3 text-lg font-bold text-[#39FF14]">
                  مشخصات فنی
                </h3>
                {product.specs && Object.keys(product.specs).length > 0 ? (
                  <ul className="space-y-2 text-sm">
                    {Object.entries(product.specs).map(([key, value]) => (
                      <li
                        key={key}
                        className="flex justify-between border-b border-[#39FF14]/10 pb-2"
                      >
                        <span className="text-gray-400">{key}</span>
                        <span className="text-gray-200">{String(value)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500">
                    مشخصات فنی ثبت نشده است.
                  </p>
                )}
              </div>
            </div>

            {/* ستون راست: فروشندگان */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-[#39FF14]">
                  فروشندگان این محصول
                </h3>
                {sellers.length > 0 && (
                  <span className="rounded-full border border-[#39FF14]/30 bg-[#39FF14]/5 px-3 py-1 text-xs font-bold text-[#39FF14]">
                    {sellers.length.toLocaleString("fa-IR")} فروشنده
                  </span>
                )}
              </div>

              {/* خلاصه قیمت */}
              {cheapestPrice && (
                <div className="rounded-2xl border border-[#39FF14]/40 bg-[#39FF14]/5 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">
                      ارزان‌ترین قیمت:
                    </span>
                    <span className="text-lg font-bold text-[#39FF14]">
                      {formatToman(cheapestPrice)}
                    </span>
                  </div>
                </div>
              )}

              {sellers.length === 0 ? (
                <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-8 text-center">
                  <div className="mb-3 text-4xl">😔</div>
                  <p className="text-sm text-gray-400">
                    فروشنده‌ای برای این محصول موجود نیست
                  </p>
                  <p className="mt-2 text-xs text-gray-500">
                    می‌تونی به زودی از فروشنده‌های دیگه ببینی
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {sellers.map((seller, index) => (
                    <div
                      key={seller.id}
                      className={`rounded-2xl border p-5 transition ${
                        index === 0
                          ? "border-[#39FF14]/60 bg-[#39FF14]/5 shadow-[0_0_25px_rgba(57,255,20,0.15)]"
                          : "border-[#39FF14]/20 bg-neutral-900/60 hover:border-[#39FF14]/50"
                      }`}
                    >
                      {/* بج ارزان‌ترین */}
                      {index === 0 && sellers.length > 1 && (
                        <div className="mb-3">
                          <span className="rounded-full bg-[#39FF14] px-3 py-0.5 text-[10px] font-bold text-black">
                            🏆 ارزان‌ترین
                          </span>
                        </div>
                      )}

                      {/* سر فروشنده */}
                      <div className="mb-4 flex items-start justify-between gap-3 border-b border-[#39FF14]/10 pb-4">
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-gray-100">
                            {seller.seller_name}
                          </h4>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {seller.warranty && (
                              <span className="rounded-full border border-[#39FF14]/30 bg-[#39FF14]/5 px-2.5 py-1 text-[10px] text-[#39FF14]">
                                🛡️ {seller.warranty}
                              </span>
                            )}
                            {seller.shipping && (
                              <span className="rounded-full border border-[#39FF14]/30 bg-[#39FF14]/5 px-2.5 py-1 text-[10px] text-[#39FF14]">
                                🚚 {seller.shipping}
                              </span>
                            )}
                          </div>
                        </div>
                        <span
                          className={
                            seller.stock > 0
                              ? "shrink-0 rounded-full border border-[#39FF14]/40 bg-[#39FF14]/10 px-2.5 py-1 text-[10px] font-bold text-[#39FF14]"
                              : "shrink-0 rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[10px] font-bold text-red-400"
                          }
                        >
                          {seller.stock > 0 ? "موجود" : "ناموجود"}
                        </span>
                      </div>

                      {/* توضیحات فروشنده */}
                      {seller.notes && (
                        <div className="mb-3 rounded-lg border border-[#39FF14]/20 bg-neutral-950/50 p-3">
                          <p className="text-xs leading-relaxed text-gray-300">
                            📝 {seller.notes}
                          </p>
                        </div>
                      )}

                      {/* پنل خرید */}
                      <ProductBuyPanel
                        product={{
                          id: product.id,
                          name: product.name,
                          slug: product.slug,
                          price: seller.price,
                          discount_price: seller.discount_price,
                          stock: seller.stock,
                          images: product.images ?? [],
                        }}
                        offer_id={seller.id}
                          seller_id={seller.seller_id}
                        seller_name={seller.seller_name}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
