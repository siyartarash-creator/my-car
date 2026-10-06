import { expect, test } from "@playwright/test";

test.describe("guest and role entry points", () => {
  test("public Store and account entry points render", async ({ page }) => {
    for (const path of ["/", "/shop", "/login", "/register"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBeLessThan(500);
      await expect(page.locator("body"), path).not.toBeEmpty();
    }
  });

  test("registration exposes only the four approved self-service roles", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByRole("button", { name: /صاحبان خودرو/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /فروشندگان قطعات/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /ارائه‌دهندگان خدمات فنی/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /امداد رسان‌ها/ })).toBeVisible();
    await expect(page.getByText(/مدیر|ادمین/, { exact: false })).toHaveCount(0);
  });

  test("malformed login is rejected without calling Auth", async ({ page }) => {
    let authCalls = 0;
    await page.route("**/auth/v1/**", async (route) => {
      authCalls += 1;
      await route.abort();
    });
    await page.goto("/login");
    await page.getByPlaceholder("09xxxxxxxxx").fill("0912");
    await page.getByPlaceholder("••••••").fill("123");
    await page.getByRole("button", { name: "ورود به حساب" }).click();
    await expect(page.getByText(/شماره موبایل درست نیست/)).toBeVisible();
    expect(authCalls).toBe(0);
  });

  test("double-click registration dispatches one signup request", async ({ page }) => {
    let signupCalls = 0;
    await page.route("**/auth/v1/signup", async (route) => {
      signupCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "test-bot-stub", error_description: "test-bot-stub" }),
      });
    });
    await page.goto("/register");
    await page.getByRole("button", { name: /فروشندگان قطعات/ }).click();
    await page.getByPlaceholder("مثلاً مهدی رضایی").fill("مهدی رضایی");
    await page.getByPlaceholder("09xxxxxxxxx").fill("09123456789");
    await page.getByPlaceholder("حداقل ۶ کاراکتر").fill("safe-pass-123");
    await page.getByPlaceholder("همون رمز رو دوباره وارد کن").fill("safe-pass-123");
    const submit = page.locator('button[type="submit"]');
    await submit.dblclick();
    await expect(submit).toBeDisabled();
    await expect.poll(() => signupCalls).toBe(1);
  });
});

test.describe("write boundary", () => {
  test("cross-origin write is rejected before authentication", async ({ request }) => {
    const response = await request.post("/api/write/checkout", {
      headers: { Origin: "https://evil.invalid" },
      data: {},
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ error: "درخواست نامعتبر است" });
  });

  test("non-JSON write fails closed before authentication", async ({ page }) => {
    await page.goto("/login");
    const status = await page.evaluate(async () => {
      const response = await fetch("/api/write/quote", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "not-json",
      });
      return response.status;
    });
    expect([403, 415]).toContain(status);
  });
});
