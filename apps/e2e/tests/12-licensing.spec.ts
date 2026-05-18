import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loginAsAgentInUI,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DASHBOARD_BASE,
} from "./helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

// Use a different port to avoid colliding with anything the user may have
// running on the default 4400.
const LICENSE_PORT = 4401;
const LICENSE_BASE = `http://127.0.0.1:${LICENSE_PORT}`;
const ADMIN_BASIC = Buffer.from("admin:test-license-admin-pw").toString(
  "base64",
);
const ADMIN_HEADERS = { Authorization: `Basic ${ADMIN_BASIC}` };

let licenseProc: ChildProcess | null = null;
let dbPath: string;

async function waitForHealth(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${LICENSE_BASE}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("license server didn't come up");
}

test.describe("Licensing — server REST flows", () => {
  test.beforeAll(async () => {
    dbPath = path.join(
      repoRoot,
      "apps/license-server/data",
      `e2e-${Date.now()}.db`,
    );
    licenseProc = spawn("pnpm", ["--filter", "@hzaconnect/license-server", "dev"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PORT: String(LICENSE_PORT),
        DB_PATH: dbPath,
        ADMIN_USERNAME: "admin",
        ADMIN_PASSWORD: "test-license-admin-pw",
        NODE_ENV: "development",
      },
      stdio: "ignore",
    });
    await waitForHealth();
  });

  test.afterAll(async () => {
    licenseProc?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 200));
  });

  test("heartbeat for unknown license returns suspended", async () => {
    const res = await fetch(`${LICENSE_BASE}/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        license_id: "lic_doesnotexist",
        customer_id: "cus_doesnotexist",
      }),
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.status).toBe("unknown_license");
    expect(body.message).toBe("Service suspended.");
  });

  test("admin issues license, heartbeat=ok, suspend → heartbeat=suspended, resume → ok", async () => {
    // Create a customer with an initial license through the admin form-post.
    const form = new URLSearchParams();
    form.set("name", "E2E Casino");
    form.set("contact_email", "ops@e2e.local");
    form.set("notes", "auto-created by e2e");
    form.set("duration_days", "30");
    const createRes = await fetch(`${LICENSE_BASE}/admin/customers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...ADMIN_HEADERS,
      },
      body: form.toString(),
      redirect: "manual",
    });
    expect(createRes.ok).toBe(true);
    const html = await createRes.text();
    // Pull the issued token out of the <pre> in the response.
    const tokenMatch = html.match(/<pre>([A-Za-z0-9_\-.]+)<\/pre>/);
    expect(tokenMatch?.[1]).toBeTruthy();
    const tokenSegments = tokenMatch![1]!.split(".");
    expect(tokenSegments.length).toBe(2);
    // Decode the payload to extract license/customer ids for heartbeats.
    const payload = JSON.parse(
      Buffer.from(
        tokenSegments[0]!.replaceAll("-", "+").replaceAll("_", "/") +
          "=".repeat((4 - (tokenSegments[0]!.length % 4)) % 4),
        "base64",
      ).toString("utf8"),
    );
    const { license_id, customer_id } = payload;

    // Heartbeat: ok
    let res = await fetch(`${LICENSE_BASE}/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ license_id, customer_id }),
    });
    let body = await res.json();
    expect(body.status).toBe("ok");

    // Suspend the customer
    const suspendRes = await fetch(
      `${LICENSE_BASE}/admin/customers/${customer_id}/suspend`,
      {
        method: "POST",
        headers: ADMIN_HEADERS,
        redirect: "manual",
      },
    );
    expect([200, 302, 303].includes(suspendRes.status)).toBe(true);

    // Heartbeat: suspended
    res = await fetch(`${LICENSE_BASE}/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ license_id, customer_id }),
    });
    body = await res.json();
    expect(body.status).toBe("suspended");
    expect(body.message).toBe("Service suspended.");

    // Resume
    const resumeRes = await fetch(
      `${LICENSE_BASE}/admin/customers/${customer_id}/resume`,
      {
        method: "POST",
        headers: ADMIN_HEADERS,
        redirect: "manual",
      },
    );
    expect([200, 302, 303].includes(resumeRes.status)).toBe(true);

    // Heartbeat: ok again
    res = await fetch(`${LICENSE_BASE}/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ license_id, customer_id }),
    });
    body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("admin endpoints reject unauthenticated requests", async () => {
    const res = await fetch(`${LICENSE_BASE}/admin`, { redirect: "manual" });
    expect(res.status).toBe(401);
  });
});

test.describe("Licensing — dashboard banner", () => {
  test("banner appears when /api/license/status returns ok:false", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // Stub the status endpoint as suspended.
    await page.route("**/api/license/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          reason: "suspended",
          customer_name: "Test Casino",
        }),
      }),
    );

    await loginAsAgentInUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("alert")).toHaveText(/Service suspended/);

    await ctx.close();
  });

  test("banner stays hidden when license is ok", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAsAgentInUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    // Default dev API has LICENSE_ENFORCEMENT=disabled → status returns ok:true
    await page.waitForTimeout(500);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await ctx.close();
  });
});
