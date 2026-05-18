import { type Page, type BrowserContext, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const API_BASE = process.env.HZA_API_BASE ?? "http://localhost:3000";
export const DASHBOARD_BASE =
  process.env.HZA_DASHBOARD_BASE ?? "http://localhost:5173";
export const HOST_BASE = `${API_BASE}/dev/host.html`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readEnv(): Record<string, string> {
  const envPath = path.resolve(__dirname, "../../../.env");
  if (!fs.existsSync(envPath)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && m[1] !== undefined && m[2] !== undefined) out[m[1]] = m[2];
  }
  return out;
}

const env = readEnv();
export const ADMIN_EMAIL =
  env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@example.com";
export const ADMIN_PASSWORD = env.BOOTSTRAP_ADMIN_PASSWORD ?? "";

export async function createAgent(opts: {
  email: string;
  password: string;
  display_name: string;
  role?: "agent" | "supervisor" | "admin";
}): Promise<void> {
  // Login as bootstrap admin then create.
  const login = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!login.ok) throw new Error(`admin login failed: ${login.status}`);
  const { access_token } = await login.json();

  const res = await fetch(`${API_BASE}/api/auth/agents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify({
      email: opts.email,
      password: opts.password,
      display_name: opts.display_name,
      role: opts.role ?? "agent",
    }),
  });
  if (res.status === 500) {
    // Likely duplicate email — fine for retried test runs.
    return;
  }
  if (!res.ok) throw new Error(`create agent failed: ${res.status}`);
}

export async function loginAsAgentInUI(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto(DASHBOARD_BASE);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  // The chat-view logout is an icon-only button with an aria-label;
  // the admin-view logout has visible text. Match on accessible name.
  await expect(
    page.getByRole("button", { name: /^(Logout|Çıkış yap)$/ }),
  ).toBeVisible();
}

/**
 * Open the host fixture page and return after the widget script has booted.
 * The widget itself is in a closed shadow root + iframe; we drive it via
 * window.hzaconnect and via the iframe directly.
 */
export async function openHostPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(HOST_BASE);
  await page.waitForFunction(() => !!(window as any).hzaconnect);
  return page;
}

export async function openWidget(page: Page, timeoutMs = 10_000) {
  await page.evaluate(() => (window as any).hzaconnect.open());
  // The widget iframe lives inside a *closed* shadow root, so the host
  // document can't query it via DOM APIs. But Chromium tracks every Frame
  // regardless of DOM placement — Playwright's page.frames() lists them all.
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const target = page
      .frames()
      .find((f) => f.url().includes("/widget/frame.html"));
    if (target) {
      // Wait for the iframe body to render any interactive control. The
      // widget may show either the chat composer (textarea) or the pre-chat
      // identification form (inputs) depending on deployment settings.
      try {
        await target.waitForSelector("textarea, input, button", { timeout: 2_000 });
        return target;
      } catch {
        // keep polling — the frame may still be loading
      }
    }
    await page.waitForTimeout(150);
  }
  throw new Error("widget iframe never appeared");
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@e2e.local`;
}
