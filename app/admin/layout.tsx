import { requireRole } from "@/lib/auth-server";
import Navigation from "@/features/admin/AdminShell";
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireRole("admin");
  return <Navigation>{children}</Navigation>;
}
