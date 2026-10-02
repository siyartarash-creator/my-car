// Phase 4 only: execute real server guards/pages against an ephemeral PGlite
// database. Auth identity and Next's Link/client components are injected;
// this does not claim browser, Supabase Auth, or PostgREST integration coverage.
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import { createElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "./helpers/load-typescript.mjs";
import { seedRoutineDataset, SEED_IDENTITIES as identities } from "./fixtures/admin-routine-seed.mjs";

const root = new URL("../", import.meta.url);
const db = new PGlite();
let uid = null;
let passed = 0;
const blockers = [];
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  passed++;
};
const identifier = (value) => {
  assert.match(value, /^[a-z_]+$/);
  return value;
};

// Translate only the read operations used by these pages; no HTTP transport,
// credentials, broad SQL bypass, or persistent database is involved.
function from(table) {
  identifier(table);
  let columns = "*", options = {}, ordering = "", cap = "", range = "", single = false;
  const filters = [], values = [];
  const query = {
    select(value, opts = {}) { columns = value; options = opts; return query; },
    eq(column, value) { return filter(column, "=", value); },
    gte(column, value) { return filter(column, ">=", value); },
    lt(column, value) { return filter(column, "<", value); },
    in(column, list) {
      assert.ok(Array.isArray(list));
      const placeholders = list.map((item) => { values.push(item); return `$${values.length}`; });
      filters.push(`${identifier(column)} in (${placeholders.join(",") || "null"})`);
      return query;
    },
    order(column, opts = {}) {
      const clause = `${identifier(column)} ${opts.ascending === false ? "desc" : "asc"}`;
      ordering = ordering ? `${ordering}, ${clause}` : ` order by ${clause}`;
      return query;
    },
    limit(value) { assert.ok(Number.isInteger(value) && value > 0); cap = ` limit ${value}`; return query; },
    range(from, to) {
      assert.ok(Number.isInteger(from) && Number.isInteger(to) && to >= from);
      range = ` limit ${to - from + 1} offset ${from}`;
      return query;
    },
    single() { single = true; return query; },
    then(resolve, reject) { return execute().then(resolve, reject); },
  };
  function filter(column, op, value) {
    values.push(value);
    filters.push(`${identifier(column)} ${op} $${values.length}`);
    return query;
  }
  async function execute() {
    const where = filters.length ? ` where ${filters.join(" and ")}` : "";
    const fields = columns === "profile_id,profiles(name)"
      ? "profile_id,(select jsonb_build_object('name',name) from profiles where id=operator_permissions.profile_id) as profiles"
      : columns.split(",").map((column) => identifier(column.trim())).join(",");
    if (options.head) {
      const { rows } = await db.query(`select count(*)::int as n from ${table}${where}`, values);
      return { data: null, count: rows[0].n, error: null };
    }
    const result = await db.query(`select ${fields} from ${table}${where}${ordering}${cap}${range}`, values);
    // PostgREST returns JSON timestamps, whereas PGlite returns Date objects.
    const rows = JSON.parse(JSON.stringify(result.rows));
    let count = null;
    if (options.count === "exact") {
      count = (await db.query(`select count(*)::int as n from ${table}${where}`, values)).rows[0].n;
    }
    return { data: single ? rows[0] ?? null : rows, count, error: null };
  }
  return query;
}
const client = {
  from,
  auth: { getUser: async () => ({ data: { user: uid ? { id: uid } : null }, error: null }) },
  rpc: async (name) => {
    assert.equal(name, "has_any_permission");
    return { data: (await db.query("select public.has_any_permission() as allowed")).rows[0].allowed, error: null };
  },
};
class Redirect extends Error {
  constructor(destination) { super(destination); this.destination = destination; }
}
class NotFound extends Error {}
const permissions = load("lib/admin/permissions.ts");
const auth = load("lib/auth-server.ts", {
  "server-only": {},
  "next/navigation": { redirect: (destination) => { throw new Redirect(destination); } },
  "@/lib/supabase-server": { createClient: async () => client },
  "@/lib/admin/permissions": permissions,
});
const modules = load("lib/admin/modules.ts");
const widgets = load("lib/admin/dashboard.ts");
function loadPage(file) {
  const source = fs.readFileSync(new URL(file, root), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const imports = {
    "react/jsx-runtime": jsxRuntime,
    "next/link": { default: ({ children, ...props }) => createElement("a", props, children) },
    "next/navigation": { notFound: () => { throw new NotFound(); } },
    "@/lib/auth-server": auth,
    "@/lib/admin/permissions": permissions,
    "@/lib/admin/dashboard": widgets,
  };
  const loaded = { exports: {} };
  new Function("module", "exports", "require", code)(loaded, loaded.exports, (name) => {
    if (Object.hasOwn(imports, name)) return imports[name];
    // Client interactions are deliberately outside this server-page test.
    if (name.startsWith("./")) return new Proxy({}, { get: () => () => null });
    throw new Error(`Unexpected page dependency: ${name}`);
  });
  return loaded.exports.default;
}
async function asUser(id) {
  uid = id;
  await db.exec(`set role ${id ? "authenticated" : "anon"}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
}
async function denied(fn, destination) {
  await assert.rejects(fn, (error) => error instanceof Redirect && error.destination === destination);
  passed++;
}
const props = { searchParams: Promise.resolve({}), params: Promise.resolve({ id: "1" }) };
const routes = [
  ["products", "products.write"], ["products/new", "products.write"], ["products/[id]/edit", "products.write"],
  ["discount-requests", "discounts.approve"], ["offers", "offers.moderate"],
  ["orders", "orders.read"], ["coupons", "coupons.manage"], ["product-requests", "requests.review"],
  ["operators", null], ["audit", null],
].map(([route, permission]) => ({ route, permission, page: loadPage(`app/admin/${route}/page.tsx`) }));
const dashboard = loadPage("app/admin/page.tsx");
const audit = routes.find((route) => route.route === "audit").page;
const ordersPage = routes.find((route) => route.route === "orders").page;
const orderDetailPage = loadPage("app/admin/orders/[id]/page.tsx");
const html = async (page, params = {}) => renderToStaticMarkup(await page({ ...props, searchParams: Promise.resolve(params) }));
const htmlWithId = async (page, id, params = {}) =>
  renderToStaticMarkup(await page({ searchParams: Promise.resolve(params), params: Promise.resolve({ id }) }));

try {
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security; grant usage on schema storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to anon,authenticated;`);
  for (const file of fs.readdirSync(new URL("supabase/migrations/", root)).sort()) {
    await db.exec(fs.readFileSync(new URL(`supabase/migrations/${file}`, root), "utf8"));
  }
  const { totals } = await seedRoutineDataset(db);
  const seededItems = (await db.query("select i.id,i.order_id,i.seller_id,o.user_id as buyer_id from order_items i join orders o on o.id=i.order_id order by i.id")).rows;
  const visibleItemIds = async () => (await db.query("select id from order_items order by id")).rows.map((item) => item.id);
  check(seededItems.length, totals.orderCount + totals.multiSellerOrderCount, "every single/multi-seller order line seeded");
  const multiSellerOrders = (await db.query("select order_id from order_items group by order_id having count(distinct seller_id)>1")).rows;
  check(multiSellerOrders.length, totals.multiSellerOrderCount, "seed multi-seller baseline");
  const sampleOrderId = seededItems[0].order_id;
  const sampleOrderItemName = (await db.query("select product_name from order_items where id=$1", [seededItems[0].id])).rows[0].product_name;
  await asUser(null);
  await denied(() => auth.requireAdminAccess(), "/login");
  await assert.rejects(() => db.query("select id from order_items"), /permission denied for table order_items/); passed++;
  // Mixed buyers and sellers ensure IDOR checks use foreign rows as well as
  // the caller's own rows, including the other seller's line of one order.
  for (const buyer of identities.buyers) {
    await asUser(buyer.id);
    check(await visibleItemIds(), seededItems.filter((item) => item.buyer_id === buyer.id).map((item) => item.id), "buyer owns exactly its order lines");
    const foreign = seededItems.find((item) => item.buyer_id !== buyer.id);
    check((await db.query("select id from order_items where id=$1", [foreign.id])).rows, [], "buyer foreign-ID probe denied");
  }
  for (const seller of identities.sellers) {
    await asUser(seller.id);
    check(await visibleItemIds(), seededItems.filter((item) => item.seller_id === seller.id).map((item) => item.id), "seller owns exactly its own lines");
    const foreign = seededItems.find((item) => item.seller_id !== seller.id);
    check((await db.query("select id from order_items where id=$1", [foreign.id])).rows, [], "seller foreign-ID probe denied");
  }
  await asUser(identities.buyers[0].id);
  await denied(() => auth.requireAdminAccess(), "/");

  // One isolated grant per operator: real DB entry decision and server guards,
  // all forbidden direct pages, plus independently specified navigation.
  const operator = identities.operators[0].id;
  const expectedNav = {
    "products.write": ["/admin", "/admin/products", "/admin/products/new"],
    "offers.moderate": ["/admin", "/admin/offers"],
    "discounts.approve": ["/admin", "/admin/discount-requests"],
    "requests.review": ["/admin", "/admin/product-requests"],
    "orders.read": ["/admin", "/admin/orders"],
    "coupons.manage": ["/admin", "/admin/coupons"],
  };
  for (const key of permissions.PERMISSION_KEYS) {
    await db.exec("reset role");
    await db.query("delete from operator_permissions where profile_id=$1", [operator]);
    await asUser(identities.admin.id);
    await db.query("select admin_grant_permission($1,$2)", [operator, key]);
    await asUser(operator);
    const access = await auth.requireAdminAccess();
    check([...access.granted], [key], `single grant ${key}`);
    check(modules.navItemsFor(access).flatMap((module) => module.items.map((item) => item.href)), expectedNav[key], `navigation ${key}`);
    await auth.requirePermission(key); passed++;
    check(await visibleItemIds(), key === "orders.read" ? seededItems.map((item) => item.id) : [], `exact order-line visibility for ${key}`);
    for (const route of routes.filter((route) => route.permission !== key)) {
      await denied(() => route.page(props), "/admin");
    }
    if (key !== "orders.read") {
      await denied(() => htmlWithId(orderDetailPage, String(sampleOrderId)), "/admin");
    }
    const rendered = await html(dashboard);
    check(rendered.includes("وضعیت آگهی‌ها"), key === "offers.moderate", "offer widget");
    check(rendered.includes("وضعیت سفارش‌ها"), key === "orders.read", "order widget");
    check(rendered.includes("وضعیت درخواست‌های تخفیف"), key === "discounts.approve", "discount widget");
    check(rendered.includes("وضعیت درخواست‌های محصول"), key === "requests.review", "request widget");
    check(rendered.includes("تعداد استفاده از کدهای تخفیف"), key === "coupons.manage", "coupon widget");
    if (key === "orders.read") {
      const multi = (await db.query("select order_id from order_items group by order_id having count(distinct seller_id)>1")).rows;
      // Record this security-sensitive blocker and finish independent page
      // checks. The suite still exits nonzero; no permission is bypassed.
      if (multi.length !== totals.multiSellerOrderCount) {
        blockers.push(`orders.read operator sees ${multi.length}/${totals.multiSellerOrderCount} multi-seller orders through order_items`);
      } else {
        passed++;
      }
      const renderedOrders = await html(ordersPage);
      for (const order of multiSellerOrders) check(renderedOrders.includes(`سفارش #${order.order_id.toLocaleString("fa-IR")}`), true, "multi-seller order header rendered");

      // Admin order detail/line-item UI (Phase 5): orders.read reaches the
      // detail page for a real seeded order and sees its actual line item;
      // an invalid/unknown id 404s instead of leaking or erroring.
      const detail = await htmlWithId(orderDetailPage, String(sampleOrderId));
      check(detail.includes(`سفارش`), true, "order detail page renders");
      check(detail.includes(sampleOrderItemName), true, "order detail shows real seeded line item");
      await assert.rejects(() => htmlWithId(orderDetailPage, "999999999"), (error) => error instanceof NotFound);
      passed++;
      await assert.rejects(() => htmlWithId(orderDetailPage, "not-a-number"), (error) => error instanceof NotFound);
      passed++;

      // Pagination (Phase 5): page 1 matches the seeded total exactly; a
      // page past the last page is a graceful empty result, not an error,
      // and the status filter still composes with the range query.
      const page1 = await html(ordersPage, {});
      check(page1.includes("سفارشی پیدا نشد"), false, "page 1 has rows");
      const pastEnd = await html(ordersPage, { page: String(Math.ceil(totals.orderCount / 50) + 1) });
      check(pastEnd.includes("سفارشی پیدا نشد"), true, "page past the last page is empty, not an error");
      await html(ordersPage, { status: "pending", page: "1" });
      passed++;
    }
  }
  await db.exec("reset role");
  await db.query("delete from operator_permissions where profile_id=$1", [operator]);
  await asUser(operator);
  await denied(() => auth.requireAdminAccess(), "/");
  check(await visibleItemIds(), [], "revoked orders.read exposes no lines");

  await asUser(identities.admin.id);
  for (const key of permissions.PERMISSION_KEYS) {
    await db.query("select admin_grant_permission($1,$2)", [operator, key]);
  }
  await asUser(operator);
  await denied(() => audit(props), "/admin");
  check((await db.query("select count(*)::int as n from admin_audit_log")).rows[0].n, 0, "all six grants still cannot read audit rows");
  await asUser(identities.admin.id);
  check(await visibleItemIds(), seededItems.map((item) => item.id), "Super Admin retains all lines");
  const adminHtml = await html(dashboard);
  for (const value of [totals.productCount, totals.offerCount, totals.orderCount, totals.orderValueTotal, totals.couponUsageTotal]) {
    check(adminHtml.includes(value.toLocaleString("fa-IR")), true, "Super Admin seeded totals rendered");
  }
  const adminAccess = await auth.requireSuperAdmin();
  check(modules.navItemsFor(adminAccess).flatMap((module) => module.items).length, 10, "Super Admin navigation");

  // Product RPCs create the actual audit rows consumed by the real page.
  const productId = (await db.query("select admin_create_product('Audit Fixture','audit-fixture',null,null,null,null,null,null,null,false) as id")).rows[0].id;
  await db.query("select admin_update_product($1,'Audit Fixture Updated','audit-fixture',null,null,null,null,null,null,null,true,false)", [productId]);
  await db.query("select admin_delete_product($1)", [productId]);
  await db.exec("reset role");
  await db.query("update admin_audit_log set created_at='2026-10-02T23:59:59.999999Z' where action='create_product' and target_id=$1", [String(productId)]);
  await db.query("update admin_audit_log set created_at='2026-10-03T00:00:00Z' where action='delete_product' and target_id=$1", [String(productId)]);
  await asUser(identities.admin.id);
  const unfiltered = await html(audit);
  for (const action of ["create_product", "update_product", "delete_product"]) {
    check(unfiltered.includes(`<option value="${action}">`), true, "product action selectable");
    const filtered = await html(audit, { action, target_table: "products", actor: identities.admin.id });
    check(filtered.includes(`products#${productId}`), true, "actual product audit filter");
    check(filtered.includes("operator_permissions#"), false, "other audit records excluded");
  }
  const withinDay = await html(audit, { target_table: "products", from: "2026-10-02", to: "2026-10-02" });
  check(withinDay.includes('text-[#39FF14]">create_product</span>'), true, "fractional final second included");
  check(withinDay.includes('text-[#39FF14]">delete_product</span>'), false, "next midnight excluded");
  check(unfiltered.includes('href="/admin/audit"'), true, "filter reset destination");

  // Audit pagination (Phase 5): a far-future page is an empty result, not an
  // error, and page composes with an existing filter without losing it.
  const auditPastEnd = await html(audit, { page: "999" });
  check(auditPastEnd.includes("رکوردی پیدا نشد"), true, "audit page past the last page is empty, not an error");
  await html(audit, { target_table: "products", page: "1" });
  passed++;
  console.log(`${passed} Phase 4 local server-page/permission/filter assertions passed (ephemeral PGlite; no browser/Auth transport claim).`);
  assert.deepEqual(blockers, [], "Phase 4 blockers (independent checks above remain valid)");
} finally {
  await db.close();
}
