import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against the real app in Wails' server mode, started by
// scripts/e2e.sh (lgx e2e), which sets QUEL_E2E_URL and QUEL_E2E_DB.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.QUEL_E2E_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
});
