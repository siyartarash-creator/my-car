// Fixed permission-key set, mirroring the DB CHECK constraint on
// operator_permissions.permission_key (supabase/migrations/202609300003).
// Add a key here only when it is also added to that CHECK constraint in a
// migration -- this list is documentation/typing, never the enforcement
// boundary. Enforcement is always server-side (has_permission RPC / RLS).
export const PERMISSION_KEYS = [
  "products.write",
  "offers.moderate",
  "discounts.approve",
  "requests.review",
  "orders.read",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  "products.write": "مدیریت محصولات",
  "offers.moderate": "مدیریت (فعال/غیرفعال‌سازی) آگهی‌های فروشنده",
  "discounts.approve": "تایید/رد درخواست تخفیف بالای سقف",
  "requests.review": "بررسی درخواست‌های محصول جدید",
  "orders.read": "مشاهده سفارش‌ها",
};

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}
