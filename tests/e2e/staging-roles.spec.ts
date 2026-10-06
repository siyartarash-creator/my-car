import { expect, test, type Page } from "@playwright/test";

type Role = "OWNER" | "SELLER" | "SERVICE" | "RESCUER";
const STAGING_SUPABASE_HOST = "hhkwntnbycpbypsaqvrc.supabase.co";
let deployedSupabaseVerified = false;

async function verifyDeployedSupabaseTarget(page: Page) {
  if (deployedSupabaseVerified) return;
  let observedHost = "";
  const authPattern = "**/auth/v1/token**";
  await page.route(authPattern, async (route) => {
    observedHost = new URL(route.request().url()).hostname;
    await route.abort("blockedbyclient");
  }, { times: 1 });
  await page.getByPlaceholder("09xxxxxxxxx").fill("09100000000");
  await page.getByPlaceholder("••••••").fill("test-bot-target-probe");
  await page.getByRole("button", { name: "ورود به حساب" }).click();
  await expect.poll(() => observedHost, { timeout: 5_000 }).not.toBe("");
  await page.unroute(authPattern);
  expect(observedHost, "deployed application must use the exact staging Supabase project").toBe(STAGING_SUPABASE_HOST);
  deployedSupabaseVerified = true;
  await page.reload();
}

async function login(page: Page, role: Role) {
  const mobile = process.env[`TEST_BOT_${role}_MOBILE`];
  const password = process.env[`TEST_BOT_${role}_PASSWORD`];
  test.skip(!mobile || !password, `${role} fixture is not configured`);
  await page.goto("/login");
  try {
    await expect(page.getByPlaceholder("09xxxxxxxxx")).toBeVisible({ timeout: 5_000 });
  } catch (error) {
    if (new URL(page.url()).hostname !== process.env.TEST_BOT_ALLOWED_HOST) {
      throw new Error("STAGING BLOCKED: Netlify team-login protection prevented the isolated browser/CI runner from reaching the application");
    }
    throw error;
  }
  await verifyDeployedSupabaseTarget(page);
  await page.getByPlaceholder("09xxxxxxxxx").fill(mobile!);
  await page.getByPlaceholder("••••••").fill(password!);
  const authResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/auth/v1/token") && response.request().method() === "POST",
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: "ورود به حساب" }).click();
  const authResponse = await authResponsePromise;
  expect(new URL(authResponse.url()).hostname).toBe(STAGING_SUPABASE_HOST);
  if (!authResponse.ok()) {
    const body = await authResponse.json().catch(() => ({}));
    throw new Error(`staging Auth rejected ${role}: status=${authResponse.status()} code=${body.code ?? "unknown"}`);
  }
  await expect(page).toHaveURL(/\/dashboard(?:$|\?)/, { timeout: 15_000 });
}

test.describe("@staging authenticated role journeys", () => {
  test.describe.configure({ mode: "serial" });

  for (const role of ["OWNER", "SELLER", "SERVICE", "RESCUER"] as const) {
    test(`${role} can authenticate and open Profile read-only entry`, async ({ page }) => {
      await login(page, role);
      await page.goto("/profile");
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.locator("body")).toContainText(/پروفایل|اطلاعات/);
    });
  }

  for (const role of ["OWNER", "SERVICE", "RESCUER"] as const) {
    test(`${role} cannot cross the Seller boundary`, async ({ page }) => {
      await login(page, role);
      await page.goto("/seller");
      await expect(page).not.toHaveURL(/\/seller(?:$|\/)/);
    });
  }

  test("seller Store Manager can enter Seller and cannot enter Admin", async ({ page }) => {
    await login(page, "SELLER");
    await page.goto("/seller");
    await expect(page).toHaveURL(/\/seller(?:$|\/)/);
    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/admin(?:$|\/)/);
  });
});
