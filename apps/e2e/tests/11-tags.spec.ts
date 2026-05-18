import { test, expect } from "@playwright/test";
import {
  loginAsAgentInUI,
  uniqueEmail,
  createAgent,
  openHostPage,
  openWidget,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  API_BASE,
} from "./helpers.js";

async function adminLogin(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const data = await res.json();
  return data.access_token as string;
}

async function archiveAllExisting(token: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/tags`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const list = (await res.json()) as Array<{ id: string; archived_at: string | null }>;
  for (const tag of list.filter((t) => !t.archived_at)) {
    await fetch(`${API_BASE}/api/admin/tags/${tag.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ archived: true }),
    });
  }
}

test.describe("Tags", () => {
  test("admin can create + archive a tag from the UI", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAsAgentInUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Admin" }).click();
    await page.getByRole("button", { name: "Tags" }).click();
    await expect(page.getByRole("heading", { name: "Create tag" })).toBeVisible();

    const label = `T-${Date.now()}`;
    await page.getByPlaceholder("Label (English)").fill(label);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.locator("table .tag-chip", { hasText: label })).toBeVisible();

    // Archive
    const row = page.locator("tr", { hasText: label });
    await row.getByRole("button", { name: "Archive" }).click();
    await expect(row).toHaveCSS("opacity", "0.4");

    await ctx.close();
  });

  test("agent applies a tag, queue filter narrows the list to tagged conversations", async ({
    browser,
  }) => {
    const adminToken = await adminLogin();
    // Start with a known clean tag library.
    await archiveAllExisting(adminToken);
    const slug = `refund-${Date.now()}`;
    const createRes = await fetch(`${API_BASE}/api/admin/tags`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        slug,
        label_en: "Refund",
        label_tr: "İade",
        color: "#dc2626",
      }),
    });
    expect(createRes.ok).toBe(true);

    // Player A: send a message — this conversation will get tagged.
    const playerCtxA = await browser.newContext();
    const widgetA = await openWidget(await openHostPage(playerCtxA));
    await widgetA.locator("textarea").fill("tag me");
    await widgetA.locator("textarea").press("Enter");
    await expect(widgetA.getByText("tag me")).toBeVisible();

    // Player B: send a different message — this conversation will NOT be tagged.
    const playerCtxB = await browser.newContext();
    const widgetB = await openWidget(await openHostPage(playerCtxB));
    await widgetB.locator("textarea").fill("not me");
    await widgetB.locator("textarea").press("Enter");
    await expect(widgetB.getByText("not me")).toBeVisible();

    // Agent picks up B first (it is the most recent), then A.
    const agentEmail = uniqueEmail("tag-agent");
    const agentPassword = "tag-agent-pw-1234";
    await createAgent({ email: agentEmail, password: agentPassword, display_name: "Tag Agent" });
    const agentCtx = await browser.newContext();
    const agentPage = await agentCtx.newPage();
    await loginAsAgentInUI(agentPage, agentEmail, agentPassword);

    // The most recent (player B) is first in the queue; click into it,
    // then we'll click the second item (player A) to tag it.
    const items = agentPage.locator(".sidebar .item");
    await items.nth(1).click(); // player A
    await agentPage.getByRole("button", { name: "Claim" }).click();

    // Apply Refund tag
    await agentPage.getByRole("button", { name: "+ Tag" }).click();
    await agentPage.getByLabel(/Pick a tag|\+ Tag/).selectOption({ label: "Refund" });
    await expect(
      agentPage.locator(".conv-tags .tag-chip", { hasText: "Refund" }),
    ).toBeVisible();

    // Queue filter: pick "Refund" — only the tagged conversation remains.
    await agentPage.getByLabel("Filter by tag").selectOption({ label: "Refund" });
    // Wait briefly for the filter to apply
    await agentPage.waitForTimeout(500);
    const visible = await agentPage.locator(".sidebar .item").count();
    expect(visible).toBe(1);

    // Reset to "All conversations" — both reappear (or more).
    await agentPage.getByLabel("Filter by tag").selectOption({ label: "All conversations" });
    await agentPage.waitForTimeout(300);
    const allCount = await agentPage.locator(".sidebar .item").count();
    expect(allCount).toBeGreaterThanOrEqual(2);

    // Cleanup
    await archiveAllExisting(adminToken);
    await playerCtxA.close();
    await playerCtxB.close();
    await agentCtx.close();
  });

  test("tag chip translation flips to Turkish when locale is tr", async ({ browser }) => {
    const adminToken = await adminLogin();
    await archiveAllExisting(adminToken);
    await fetch(`${API_BASE}/api/admin/tags`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        slug: `kyc-${Date.now()}`,
        label_en: "KYC",
        label_tr: "Kimlik Doğrulama",
        color: "#7c3aed",
      }),
    });

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAsAgentInUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.getByLabel("Language").selectOption("tr");

    // Filter dropdown should show Turkish label.
    await page.waitForFunction(
      () => !!document.querySelector('select[aria-label="Etikete göre filtrele"]'),
      undefined,
      { timeout: 5_000 },
    );
    const filter = page.getByLabel("Etikete göre filtrele");
    await expect(filter).toBeVisible();
    const optionText = await filter.locator("option").nth(1).textContent();
    expect(optionText).toContain("Kimlik Doğrulama");

    await archiveAllExisting(adminToken);
    await ctx.close();
  });
});
