"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useIdentity } from "@/lib/auth-client";

export type CartItem = {
  offer_id: number; product_id: number; seller_id: string; seller_name: string;
  slug: string; name: string; price: number; image: string; quantity: number; stock: number;
};
type Cart = {
  items: CartItem[]; loaded: boolean;
  addItem: (item: Omit<CartItem,"quantity">) => void;
  removeItem: (offerId: number) => void;
  updateQuantity: (offerId: number, quantity: number) => void;
  clearCart: () => void; totalPrice: number; totalItems: number;
};
const Context = createContext<Cart | null>(null);
const valid = (i: CartItem) => i && Number.isSafeInteger(i.offer_id) && i.offer_id>0 &&
  typeof i.seller_id==="string" && Number.isSafeInteger(i.quantity) && i.quantity>0 && i.quantity<=9999 &&
  Number.isSafeInteger(i.price) && i.price>0 && Number.isSafeInteger(i.stock) && i.stock>0 &&
  typeof i.name==="string" && typeof i.slug==="string" && typeof i.image==="string";

export function CartProvider({children}: {children: React.ReactNode}) {
  const {user,loading} = useIdentity();
  const owner = user?.id ?? "guest";
  const [cart,setCart] = useState<{owner:string;items:CartItem[]} | null>(null);
  const loaded = !loading && cart?.owner===owner;
  const items = loaded ? cart.items : [];
  useEffect(()=>{
    if (loading) return;
    let items:CartItem[]=[];
    try {
      const parsed=JSON.parse(localStorage.getItem(`mycar-cart-v2-${owner}`)??"[]");
      if(Array.isArray(parsed)) items=parsed.filter(valid).slice(0,100);
    } catch { /* Corrupt/legacy display data is never used for checkout. */ }
    // Hydrate React state from external browser storage after the session resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCart({owner,items});
  },[owner,loading]);
  useEffect(()=>{
    if(!loaded) return;
    try { localStorage.setItem(`mycar-cart-v2-${owner}`,JSON.stringify(cart.items)); } catch { /* In-memory cart still works. */ }
  },[cart,owner,loaded]);
  const mutate=(fn:(items:CartItem[])=>CartItem[])=>setCart(old=>
    !loading&&old?.owner===owner?{owner,items:fn(old.items)}:old);
  const addItem=(item:Omit<CartItem,"quantity">)=>{
    if(!valid({...item,quantity:1})) return;
    mutate(prev=>prev.some(i=>i.offer_id===item.offer_id)
      ?prev.map(i=>i.offer_id===item.offer_id?{...item,quantity:Math.min(i.quantity+1,item.stock,9999)}:i)
      :prev.length<100?[...prev,{...item,quantity:1}]:prev);
  };
  return <Context.Provider value={{items,loaded,addItem,
    removeItem:id=>mutate(prev=>prev.filter(i=>i.offer_id!==id)),
    updateQuantity:(id,q)=>{if(Number.isSafeInteger(q)&&q>0)mutate(prev=>prev.map(i=>i.offer_id===id?{...i,quantity:Math.min(q,i.stock,9999)}:i));},
    clearCart:()=>mutate(()=>[]),totalItems:items.reduce((s,i)=>s+i.quantity,0),
    totalPrice:items.reduce((s,i)=>s+i.price*i.quantity,0),
  }}>{children}</Context.Provider>;
}
export function useCart(){const value=useContext(Context);if(!value)throw new Error("CartProvider required");return value;}
