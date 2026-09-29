import { requireRole } from "@/lib/auth-server";
import Navigation from "./navigation";
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireRole("seller");
  return <Navigation>{children}</Navigation>;
}
