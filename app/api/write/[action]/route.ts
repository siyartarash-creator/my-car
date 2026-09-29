import { createClient } from "@/lib/supabase-server";
import { validateWrite } from "@/lib/write-validation";

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (request.headers.get("origin") !== new URL(request.url).origin) return reply({ error: "درخواست نامعتبر است" }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply({ error: "درخواست نامعتبر است" }, 415);
  const { action } = await params;
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return reply({ error: "لطفاً دوباره وارد شوید" }, 401);
  let payload: Record<string, unknown>;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 16384) { await reader.cancel(); return reply({ error: "درخواست بیش از حد بزرگ است" }, 413); }
      chunks.push(value);
    }
    payload = validateWrite(action, JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch { return reply({ error: "اطلاعات درخواست معتبر نیست" }, 400); }
  const v = payload;
  const calls: Record<string, { name: string; args: Record<string, unknown> }> = {
    quote: { name: "quote_checkout", args: { p_items: v.items, p_coupon: v.coupon ?? null } },
    checkout: { name: "place_order", args: { p_items: v.items, p_coupon: v.coupon ?? null, p_address: v.address, p_key: v.key, p_expected_total: v.expected_total } },
    cancel: { name: "cancel_order", args: { p_order_id: v.order_id } },
    fulfillment: { name: "advance_fulfillment", args: { p_order_id: v.order_id, p_status: v.status } },
    offer: { name: "save_offer", args: { p_product_id:v.product_id,p_offer_id:v.offer_id??null,p_price:v.price,
      p_discount_price:v.discount_price??null,p_stock:v.stock,p_warranty:v.warranty??null,p_shipping:v.shipping??null,p_notes:v.notes??null,p_hidden:v.hidden } },
  };
  const call = calls[action];
  const result = await client.rpc(call.name, call.args);
  if (result.error) {
    const known = ["price_changed", "offer_unavailable", "product_unavailable", "invalid_coupon", "cannot_cancel", "invalid_transition"];
    const code = known.includes(result.error.message) ? result.error.message : "write_failed";
    return reply({ error: "درخواست انجام نشد؛ موجودی، دسترسی و اطلاعات را بررسی کنید", code }, 409);
  }
  return reply(result.data ?? { ok: true });
}
