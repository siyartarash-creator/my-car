import { createClient } from "@/lib/supabase-server";
import { validateWrite } from "@/lib/write-validation";
import type { WriteAction } from "@/lib/write-action";
import { shopWriteActions } from "@/features/shop/write-actions";
import { financeWriteActions } from "@/features/finance/write-actions";
import { rescueWriteActions } from "@/features/rescue/write-actions";

// Every action name is owned by exactly one module. validateWrite rejects unknown names before lookup.
const writeActions: Record<string, WriteAction> = { ...shopWriteActions, ...financeWriteActions, ...rescueWriteActions };

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
  const writeAction = writeActions[action];
  if (writeAction.prepare) {
    const refusal = await writeAction.prepare(client, v);
    if (refusal) return reply({ error: refusal }, 409);
  }
  const call = writeAction.call(v);
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
