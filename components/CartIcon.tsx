"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart-context";

export function CartIcon() {
  const { totalItems } = useCart();

  return (
    <Link
      href="/cart"
      className="relative flex items-center gap-2 rounded-full border border-[#39FF14]/30 bg-neutral-900/60 px-4 py-2 text-sm font-bold text-[#39FF14] transition hover:border-[#39FF14] hover:bg-[#39FF14]/10"
    >
      <span className="text-lg">🛒</span>
      <span className="hidden sm:inline">سبد خرید</span>
      {totalItems > 0 && (
        <span className="absolute -top-1 -left-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#39FF14] text-[10px] font-bold text-black shadow-[0_0_10px_rgba(57,255,20,0.6)]">
          {totalItems.toLocaleString("fa-IR")}
        </span>
      )}
    </Link>
  );
}