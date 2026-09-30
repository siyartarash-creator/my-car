import { requirePermission } from "@/lib/auth-server";
import NewProductClient from "./new-product-client";

export default async function NewProductPage() {
  await requirePermission("products.write");
  return <NewProductClient />;
}
