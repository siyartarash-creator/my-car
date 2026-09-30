import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth-server";

type LogRow = {
  id: number;
  actor_id: string;
  action: string;
  target_table: string;
  target_id: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

// Every action this Admin panel's SECURITY DEFINER RPCs ever write to
// admin_audit_log (grep across supabase/migrations for
// private.log_admin_action(' calls) -- kept in sync manually, not derived,
// since this is a fixed, small, reviewable list, not a speculative one.
const KNOWN_ACTIONS = [
  "grant_permission",
  "revoke_permission",
  "approve_discount_request",
  "reject_discount_request",
  "deactivate_offer",
  "activate_offer",
  "review_product_request",
  "create_coupon",
  "activate_coupon",
  "deactivate_coupon",
  "delete_coupon",
] as const;
const TARGET_TABLES = ["operator_permissions", "discount_requests", "product_sellers", "product_requests", "coupons"] as const;

// Read-only Admin audit surface over admin_audit_log (Checkpoint C). No
// mutation UI at all -- the table is already append-only with no
// update/delete grant to any client role (supabase/migrations/202609300003).
// Super-Admin-only by default: admin_audit_log's own RLS
// (admin_audit_log_admin_read) is private.is_admin()-only and is not
// widened here -- no concrete architectural need for an operator
// audit-read permission surfaced during Checkpoints A-C, so none is added
// speculatively.
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; action?: string; target_table?: string; from?: string; to?: string }>;
}) {
  const { client } = await requireSuperAdmin();
  const params = await searchParams;

  const [{ data: admins }, { data: operatorGrants }] = await Promise.all([
    client.from("profiles").select("id,name").eq("is_admin", true),
    client.from("operator_permissions").select("profile_id,profiles(name)").order("profile_id"),
  ]);
  const actorMap = new Map<string, string>();
  for (const a of admins ?? []) actorMap.set(a.id, a.name);
  for (const g of (operatorGrants ?? []) as unknown as { profile_id: string; profiles: { name: string } | null }[]) {
    if (!actorMap.has(g.profile_id)) actorMap.set(g.profile_id, g.profiles?.name ?? g.profile_id);
  }
  const actors = [...actorMap.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  let query = client
    .from("admin_audit_log")
    .select("id,actor_id,action,target_table,target_id,reason,metadata,created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (params.actor) query = query.eq("actor_id", params.actor);
  if (params.action) query = query.eq("action", params.action);
  if (params.target_table) query = query.eq("target_table", params.target_table);
  if (params.from) query = query.gte("created_at", params.from);
  if (params.to) query = query.lte("created_at", `${params.to}T23:59:59`);

  const { data, error } = await query;
  const rows = (data ?? []) as LogRow[];

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold md:text-3xl">
          گزارش <span className="text-[#39FF14]">عملیات ادمین</span>
        </h2>
        <p className="mt-1 text-sm text-gray-400">فقط نمایش — این گزارش قابل ویرایش یا حذف نیست.</p>
      </div>

      <form className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" method="get">
        <select name="actor" defaultValue={params.actor ?? ""} className="rounded-lg border border-[#39FF14]/20 bg-neutral-900 px-3 py-2 text-sm text-white outline-none focus:border-[#39FF14]">
          <option value="">همه عامل‌ها</option>
          {actors.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select name="action" defaultValue={params.action ?? ""} className="rounded-lg border border-[#39FF14]/20 bg-neutral-900 px-3 py-2 text-sm text-white outline-none focus:border-[#39FF14]">
          <option value="">همه عملیات</option>
          {KNOWN_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select name="target_table" defaultValue={params.target_table ?? ""} className="rounded-lg border border-[#39FF14]/20 bg-neutral-900 px-3 py-2 text-sm text-white outline-none focus:border-[#39FF14]">
          <option value="">همه جدول‌های هدف</option>
          {TARGET_TABLES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={params.from ?? ""} className="rounded-lg border border-[#39FF14]/20 bg-neutral-900 px-3 py-2 text-sm text-white outline-none focus:border-[#39FF14]" />
        <input type="date" name="to" defaultValue={params.to ?? ""} className="rounded-lg border border-[#39FF14]/20 bg-neutral-900 px-3 py-2 text-sm text-white outline-none focus:border-[#39FF14]" />
        <button type="submit" className="rounded-lg bg-[#39FF14] px-4 py-2 text-sm font-bold text-black transition hover:bg-[#39FF14]/90 sm:col-span-2 lg:col-span-1">
          فیلتر
        </button>
        <Link href="/admin/audit" className="rounded-lg border border-gray-600 px-4 py-2 text-center text-sm text-gray-400 transition hover:bg-gray-500/10">
          حذف فیلترها
        </Link>
      </form>

      {error ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-center text-red-400">خطا: {error.message}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-12 text-center text-gray-400">رکوردی پیدا نشد.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl border border-[#39FF14]/20 bg-neutral-900/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-full border border-[#39FF14]/30 px-2.5 py-0.5 text-xs text-[#39FF14]">{r.action}</span>
                  <span className="text-gray-300">{actorMap.get(r.actor_id) ?? r.actor_id}</span>
                  <span className="text-xs text-gray-500">
                    {r.target_table}#{r.target_id ?? "—"}
                  </span>
                </div>
                <span className="text-xs text-gray-500">{new Date(r.created_at).toLocaleString("fa-IR")}</span>
              </div>
              {r.reason ? <p className="mt-2 text-xs text-gray-400">دلیل: {r.reason}</p> : null}
              {r.metadata ? (
                <p dir="ltr" className="mt-2 break-all text-left text-[11px] text-gray-600">
                  {JSON.stringify(r.metadata)}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
