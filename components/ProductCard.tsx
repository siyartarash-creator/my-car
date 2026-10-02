"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useCart } from "@/lib/cart-context";
import { STORE_SELLER_FALLBACK_LABEL } from "@/lib/seller-identity";

export type Product = {
  offer_id?: number; seller_id?: string; seller_name?: string;
  id: number;
  name: string;
  slug: string;
  brand: string;
  price: number;
  discount_price: number | null;
  images: string[];
  stock: number;
};

export type ProductCardProps = {
  product: Product;
};

function formatToman(amount: number): string {
  return `${amount.toLocaleString("fa-IR")} تومان`;
}

function getDiscountPercent(price: number, discountPrice: number): number {
  if (price <= 0) return 0;
  return Math.round(((price - discountPrice) / price) * 100);
}

export function ProductCard({ product }: ProductCardProps) {
  const { name, brand, price, discount_price, images, stock, slug, id } = product;
  const { addItem } = useCart();

  const imageSrc = images.find((src) => src.trim().length > 0) ?? null;
  const hasDiscount =
    discount_price != null && discount_price > 0 && discount_price < price;
  const displayPrice = hasDiscount ? discount_price : price;
  const discountPercent = hasDiscount
    ? getDiscountPercent(price, discount_price)
    : 0;
  const isOutOfStock = stock === 0;

  const handleAddToCart = () => {
    if (!product.offer_id || !product.seller_id) return;
    addItem({
      offer_id: product.offer_id,
      seller_id: product.seller_id,
      product_id: id,
      slug,
      name,
      seller_name: product.seller_name || STORE_SELLER_FALLBACK_LABEL,
      price: displayPrice,
      image: imageSrc ?? "",
      stock,
    });
  };

  return (
    <article
      dir="rtl"
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-[#39FF14]/20 bg-neutral-900/70 backdrop-blur-sm transition hover:border-[#39FF14] hover:shadow-[0_0_30px_rgba(57,255,20,0.35)]"
    >
      <Link
        href={`/shop/${slug}`}
        className="relative aspect-square overflow-hidden bg-neutral-950"
      >
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={name}
            fill
            unoptimized
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            className="object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-neutral-900 text-6xl">
            <span aria-hidden="true">🛒</span>
            <span className="sr-only">بدون تصویر محصول</span>
          </div>
        )}

        {hasDiscount && discountPercent > 0 && (
          <span className="absolute top-3 right-3 rounded-full bg-[#39FF14] px-2.5 py-1 text-xs font-bold text-black shadow-[0_0_16px_rgba(57,255,20,0.6)]">
            {discountPercent.toLocaleString("fa-IR")}٪ تخفیف
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-bold leading-snug text-white">
            <Link href={`/shop/${slug}`} className="transition hover:text-[#39FF14]">
              {name}
            </Link>
          </h3>
          <p className="mt-1 text-xs text-gray-400">{brand}</p>
        </div>

        <div className="mt-auto">
          {hasDiscount ? (
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-xs text-gray-500 line-through">
                {formatToman(price)}
              </span>
              <span className="text-base font-bold text-[#39FF14]">
                {formatToman(displayPrice)}
              </span>
            </div>
          ) : (
            <span className="text-base font-bold text-white">
              {formatToman(price)}
            </span>
          )}
        </div>

        <button
          type="button"
          disabled={isOutOfStock}
          onClick={handleAddToCart}
          className={
            isOutOfStock
              ? "w-full cursor-not-allowed rounded-xl border border-gray-700 bg-neutral-800 py-2.5 text-sm font-bold text-gray-500"
              : "w-full rounded-xl bg-[#39FF14] py-2.5 text-sm font-bold text-black shadow-[0_0_16px_rgba(57,255,20,0.35)] transition hover:bg-[#39FF14]/90 hover:shadow-[0_0_24px_rgba(57,255,20,0.55)]"
          }
        >
          {isOutOfStock ? "ناموجود" : "افزودن به سبد"}
        </button>
      </div>
    </article>
  );
}

export default ProductCard;

// ============================================
// ProductBuyPanel — پنل خرید برای یه فروشنده خاص
// ============================================

export type ProductBuyPanelProps = {
  product: {
    id: number;
    name: string;
    slug: string;
    price: number;
    discount_price: number | null;
    stock: number;
    images: string[];
  };
  offer_id: number;
  seller_id: string;
  seller_name?: string;
};

export function ProductBuyPanel({ product, offer_id, seller_id, seller_name }: ProductBuyPanelProps) {
  const { id, name, slug, price, discount_price, stock, images } = product;
  const { addItem } = useCart();

  const hasDiscount =
    discount_price != null && discount_price > 0 && discount_price < price;
  const displayPrice = hasDiscount ? discount_price : price;
  const isOutOfStock = stock === 0;
  const [quantity, setQuantity] = useState(isOutOfStock ? 0 : 1);
  const [added, setAdded] = useState(false);

  const imageSrc = images?.find((src) => src && src.trim().length > 0) ?? "";

  const handleQuantityChange = (value: number) => {
    if (isOutOfStock) return;
    const next = Number.isNaN(value) ? 1 : value;
    setQuantity(Math.min(stock, Math.max(1, next)));
  };

  const handleAddToCart = () => {
    for (let i = 0; i < quantity; i++) {
      addItem({
        offer_id,
        product_id: id,
        slug,
        name,
        seller_id: seller_id,
        seller_name: seller_name || STORE_SELLER_FALLBACK_LABEL,
        price: displayPrice,
        image: imageSrc,
        stock,
      });
    }
    setAdded(true);
    setTimeout(() => setAdded(false), 2500);
  };

  return (
    <div className="rounded-xl border border-[#39FF14]/10 bg-neutral-950/40 p-3">
      {hasDiscount ? (
        <div className="mb-3 flex flex-wrap items-baseline gap-2">
          <span className="text-xs text-gray-500 line-through">
            {formatToman(price)}
          </span>
          <span className="text-lg font-bold text-[#39FF14]">
            {formatToman(displayPrice)}
          </span>
        </div>
      ) : (
        <p className="mb-3 text-lg font-bold text-white">{formatToman(price)}</p>
      )}

      <p className="mb-3 text-xs">
        وضعیت:{" "}
        {isOutOfStock ? (
          <span className="font-bold text-red-400">ناموجود</span>
        ) : (
          <span className="font-bold text-[#39FF14]">
            موجود ({stock.toLocaleString("fa-IR")} عدد)
          </span>
        )}
      </p>

      {!isOutOfStock && (
        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleQuantityChange(quantity + 1)}
            disabled={quantity >= stock}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#39FF14]/30 text-[#39FF14] transition hover:bg-[#39FF14]/10 disabled:opacity-30"
          >
            +
          </button>
          <input
            type="number"
            min={1}
            max={stock}
            value={quantity}
            onChange={(e) => handleQuantityChange(Number(e.target.value))}
            className="w-16 rounded-lg border border-[#39FF14]/20 bg-neutral-950 py-2 text-center text-sm text-white outline-none focus:border-[#39FF14]"
          />
          <button
            type="button"
            onClick={() => handleQuantityChange(quantity - 1)}
            disabled={quantity <= 1}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#39FF14]/30 text-[#39FF14] transition hover:bg-[#39FF14]/10 disabled:opacity-30"
          >
            −
          </button>
        </div>
      )}

      <button
        type="button"
        disabled={isOutOfStock || added}
        onClick={handleAddToCart}
        className={
          isOutOfStock
            ? "w-full cursor-not-allowed rounded-lg border border-gray-700 bg-neutral-800 py-2.5 text-sm font-bold text-gray-500"
            : added
            ? "w-full rounded-lg bg-green-500 py-2.5 text-sm font-bold text-white transition"
            : "w-full rounded-lg bg-[#39FF14] py-2.5 text-sm font-bold text-black shadow-[0_0_16px_rgba(57,255,20,0.35)] transition hover:bg-[#39FF14]/90 hover:shadow-[0_0_24px_rgba(57,255,20,0.55)]"
        }
      >
        {isOutOfStock ? "ناموجود" : added ? "✅ به سبد اضافه شد" : "🛒 افزودن به سبد"}
      </button>
    </div>
  );
}