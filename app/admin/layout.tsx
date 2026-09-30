import { requireAdminAccess } from "@/lib/auth-server";
import { navItemsFor } from "@/lib/admin/modules";
import Navigation from "./navigation";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const { client, isAdmin, granted } = await requireAdminAccess();
  const { count: pendingProductRequests } = await client
    .from("product_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  const modules = navItemsFor({ isAdmin, granted });

  return (
    <Navigation isAdmin={isAdmin} modules={modules} pendingProductRequests={pendingProductRequests ?? 0}>
      {children}
    </Navigation>
  );
}
