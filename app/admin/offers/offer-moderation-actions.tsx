"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// activate_offer/deactivate_offer (supabase/migrations/202609300006) re-check
// offers.moderate server-side and audit atomically. deactivate_offer itself
// rejects an empty/whitespace reason -- the client-side check here is only
// UX, the RPC is the actual boundary.
export function OfferModerationActions({ offerId, isActive }: { offerId: number; isActive: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deactivating, setDeactivating] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const activate = () => {
    setError("");
    startTransition(async () => {
      const { error: rpcError } = await supabase.rpc("activate_offer", { p_offer_id: offerId });
      if (rpcError) setError(rpcError.message);
      else router.refresh();
    });
  };

  const deactivate = () => {
    if (!reason.trim()) {
      setError("دلیل غیرفعال‌سازی الزامی است.");
      return;
    }
    setError("");
    startTransition(async () => {
      const { error: rpcError } = await supabase.rpc("deactivate_offer", {
        p_offer_id: offerId,
        p_reason: reason.trim(),
      });
      if (rpcError) setError(rpcError.message);
      else router.refresh();
    });
  };

  return (
    <div className="mt-3 border-t border-[#39FF14]/10 pt-3">
      {isActive ? (
        deactivating ? (
          <div className="space-y-2">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="دلیل غیرفعال‌سازی (مثلاً قطعه تقلبی گزارش‌شده توسط خریداران)..."
              className="w-full resize-none rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-[#39FF14]"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={deactivate}
                className="rounded-lg bg-red-500 px-4 py-1.5 text-xs font-bold text-white transition hover:bg-red-600 disabled:opacity-50"
              >
                ثبت غیرفعال‌سازی
              </button>
              <button
                type="button"
                onClick={() => setDeactivating(false)}
                className="rounded-lg border border-gray-600 px-4 py-1.5 text-xs text-gray-400 hover:bg-gray-500/10"
              >
                انصراف
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDeactivating(true)}
            className="rounded-lg border border-red-500/40 px-4 py-1.5 text-xs font-bold text-red-400 transition hover:bg-red-500/10"
          >
            غیرفعال‌سازی
          </button>
        )
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={activate}
          className="rounded-lg bg-[#39FF14] px-4 py-1.5 text-xs font-bold text-black transition hover:bg-[#39FF14]/90 disabled:opacity-50"
        >
          فعال‌سازی
        </button>
      )}
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
