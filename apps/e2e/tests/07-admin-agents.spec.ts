import { test, expect } from "@playwright/test";
import {
  loginAsAgentInUI,
  uniqueEmail,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DASHBOARD_BASE,
} from "./helpers.js";

test.describe("Admin agent management", () => {
  test("admin can create an agent via the UI; new agent can sign in", async ({
    browser,
  }) => {
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await loginAsAgentInUI(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Open admin view
    await adminPage.getByRole("button", { name: "Admin" }).click();
    await expect(adminPage.getByText("Agent management")).toBeVisible();

    // Create a fresh agent
    const newEmail = uniqueEmail("admin-ui-agent");
    const newPassword = "ui-created-strong-password-1234";
    await adminPage.getByLabel("New agent email").fill(newEmail);
    await adminPage.getByLabel("New agent display name").fill("UI Created");
    await adminPage.getByLabel("New agent password").fill(newPassword);
    await adminPage.getByRole("button", { name: "Create" }).click();

    // It appears in the table
    await expect(adminPage.getByText(newEmail)).toBeVisible({ timeout: 5_000 });

    // The new agent can log in
    const newCtx = await browser.newContext();
    const newPage = await newCtx.newPage();
    await loginAsAgentInUI(newPage, newEmail, newPassword);
    await expect(
      newPage.getByRole("button", { name: /Logout/ }),
    ).toBeVisible();

    await newCtx.close();
    await adminCtx.close();
  });

  test("admin can disable an agent; disabled agent cannot log in", async ({
    browser,
  }) => {
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await loginAsAgentInUI(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Create a new agent via UI
    await adminPage.getByRole("button", { name: "Admin" }).click();
    const targetEmail = uniqueEmail("disable-target");
    const targetPassword = "disable-target-password-1234";
    await adminPage.getByLabel("New agent email").fill(targetEmail);
    await adminPage.getByLabel("New agent display name").fill("Disable Me");
    await adminPage.getByLabel("New agent password").fill(targetPassword);
    await adminPage.getByRole("button", { name: "Create" }).click();
    await expect(adminPage.getByText(targetEmail)).toBeVisible();

    // Click "Disable" on the row containing that email
    const targetRow = adminPage.locator("tr", { hasText: targetEmail });
    await targetRow.getByRole("button", { name: "Disable" }).click();
    await expect(targetRow.getByText("disabled")).toBeVisible();

    // Disabled agent cannot log in
    const disabledCtx = await browser.newContext();
    const disabledPage = await disabledCtx.newPage();
    await disabledPage.goto(DASHBOARD_BASE);
    await disabledPage.getByLabel("Email").fill(targetEmail);
    await disabledPage.getByLabel("Password").fill(targetPassword);
    await disabledPage.getByRole("button", { name: /sign in/i }).click();
    await expect(disabledPage.locator(".error")).toBeVisible({ timeout: 5_000 });

    await disabledCtx.close();
    await adminCtx.close();
  });

  test("admin cannot disable themselves", async ({ browser }) => {
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await loginAsAgentInUI(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD);
    await adminPage.getByRole("button", { name: "Admin" }).click();

    const myRow = adminPage.locator("tr", { hasText: ADMIN_EMAIL });
    const disableBtn = myRow.getByRole("button", { name: "Disable" });
    // Self-row's Disable button is rendered but disabled — verify it's not clickable.
    await expect(disableBtn).toBeDisabled();

    await adminCtx.close();
  });

  test("embed snippet tab shows a copyable script tag for the casino site", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAsAgentInUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Admin" }).click();
    await page.getByRole("button", { name: "Embed" }).click();
    await expect(page.getByRole("heading", { name: "Snippet" })).toBeVisible();

    // The displayed snippet should be a complete script tag pointing at /widget.js.
    const snippet = await page.locator("pre code").innerText();
    expect(snippet).toContain("<script");
    expect(snippet).toContain("/widget.js");
    expect(snippet).toContain('data-deployment="default"');
    expect(snippet).toContain('data-position="right"');

    // Changing the deployment input updates the snippet live.
    await page.getByLabel("Deployment ID").fill("acme-casino");
    const updated = await page.locator("pre code").innerText();
    expect(updated).toContain('data-deployment="acme-casino"');

    await ctx.close();
  });

  test("maintenance tab can run close-stale and prune-sessions", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAsAgentInUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Admin" }).click();
    await page.getByRole("button", { name: "Maintenance" }).click();

    await page.getByRole("button", { name: /^Close stale/ }).click();
    // Result chip appears with the JSON response.
    await expect(page.getByText(/close-stale: \{"closed":\d+/)).toBeVisible({
      timeout: 5_000,
    });

    await page.getByRole("button", { name: /^Prune sessions/ }).click();
    await expect(page.getByText(/prune-sessions: \{"pruned":\d+/)).toBeVisible({
      timeout: 5_000,
    });

    await ctx.close();
  });

  test("non-admin agent does not see the Admin button", async ({ browser }) => {
    // Make a fresh plain-agent account through the API (re-uses createAgent helper).
    const email = uniqueEmail("non-admin");
    const password = "non-admin-password-1234";
    const adminLogin = await fetch(
      `${process.env.HZA_API_BASE ?? "http://localhost:3000"}/api/auth/login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      },
    );
    const { access_token } = await adminLogin.json();
    await fetch(
      `${process.env.HZA_API_BASE ?? "http://localhost:3000"}/api/auth/agents`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${access_token}`,
        },
        body: JSON.stringify({
          email,
          password,
          display_name: "Non Admin",
          role: "agent",
        }),
      },
    );

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAsAgentInUI(page, email, password);
    await expect(page.getByRole("button", { name: /Logout/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Admin" })).toHaveCount(0);

    await ctx.close();
  });
});
