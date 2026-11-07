import { defineConfig, devices } from "@playwright/test";

const port = process.env.PLAYWRIGHT_WEB_PORT ?? (process.env.CI ? "3000" : "3010");
// CI builds the web app in its own step (with NODE_ENV=production); rebuilding
// here would run a second, differently-configured next build and reload the
// NODE_ENV-sensitive prerender path. Skip the rebuild when the caller already
// produced the standalone output.
const skipBuild = process.env.PLAYWRIGHT_SKIP_BUILD === "1";
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
    // `next start` does not support `output: "standalone"` (Next warns and
    // refuses to serve correctly), so run the emitted standalone server instead.
    command: `${skipBuild ? "" : "pnpm exec next build && "}PORT=${port} node scripts/serve-standalone.mjs`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 300_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
