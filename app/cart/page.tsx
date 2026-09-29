"use client";

import Link from "next/link";
import { Logo } from "@/components/Logo";
import { useCart } from "@/lib/cart-context";

export default function CartPage() {
  const { items, removeItem, updateQuantity, totalPrice, clearCart, totalItems } =
    useCart();

  return (
    <main className="min-h-screen bg-neutral-950 text-white" dir="rtl">
      <header className="border-b border-[#39FF14]/20 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Logo size={36} />
            <h1 className="text-xl font-bold text-[#39FF14] drop-shadow-[0_0_8px_#39FF14]">
              ماشین من
            </h1>
          </Link>
          <Link
            href="/shop"
            className="rounded-full border border-[#39FF14]/30 px-4 py-2 text-sm font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10"
          >
            بازگشت به فروشگاه
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-12">
        <h2 className="mb-8 text-3xl font-bold">
          سبد <span className="text-[#39FF14]">خرید</span>
        </h2>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/40 p-12 text-center">
            <div className="mb-4 text-6xl">🛒</div>
            <p className="mb-6 text-lg text-gray-300">سبد خرید شما خالی است</p>
            <Link
              href="/shop"
              className="inline-block rounded-lg bg-[#39FF14] px-8 py-3 font-bold text-black shadow-[0_0_20px_rgba(57,255,20,0.5)] transition hover:bg-[#39FF14]/90"
            >
              رفتن به فروشگاه
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              {items.map((item) => (
                <div
                  key={`${item.offer_id}`}
                  className="flex gap-4 rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-4"
                >
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#39FF14]/20 bg-neutral-950 text-4xl">
                    {item.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.image}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span>🛒</span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col justify-between">
                    <div>
                      <Link
                        href={`/shop/${item.slug}`}
                        className="font-bold text-white transition hover:text-[#39FF14]"
                      >
                        {item.name}
                      </Link>
                      <p className="mt-1 text-xs text-gray-400">
                        فروشنده: {item.seller_name}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 rounded-full border border-[#39FF14]/30 bg-neutral-950 px-2 py-1">
                        <button
                          type="button"
                          onClick={() =>
                            updateQuantity(item.offer_id,
                              item.quantity + 1
                            )
                          }
                          className="flex h-7 w-7 items-center justify-center rounded-full text-[#39FF14] transition hover:bg-[#39FF14]/20"
                        >
                          +
                        </button>
                        <span className="min-w-[2rem] text-center text-sm font-bold">
                          {item.quantity.toLocaleString("fa-IR")}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            updateQuantity(item.offer_id,
                              item.quantity - 1
                            )
                          }
                          className="flex h-7 w-7 items-center justify-center rounded-full text-[#39FF14] transition hover:bg-[#39FF14]/20"
                        >
                          −
                        </button>
                      </div>
                      <span className="text-base font-bold text-[#39FF14]">
                        {(item.price * item.quantity).toLocaleString("fa-IR")} تومان
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.offer_id)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-red-400 transition hover:bg-red-500/10"
                    title="حذف"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={clearCart}
                className="text-sm text-gray-400 transition hover:text-red-400"
              >
                🗑️ پاک کردن کل سبد
              </button>
            </div>

            <div className="lg:col-span-1">
              <div className="sticky top-6 rounded-2xl border border-[#39FF14]/30 bg-neutral-900/60 p-6">
                <h3 className="mb-5 text-lg font-bold text-[#39FF14]">
                  خلاصه سفارش
                </h3>
                <div className="mb-4 space-y-2 border-b border-[#39FF14]/20 pb-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">تعداد اقلام</span>
                    <span>{totalItems.toLocaleString("fa-IR")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">جمع کل</span>
                    <span className="font-bold text-[#39FF14]">
                      {totalPrice.toLocaleString("fa-IR")} تومان
                    </span>
                  </div>
                </div>
                <Link
                  href="/checkout"
                  className="block w-full rounded-lg bg-[#39FF14] px-6 py-3 text-center font-bold text-black shadow-[0_0_20px_rgba(57,255,20,0.5)] transition hover:bg-[#39FF14]/90"
                >
                  ادامه و پرداخت
                </Link>
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}