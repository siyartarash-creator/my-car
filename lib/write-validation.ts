export function validateWrite(action: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_request");
  const v = value as Record<string, unknown>;
  const keys: Record<string, string[]> = {
    quote: ["items", "coupon"], checkout: ["items", "coupon", "address", "key", "expected_total"],
    cancel: ["order_id"], fulfillment: ["order_id", "status"],
    offer: ["product_id", "offer_id", "price", "discount_price", "stock", "warranty", "shipping", "notes", "hidden"],
  };
  if (!Object.hasOwn(keys, action) || Object.keys(v).some(k => !keys[action].includes(k))) throw new Error("invalid_request");
  const positive = (n: unknown) => Number.isSafeInteger(n) && Number(n)>0;
  if (action === "quote" || action === "checkout") {
    if (!Array.isArray(v.items) || v.items.length<1 || v.items.length>100 || v.items.some(i =>
      !i || typeof i!=="object" || Object.keys(i).some(k=>k!=="offer_id"&&k!=="quantity") ||
      !positive(i.offer_id) || !positive(i.quantity) || i.quantity>9999)) throw new Error("invalid_items");
    if (new Set(v.items.map(i=>i.offer_id)).size!==v.items.length) throw new Error("duplicate_offer");
    if (v.coupon!=null && (typeof v.coupon!=="string" || v.coupon.length>64)) throw new Error("invalid_coupon");
  }
  if (action === "checkout") {
    if (!positive(v.expected_total)) throw new Error("invalid_total");
    if (typeof v.key!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.key)) throw new Error("invalid_key");
    if (!v.address || typeof v.address!=="object" || Array.isArray(v.address)) throw new Error("invalid_address");
  }
  if ((action==="cancel" || action==="fulfillment") && !positive(v.order_id)) throw new Error("invalid_order");
  if (action==="fulfillment" && !["processing","shipped","delivered"].includes(String(v.status))) throw new Error("invalid_transition");
  if (action==="offer" && (!positive(v.product_id) || (v.offer_id!=null&&!positive(v.offer_id)) ||
    !positive(v.price) || Number(v.price)>1e12 || !Number.isSafeInteger(v.stock) || Number(v.stock)<0 || Number(v.stock)>1e6 ||
    (v.discount_price!=null&&(!positive(v.discount_price)||Number(v.discount_price)>Number(v.price))) || typeof v.hidden!=="boolean" ||
    ["warranty","shipping","notes"].some(k=>v[k]!=null&&(typeof v[k]!=="string"||String(v[k]).length>2000)))) throw new Error("invalid_offer");
  return v;
}
