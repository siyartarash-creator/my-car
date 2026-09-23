"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { usePathname } from "next/navigation";

export type CartItem = {
  product_id: number;
  slug: string;
  name: string;
  seller_id?: string;
  seller_name: string;
  price: number;
  image: string;
  quantity: number;
  stock: number;
};

type CartContextType = {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "quantity">) => void;
  removeItem: (product_id: number, seller_name: string) => void;
  updateQuantity: (
    product_id: number,
    seller_name: string,
    quantity: number
  ) => void;
  clearCart: () => void;
  totalPrice: number;
  totalItems: number;
};

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_KEY_PREFIX = "mycar-cart";

function buildKey(userId: string | null): string {
  return userId ? `${CART_KEY_PREFIX}-${userId}` : `${CART_KEY_PREFIX}-guest`;
}

function getStoredUserId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("userId");
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const pathname = usePathname();

  // چک کردن userId در هر تغییر مسیر
  useEffect(() => {
    const storedUserId = getStoredUserId();
    if (storedUserId !== userId) {
      setUserId(storedUserId);
      setLoaded(false);
    }
  }, [pathname, userId]);

  // بارگذاری سبد کاربر
  useEffect(() => {
    if (loaded) return;
    if (typeof window === "undefined") return;

    const key = buildKey(userId);
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setItems(parsed);
        } else {
          setItems([]);
        }
      } else {
        setItems([]);
      }
    } catch (e) {
      console.error("خطا در بارگذاری سبد:", e);
      setItems([]);
    }
    setLoaded(true);
  }, [userId, loaded]);

  // ذخیره سبد در localStorage
  useEffect(() => {
    if (!loaded || typeof window === "undefined") return;
    const key = buildKey(userId);
    try {
      localStorage.setItem(key, JSON.stringify(items));
    } catch (e) {
      console.error("خطا در ذخیره سبد:", e);
    }
  }, [items, loaded, userId]);

  const addItem = (item: Omit<CartItem, "quantity">) => {
    setItems((prev) => {
      const existing = prev.find(
        (i) =>
          i.product_id === item.product_id && i.seller_name === item.seller_name
      );
      if (existing) {
        return prev.map((i) =>
          i.product_id === item.product_id && i.seller_name === item.seller_name
            ? { ...i, quantity: Math.min(i.quantity + 1, i.stock) }
            : i
        );
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const removeItem = (product_id: number, seller_name: string) => {
    setItems((prev) =>
      prev.filter(
        (i) => !(i.product_id === product_id && i.seller_name === seller_name)
      )
    );
  };

  const updateQuantity = (
    product_id: number,
    seller_name: string,
    quantity: number
  ) => {
    if (quantity < 1) return;
    setItems((prev) =>
      prev.map((i) =>
        i.product_id === product_id && i.seller_name === seller_name
          ? { ...i, quantity: Math.min(quantity, i.stock) }
          : i
      )
    );
  };

  const clearCart = () => setItems([]);

  const totalPrice = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
        totalPrice,
        totalItems,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart باید داخل CartProvider استفاده شود");
  return ctx;
}