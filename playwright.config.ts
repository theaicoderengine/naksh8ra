import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E tests. Requires a running app (npm run build && npm start) with
 * QUEUE_MODE=inline, LLM_PROVIDER=fixture, STT_PROVIDER=fixture,
 * ALLOW_FIXTURE_PROVIDERS=true and EMAIL_PROVIDER=console (dev mailbox).
 * CI starts the server via `webServer`.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure", permissions: ["microphone"] },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } } }],
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "npm run start", url: "http://localhost:3000/api/health", reuseExistingServer: true, timeout: 120_000 },
});
