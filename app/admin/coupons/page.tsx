import { requirePermission } from "@/lib/auth-server";
import CouponsClient from "./coupons-client";

export default async function AdminCouponsPage() {
  await requirePermission("coupons.manage");
  return <CouponsClient />;
}
