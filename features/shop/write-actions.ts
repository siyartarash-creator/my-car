import type { WriteAction } from "@/lib/write-action";

// Shop write actions: quote, checkout, order cancel/fulfilment, and seller offers.
export const shopWriteActions: Record<string, WriteAction> = {
  quote: {
    call: (v) => ({ name: "quote_checkout", args: { p_items: v.items, p_coupon: v.coupon ?? null } }),
  },
  checkout: {
    call: (v) => ({ name: "place_order", args: { p_items: v.items, p_coupon: v.coupon ?? null, p_address: v.address, p_key: v.key, p_expected_total: v.expected_total } }),
  },
  cancel: {
    call: (v) => ({ name: "cancel_order", args: { p_order_id: v.order_id } }),
  },
  fulfillment: {
    call: (v) => ({ name: "advance_fulfillment", args: { p_order_id: v.order_id, p_status: v.status } }),
  },
  offer: {
    call: (v) => ({
      name: "save_offer",
      args: { p_product_id: v.product_id, p_offer_id: v.offer_id ?? null, p_price: v.price, p_discount_price: v.discount_price ?? null, p_stock: v.stock, p_warranty: v.warranty ?? null, p_shipping: v.shipping ?? null, p_notes: v.notes ?? null, p_hidden: v.hidden },
    }),
  },
};
