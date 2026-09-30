import type { PermissionKey } from "./permissions";

// Registry-driven dashboard widgets (Admin Panel Completion, Checkpoint C).
// Like lib/admin/modules.ts, this is UI metadata only: it decides which
// widget is fetched/rendered for a given viewer. It is NEVER an
// authorization boundary -- every widget's query still runs through the
// viewer's own authenticated Supabase client and is subject to the same
// RLS policies as any other read. Hiding a widget here only avoids showing
// a number that would otherwise come back zero/empty for that viewer under
// RLS; it never grants or restricts what the underlying query can return.
export type DashboardWidgetKey =
  | "productCount"
  | "offerCount"
  | "offerActiveBreakdown"
  | "sellerCount"
  | "orderCount"
  | "orderValueTotal"
  | "orderStatusBreakdown"
  | "orderOverTime"
  | "discountRequestStatus"
  | "productRequestStatus"
  | "couponUsage";

export type DashboardWidgetVisibility = {
  // null = visible to any profile that can enter the Admin shell (Super
  // Admin or any operator grant) -- used only for metrics whose underlying
  // RLS policy has no permission-specific bypass, so every viewer already
  // sees the same (possibly RLS-narrowed) data.
  permission: PermissionKey | null;
  // true = Super Admin only, no operator-permission bypass, because no
  // existing operator permission widens the underlying table's read policy
  // for this data (e.g. profiles). Set only when that is actually true --
  // never speculatively.
  superAdminOnly?: boolean;
};

export const DASHBOARD_WIDGET_VISIBILITY: Record<DashboardWidgetKey, DashboardWidgetVisibility> = {
  productCount: { permission: null },
  offerCount: { permission: null },
  // Full active/inactive visibility needs offer_read's offers.moderate
  // bypass (supabase/migrations/202609300008) -- an entry-level viewer
  // without it only sees buyer-visible (active, unhidden) Offers, which
  // would silently undercount "inactive".
  offerActiveBreakdown: { permission: "offers.moderate" },
  // Distinct seller_id over product_sellers, same visibility reasoning as
  // offerActiveBreakdown -- counts sellers with at least one Offer, not
  // profiles.user_type='seller' (profiles RLS is not widened by any
  // operator permission, so that would only be reliable for Super Admin).
  sellerCount: { permission: "offers.moderate" },
  orderCount: { permission: "orders.read" },
  orderValueTotal: { permission: "orders.read" },
  orderStatusBreakdown: { permission: "orders.read" },
  orderOverTime: { permission: "orders.read" },
  discountRequestStatus: { permission: "discounts.approve" },
  productRequestStatus: { permission: "requests.review" },
  couponUsage: { permission: "coupons.manage" },
};

export function canSeeWidget(
  key: DashboardWidgetKey,
  viewer: { isAdmin: boolean; granted: ReadonlySet<PermissionKey> },
): boolean {
  if (viewer.isAdmin) return true;
  const v = DASHBOARD_WIDGET_VISIBILITY[key];
  if (v.superAdminOnly) return false;
  return v.permission === null || viewer.granted.has(v.permission);
}
