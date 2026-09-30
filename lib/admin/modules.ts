import type { PermissionKey } from "./permissions";

// Typed static Admin module registry (UI metadata only -- never an
// authorization boundary; see .claude/skills/my-car-admin/SKILL.md).
// Future modules (Finance, Users, Automotive Services, AI, Social, Heavy
// Vehicles, Navigation/Logistics) add entries here; they do not rewrite the
// Admin Core shell, navigation, or auth helpers.
export type AdminNavItem = {
  href: string;
  label: string;
  icon: string;
  // Coarse gate for showing the nav link. `null` means "any profile that can
  // enter the Admin shell" (Super Admin or any operator grant). A specific
  // key means "show only if the profile holds this permission (or is Super
  // Admin)". This is UX only -- the destination page/action re-enforces the
  // same permission server-side regardless of what the nav shows.
  permission: PermissionKey | null;
  badgeKey?: "pendingProductRequests" | "pendingDiscountRequests";
};

export type AdminModule = {
  key: string;
  label: string;
  items: AdminNavItem[];
  // Super-Admin-only module: hidden from the nav (and the pages it links to
  // still self-enforce) for any profile that is not Super Admin, regardless
  // of operator_permissions grants.
  superAdminOnly?: boolean;
};

export const ADMIN_MODULES: AdminModule[] = [
  {
    key: "core",
    label: "هسته ادمین",
    items: [{ href: "/admin", label: "داشبورد", icon: "📊", permission: null }],
  },
  {
    // NOTE: plain product/category CRUD (products, products/new) is not
    // wired to a specific permission key -- it remains Super-Admin-only via
    // its pre-existing RLS policy (not named in the locked atomic-audit
    // list), out of this checkpoint's scope. product-requests and coupons
    // ARE wired below: both moved to audited RPCs in this checkpoint.
    key: "store",
    label: "فروشگاه",
    items: [
      { href: "/admin/products", label: "محصولات", icon: "📦", permission: null },
      { href: "/admin/products/new", label: "افزودن محصول", icon: "➕", permission: null },
      {
        href: "/admin/product-requests",
        label: "درخواست‌های محصول",
        icon: "📨",
        permission: "requests.review",
        badgeKey: "pendingProductRequests",
      },
      { href: "/admin/coupons", label: "کدهای تخفیف", icon: "🏷️", permission: "coupons.manage" },
      { href: "/admin/discount-requests", label: "درخواست‌های تخفیف", icon: "💸", permission: "discounts.approve" },
      { href: "/admin/offers", label: "مدیریت آگهی‌ها", icon: "🛒", permission: "offers.moderate" },
      { href: "/admin/orders", label: "سفارشات", icon: "🛍️", permission: "orders.read" },
    ],
  },
  {
    key: "operators",
    label: "مدیریت دسترسی",
    superAdminOnly: true,
    items: [{ href: "/admin/operators", label: "اپراتورها", icon: "🛡️", permission: null }],
  },
];

export function navItemsFor(permissions: {
  isAdmin: boolean;
  granted: ReadonlySet<PermissionKey>;
}): AdminModule[] {
  return ADMIN_MODULES.filter((m) => permissions.isAdmin || !m.superAdminOnly)
    .map((m) => ({
      ...m,
      items: m.items.filter(
        (item) => permissions.isAdmin || item.permission === null || permissions.granted.has(item.permission),
      ),
    }))
    .filter((m) => m.items.length > 0);
}
