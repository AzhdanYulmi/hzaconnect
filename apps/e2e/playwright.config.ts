import { defineConfig, devices } from "@playwright/test";

const API_BASE = process.env.HZA_API_BASE ?? "http://localhost:3000";
const DASHBOARD_BASE = process.env.HZA_DASHBOARD_BASE ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,           // many tests share queue/conversation state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: DASHBOARD_BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Catches Safari-specific regressions (background-tab WebSocket, ITP).
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  metadata: {
    apiBase: API_BASE,
    dashboardBase: DASHBOARD_BASE,
  },
});
