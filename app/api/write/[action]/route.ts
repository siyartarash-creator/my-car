import { createClient } from "@/lib/supabase-server";
import { validateWrite } from "@/lib/write-validation";

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const origin = request.headers.get("origin");
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const requestUrl = new URL(request.url);
  const requestHost = forwardedHost || request.headers.get("host") || requestUrl.host;
  const requestProto = forwardedProto || requestUrl.protocol.slice(0, -1);
  const expectedOrigin = `${requestProto}://${requestHost}`;
  if (!origin || origin !== expectedOrigin) return reply({ error: "درخواست نامعتبر است" }, 403);
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
  if (action === "manual_credit") {
    const account = await client.from("ledger_accounts").select("id").eq("profile_id", v.user_id).eq("kind", "profile").single();
    if (account.error) return reply({ error: "حساب کیف پول کاربر پیدا نشد" }, 409);
    v.account_id = account.data.id;
  }
  const calls: Record<string, { name: string; args: Record<string, unknown> }> = {
    quote: { name: "quote_checkout", args: { p_items: v.items, p_coupon: v.coupon ?? null } },
    checkout: { name: "place_order", args: { p_items: v.items, p_coupon: v.coupon ?? null, p_address: v.address, p_key: v.key, p_expected_total: v.expected_total } },
    cancel: { name: "cancel_order", args: { p_order_id: v.order_id } },
    fulfillment: { name: "advance_fulfillment", args: { p_order_id: v.order_id, p_status: v.status } },
    wallet_pay: { name: "pay_order_from_wallet", args: { p_order_id: v.order_id, p_key: v.key } },
    // The canonical refund RPC is admin-only and derives the original transfer from the order.
    wallet_refund: { name: "admin_refund_order_escrow", args: { p_order_id: v.order_id, p_reason: v.reason, p_refund_transfer_id: null } },
    manual_credit: { name: "admin_manual_wallet_entry", args: { p_account_id: v.account_id, p_direction: "charge", p_amount_toman: v.amount, p_reason: v.reason, p_tracking_reference: v.reference } },
    test_rescue: { name: "admin_create_test_rescue_transaction", args: { p_user_id: v.user_id, p_amount: v.amount, p_reference: v.reference, p_idempotency_key: v.key } },
    test_rescue_release: { name: "admin_release_test_rescue_transaction", args: { p_transaction_id: v.transaction_id } },
    test_rescue_refund: { name: "admin_refund_test_rescue_transaction", args: { p_transaction_id: v.transaction_id, p_reason: v.reason, p_idempotency_key: v.key } },
    offer: { name: "save_offer", args: { p_product_id:v.product_id,p_offer_id:v.offer_id??null,p_price:v.price,
      p_discount_price:v.discount_price??null,p_stock:v.stock,p_warranty:v.warranty??null,p_shipping:v.shipping??null,p_notes:v.notes??null,p_hidden:v.hidden } },
  };
  const call = calls[action];
  let result;
  try {
    result = await client.rpc(call.name, call.args);
  } catch {
    return reply({ error: "سرویس مالی موقتاً در دسترس نیست" }, 503);
  }
  if (result.error) {
    const known = ["price_changed", "offer_unavailable", "product_unavailable", "invalid_coupon", "cannot_cancel", "invalid_transition",
      "insufficient_wallet_balance", "order_not_found", "order_not_payable", "allocation_total_mismatch", "invalid_allocations",
      "duplicate_allocation", "invalid_allocation_account", "idempotency_conflict", "wallet_payment_not_found", "refund_not_allowed",
      "already_refunded", "invalid_refund_reason", "invalid_refund_request", "invalid_amount", "invalid_reference",
      "invalid_idempotency_key", "test_transaction_not_found"];
    const code = known.includes(result.error.message) ? result.error.message : "write_failed";
    return reply({ error: "درخواست انجام نشد؛ موجودی، دسترسی و اطلاعات را بررسی کنید", code }, 409);
  }
  return reply(result.data ?? { ok: true });
}
