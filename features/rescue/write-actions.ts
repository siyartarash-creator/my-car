import type { WriteAction } from "@/lib/write-action";

// Test-rescue transaction actions (admin test flow).
export const rescueWriteActions: Record<string, WriteAction> = {
  test_rescue: {
    call: (v) => ({ name: "admin_create_test_rescue_transaction", args: { p_user_id: v.user_id, p_amount: v.amount, p_reference: v.reference, p_idempotency_key: v.key } }),
  },
  test_rescue_release: {
    call: (v) => ({ name: "admin_release_test_rescue_transaction", args: { p_transaction_id: v.transaction_id } }),
  },
  test_rescue_refund: {
    call: (v) => ({ name: "admin_refund_test_rescue_transaction", args: { p_transaction_id: v.transaction_id, p_reason: v.reason, p_idempotency_key: v.key } }),
  },
};
