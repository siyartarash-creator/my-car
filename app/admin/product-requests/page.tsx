import { requirePermission } from "@/lib/auth-server";
import ProductRequestsClient from "./product-requests-client";

export default async function AdminProductRequestsPage() {
  await requirePermission("requests.review");
  return <ProductRequestsClient />;
}
