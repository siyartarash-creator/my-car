"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// Both approve_discount_request/reject_discount_request (supabase/migrations/
// 202609300005) re-check discounts.approve server-side, revalidate the
// locked current base price, and write their admin_audit_log entry in the
// same transaction as the decision. This component only invokes them.
export function DiscountRequestActions({ requestId }: { requestId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const approve = () => {
    setError("");
    startTransition(async () => {
      const { error: rpcError } = await supabase.rpc("approve_discount_request", { p_request_id: requestId });
      if (rpcError) setError(rpcError.message);
      else router.refresh();
    });
  };

  const reject = () => {
    if (!reason.trim()) {
      setError("دلیل رد درخواست الزامی است.");
      return;
    }
    setError("");
    startTransition(async () => {
      const { error: rpcError } = await supabase.rpc("reject_discount_request", {
        p_request_id: requestId,
        p_reason: reason.trim(),
      });
      if (rpcError) setError(rpcError.message);
      else router.refresh();
    });
  };

  return (
    <div className="mt-3 border-t border-[#39FF14]/10 pt-3">
      {rejecting ? (
        <div className="space-y-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="دلیل رد درخواست..."
            className="w-full resize-none rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-[#39FF14]"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={reject}
              className="rounded-lg bg-red-500 px-4 py-1.5 text-xs font-bold text-white transition hover:bg-red-600 disabled:opacity-50"
            >
              ثبت رد
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="rounded-lg border border-gray-600 px-4 py-1.5 text-xs text-gray-400 hover:bg-gray-500/10"
            >
              انصراف
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={approve}
            className="rounded-lg bg-[#39FF14] px-4 py-1.5 text-xs font-bold text-black transition hover:bg-[#39FF14]/90 disabled:opacity-50"
          >
            ✅ تایید
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setRejecting(true)}
            className="rounded-lg border border-red-500/40 px-4 py-1.5 text-xs font-bold text-red-400 transition hover:bg-red-500/10"
          >
            ❌ رد
          </button>
        </div>
      )}
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
