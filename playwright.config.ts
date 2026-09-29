import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Browser smoke tests over the five core flows (sprint 2, F-01): sign in
// and the forced password change; enter an order; validate, allocate and
// release it; ship it and see the invoice; issue and receive a return and
// see the credit memo. They run against the dev servers on their own ports
// (API 4100, client 5174) and a seeded database - see e2e/README.md.
const API_PORT = 4100;
const UI_PORT = 5174;
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://erp_app:erp@localhost:5432/erp_e2e?schema=public";
const chromiumPath = [process.env.PLAYWRIGHT_CHROMIUM, "/opt/pw-browsers/chromium"].find((p) => p && existsSync(p));

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${UI_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // A pre-installed Chromium (PLAYWRIGHT_CHROMIUM, or the container's
    // /opt/pw-browsers/chromium) is used when present; CI downloads one.
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : undefined,
  },
  webServer: [
    {
      command: "npx tsx src/index.ts",
      cwd: "server",
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        DATABASE_URL,
        PORT: String(API_PORT),
        QBO_FAKE: "1",
        QBO_SYNC_INTERVAL_MS: "600000",
        JWT_SECRET: process.env.JWT_SECRET ?? "e2e-only-secret-0123456789abcdef",
        TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY ?? "0".repeat(64),
      },
    },
    {
      command: `npx vite --port ${UI_PORT} --strictPort`,
      url: `http://localhost:${UI_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { VITE_API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
