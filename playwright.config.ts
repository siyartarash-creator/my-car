import { defineConfig, devices } from "@playwright/test";

const staging = process.env.TEST_BOT_TARGET === "staging";
const localPort = 3100;
const browserChannel = process.env.TEST_BOT_BROWSER_CHANNEL as "chrome" | "msedge" | undefined;
const baseURL = staging
  ? process.env.TEST_BOT_BASE_URL
  : `http://127.0.0.1:${localPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["line"],
    ["html", { outputFolder: "reports/test-bot/playwright", open: "never" }],
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: browserChannel ? "off" : "retain-on-failure",
    locale: "fa-IR",
    timezoneId: "Asia/Tehran",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], channel: browserChannel } },
  ],
  webServer: staging
    ? undefined
    : {
        command: `npm run dev -- --hostname 127.0.0.1 --port ${localPort}`,
        url: `http://127.0.0.1:${localPort}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-bot-local-anon-key",
        },
      },
});
