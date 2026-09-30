import { requireSuperAdmin } from "@/lib/auth-server";
import { PERMISSION_KEYS } from "@/lib/admin/permissions";
import { OperatorPermissionsPanel } from "./operator-permissions-panel";

// Super-Admin-only operator management (locked decision, section 7):
// list/search profiles, inspect granular permissions, grant/revoke through
// the existing audited RPCs (admin_grant_permission/admin_revoke_permission).
// No invitations, role templates, presets, or hierarchy.
export default async function AdminOperatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { client } = await requireSuperAdmin();
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  let profilesQuery = client
    .from("profiles")
    .select("id,name,mobile,user_type,is_admin")
    .order("name")
    .limit(100);
  if (query) {
    profilesQuery = profilesQuery.or(`name.ilike.%${query}%,mobile.ilike.%${query}%`);
  }
  const [{ data: profiles, error: profilesError }, { data: grants }] = await Promise.all([
    profilesQuery,
    client.from("operator_permissions").select("profile_id,permission_key"),
  ]);

  const grantedByProfile = new Map<string, string[]>();
  for (const row of grants ?? []) {
    const list = grantedByProfile.get(row.profile_id) ?? [];
    list.push(row.permission_key);
    grantedByProfile.set(row.profile_id, list);
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold md:text-3xl">
          مدیریت <span className="text-[#39FF14]">اپراتورها</span>
        </h2>
        <p className="mt-1 text-sm text-gray-400">
          اعطا و لغو دسترسی‌های اپراتور. فقط سوپر ادمین می‌تواند دسترسی اعطا یا لغو کند.
        </p>
      </div>

      <form className="mb-6 flex gap-2" action="/admin/operators">
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="جستجو با نام یا موبایل..."
          className="w-full max-w-sm rounded-lg border border-[#39FF14]/30 bg-neutral-900 px-4 py-2 text-sm text-white outline-none focus:border-[#39FF14]"
        />
        <button
          type="submit"
          className="rounded-lg border border-[#39FF14]/40 px-4 py-2 text-sm text-[#39FF14] transition hover:bg-[#39FF14]/10"
        >
          جستجو
        </button>
      </form>

      {profilesError ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-center text-red-400">
          خطا: {profilesError.message}
        </div>
      ) : !profiles || profiles.length === 0 ? (
        <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-12 text-center text-gray-400">
          پروفایلی پیدا نشد.
        </div>
      ) : (
        <div className="space-y-3">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/60 p-4"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-bold">{profile.name}</p>
                  <p className="text-xs text-gray-400">
                    {profile.mobile} · {profile.user_type}
                  </p>
                </div>
                {profile.is_admin ? (
                  <span className="rounded-full border border-yellow-400/40 bg-yellow-400/10 px-3 py-1 text-xs text-yellow-400">
                    سوپر ادمین (دسترسی کامل)
                  </span>
                ) : null}
              </div>
              {!profile.is_admin ? (
                <OperatorPermissionsPanel
                  profileId={profile.id}
                  allKeys={PERMISSION_KEYS}
                  granted={grantedByProfile.get(profile.id) ?? []}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
