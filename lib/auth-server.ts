import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import type { PermissionKey } from "@/lib/admin/permissions";
import { isPermissionKey } from "@/lib/admin/permissions";

export async function requireRole(role: "admin" | "seller") {
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) redirect("/login");
  const { data: profile } = await client.from("profiles").select("is_admin,user_type").eq("id", user.id).single();
  if (!profile || (role === "admin" ? profile.is_admin !== true : profile.user_type !== "seller")) redirect("/");
  return { client, user, profile };
}

// Admin Core entry boundary (locked architecture, Admin Panel Completion
// brief section 3): a profile may enter the Admin shell if it is Super Admin
// OR holds at least one operator_permissions grant. This is only the coarse
// "may the shell open" check -- callers still enforce page/action-specific
// permissions with requirePermission(). Navigation-item visibility built on
// top of the returned `granted` set is UX only, never a security boundary;
// the server RPCs (has_permission, has_any_permission) are the boundary.
export async function requireAdminAccess() {
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) redirect("/login");

  const [{ data: profile }, { data: canEnter }] = await Promise.all([
    client.from("profiles").select("is_admin,user_type").eq("id", user.id).single(),
    client.rpc("has_any_permission"),
  ]);
  if (!canEnter) redirect("/");

  const isAdmin = profile?.is_admin === true;
  const granted = new Set<PermissionKey>();
  if (!isAdmin) {
    const { data: rows } = await client.from("operator_permissions").select("permission_key").eq("profile_id", user.id);
    for (const row of rows ?? []) {
      if (isPermissionKey(row.permission_key)) granted.add(row.permission_key);
    }
  }
  return { client, user, profile, isAdmin, granted };
}

// Page/action-specific server guard. Super Admin always passes (bypass).
// Deny by default: no grant (and not Super Admin) redirects away, the same
// way requireAdminAccess does for shell entry.
export async function requirePermission(permissionKey: PermissionKey) {
  const access = await requireAdminAccess();
  if (!access.isAdmin && !access.granted.has(permissionKey)) redirect("/admin");
  return access;
}

// Operator management (grant/revoke) is Super-Admin-only by locked decision
// (section 7): permission management itself must never be delegable, or
// granting permissions becomes a privilege-escalation path.
export async function requireSuperAdmin() {
  const access = await requireAdminAccess();
  if (!access.isAdmin) redirect("/admin");
  return access;
}
