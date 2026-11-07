import type { WriteAction } from "@/lib/write-action";

// Finance write actions. The canonical model is ledger_* (see supabase/migrations/202611*_ledger_*.sql).
export const financeWriteActions: Record<string, WriteAction> = {
  wallet_pay: {
    call: (v) => ({ name: "pay_order_from_wallet", args: { p_order_id: v.order_id, p_key: v.key } }),
  },
  wallet_refund: {
    // Admin-only; the original payment transfer is derived from the order.
    call: (v) => ({ name: "admin_refund_order_escrow", args: { p_order_id: v.order_id, p_reason: v.reason, p_refund_transfer_id: null } }),
  },
  manual_credit: {
    prepare: async (client, v) => {
      const account = await client.from("ledger_accounts").select("id").eq("profile_id", v.user_id).eq("kind", "profile").single();
      if (account.error) return "حساب کیف پول کاربر پیدا نشد";
      v.account_id = account.data.id;
      return null;
    },
    call: (v) => ({ name: "admin_manual_wallet_entry", args: { p_account_id: v.account_id, p_direction: "charge", p_amount_toman: v.amount, p_reason: v.reason, p_tracking_reference: v.reference } }),
  },
};
