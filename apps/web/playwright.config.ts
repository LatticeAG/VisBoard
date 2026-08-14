import { defineConfig, devices } from "@playwright/test";

const port = process.env.PLAYWRIGHT_WEB_PORT ?? (process.env.CI ? "3000" : "3010");
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    // next start is incompatible with output: standalone, so serve via
    // dev mode for e2e (dev-server-only change; prod build untouched).
    command: `npx next dev --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
