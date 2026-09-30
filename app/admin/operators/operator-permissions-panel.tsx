"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { PERMISSION_LABELS, type PermissionKey } from "@/lib/admin/permissions";

// Grant/revoke uses the existing audited RPCs (admin_grant_permission /
// admin_revoke_permission, supabase/migrations/202609300003). Both RPCs
// re-check Super Admin server-side and write admin_audit_log atomically in
// the same transaction as the permission write -- this panel never writes
// operator_permissions directly and cannot bypass that enforcement.
export function OperatorPermissionsPanel({
  profileId,
  allKeys,
  granted,
}: {
  profileId: string;
  allKeys: readonly PermissionKey[];
  granted: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const grantedSet = new Set(granted);

  const grant = (key: PermissionKey) => {
    setError("");
    startTransition(async () => {
      const { error: rpcError } = await supabase.rpc("admin_grant_permission", {
        p_profile_id: profileId,
        p_permission_key: key,
      });
      if (rpcError) setError(rpcError.message);
      else router.refresh();
    });
  };

  const revoke = (key: PermissionKey) => {
    setError("");
    startTransition(async () => {
      const { error: rpcError } = await supabase.rpc("admin_revoke_permission", {
        p_profile_id: profileId,
        p_permission_key: key,
      });
      if (rpcError) setError(rpcError.message);
      else router.refresh();
    });
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {allKeys.map((key) => {
          const isGranted = grantedSet.has(key);
          return (
            <button
              key={key}
              type="button"
              disabled={pending}
              onClick={() => (isGranted ? revoke(key) : grant(key))}
              className={`rounded-full border px-3 py-1.5 text-xs transition disabled:opacity-50 ${
                isGranted
                  ? "border-[#39FF14]/60 bg-[#39FF14]/10 text-[#39FF14]"
                  : "border-gray-600 text-gray-400 hover:border-[#39FF14]/40 hover:text-[#39FF14]"
              }`}
              title={isGranted ? "برای لغو کلیک کنید" : "برای اعطا کلیک کنید"}
            >
              {isGranted ? "✓ " : "+ "}
              {PERMISSION_LABELS[key]}
            </button>
          );
        })}
      </div>
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
