import { requirePermission } from "@/lib/auth-server";
import EditProductClient from "./edit-product-client";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("products.write");
  const { id } = await params;
  return <EditProductClient productId={id} />;
}
