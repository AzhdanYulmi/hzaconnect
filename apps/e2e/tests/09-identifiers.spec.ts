import { test, expect } from "@playwright/test";
import {
  openHostPage,
  openWidget,
  loginAsAgentInUI,
  createAgent,
  uniqueEmail,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  API_BASE,
} from "./helpers.js";

const PRECHAT_DONE_KEY = "hzaconnect_prechat_done";

async function setIdentifierFields(
  fields: Array<{ kind: string; label_en?: string; label_tr?: string; required?: boolean }>,
  requireBeforeChat = false,
): Promise<void> {
  const login = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.HZA_ADMIN_EMAIL ?? "admin@example.com",
      password: process.env.HZA_ADMIN_PASSWORD ?? ADMIN_PASSWORD,
    }),
  });
  const { access_token } = await login.json();
  await fetch(`${API_BASE}/api/admin/deployment-settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify({
      identifier_fields: fields,
      require_before_chat: requireBeforeChat,
    }),
  });
}

test.describe("Anonymous identification system", () => {
  test.beforeAll(async () => {
    // Enable player_id + email globally for this test file.
    await setIdentifierFields([
      { kind: "player_id", label_en: "Player ID", label_tr: "Oyuncu Kimliği" },
      { kind: "email", label_en: "Email", label_tr: "E-posta" },
    ]);
  });

  test.afterAll(async () => {
    // Restore the empty default so subsequent test files don't see pre-chat.
    await setIdentifierFields([]);
  });

  test("widget pre-chat card collects identifiers and player_info shows them", async ({
    browser,
  }) => {
    const playerCtx = await browser.newContext();
    const agentCtx = await browser.newContext();

    const playerPage = await openHostPage(playerCtx);
    const widget = await openWidget(playerPage);

    // Pre-chat card should appear (default deployment has player_id + email)
    await expect(widget.getByRole("heading", { name: /Welcome to support/i })).toBeVisible();
    await widget.getByLabel("Player ID").fill("12345");
    await widget.getByLabel("Email").fill("alice@example.com");
    await widget.getByRole("button", { name: "Start chat" }).click();

    // Composer is reachable; send a message so a conversation is created.
    await widget.locator("textarea").fill("hi from alice");
    await widget.locator("textarea").press("Enter");
    await expect(widget.getByText("hi from alice")).toBeVisible();

    // Agent picks it up and sees the player info.
    const agentEmail = uniqueEmail("id-agent");
    const agentPassword = "agent-pw-1234";
    await createAgent({ email: agentEmail, password: agentPassword, display_name: "ID Agent" });

    const agentPage = await agentCtx.newPage();
    await loginAsAgentInUI(agentPage, agentEmail, agentPassword);
    await agentPage.locator(".sidebar .item").first().click();
    await agentPage.getByRole("button", { name: "Claim" }).click();

    // Player info chips should be visible — scope to the chip list so we
    // don't pick up identical values from the returning-player history.
    const chips = agentPage.locator(".player-info-list");
    await expect(chips.getByText("12345")).toBeVisible({ timeout: 5_000 });
    await expect(chips.getByText("alice@example.com")).toBeVisible();

    await playerCtx.close();
    await agentCtx.close();
  });

  test("agent can record an identifier; correction marks the old one superseded", async ({
    browser,
  }) => {
    // Player skips pre-chat
    const playerCtx = await browser.newContext();
    const playerPage = await openHostPage(playerCtx);
    const widget = await openWidget(playerPage);
    await widget.getByRole("button", { name: "Skip — chat anonymously" }).click();
    await widget.locator("textarea").fill("hi");
    await widget.locator("textarea").press("Enter");
    await expect(widget.getByText("hi")).toBeVisible();

    // Agent claims and records ID
    const agentEmail = uniqueEmail("id-rec-agent");
    const agentPassword = "agent-pw-1234";
    await createAgent({ email: agentEmail, password: agentPassword, display_name: "Rec Agent" });
    const agentCtx = await browser.newContext();
    const agentPage = await agentCtx.newPage();
    await loginAsAgentInUI(agentPage, agentEmail, agentPassword);
    await agentPage.locator(".sidebar .item").first().click();
    await agentPage.getByRole("button", { name: "Claim" }).click();

    // Use unique-per-run values so the returning-player history doesn't
    // collide with prior test runs.
    const v1 = `r1-${Date.now()}`;
    const v2 = `r2-${Date.now()}`;
    const chips = agentPage.locator(".player-info-list");

    await agentPage.getByRole("button", { name: "+ Add" }).click();
    await agentPage.getByLabel("Value").fill(v1);
    await agentPage.getByRole("button", { name: "Save" }).click();
    await expect(chips.getByText(v1)).toBeVisible();

    // Correct it to a new value — the old should be replaced in the chip list.
    await agentPage.getByRole("button", { name: "+ Add" }).click();
    await agentPage.getByLabel("Value").fill(v2);
    await agentPage.getByRole("button", { name: "Save" }).click();
    await expect(chips.getByText(v2)).toBeVisible();
    await expect(chips.locator(".identifier-chip", { hasText: v1 })).toHaveCount(0);

    await playerCtx.close();
    await agentCtx.close();
  });

  test("returning player: same player_id from a second session surfaces history", async ({
    browser,
  }) => {
    const ID = `ret-${Date.now()}`;

    // First session: player declares ID, sends a message.
    const ctxA = await browser.newContext();
    const playerA = await openHostPage(ctxA);
    const widgetA = await openWidget(playerA);
    await widgetA.getByLabel("Player ID").fill(ID);
    await widgetA.getByRole("button", { name: "Start chat" }).click();
    await widgetA.locator("textarea").fill("first session");
    await widgetA.locator("textarea").press("Enter");
    await expect(widgetA.getByText("first session")).toBeVisible();
    await ctxA.close();

    // Second session in a fresh browser context: same player_id, new browser.
    const ctxB = await browser.newContext();
    const playerB = await openHostPage(ctxB);
    const widgetB = await openWidget(playerB);
    await widgetB.getByLabel("Player ID").fill(ID);
    await widgetB.getByRole("button", { name: "Start chat" }).click();
    await widgetB.locator("textarea").fill("second session");
    await widgetB.locator("textarea").press("Enter");
    await expect(widgetB.getByText("second session")).toBeVisible();

    // Agent claims session B and should see returning-player history.
    const agentEmail = uniqueEmail("ret-agent");
    const agentPassword = "agent-pw-1234";
    await createAgent({ email: agentEmail, password: agentPassword, display_name: "Ret Agent" });
    const agentCtx = await browser.newContext();
    const agentPage = await agentCtx.newPage();
    await loginAsAgentInUI(agentPage, agentEmail, agentPassword);
    await agentPage.locator(".sidebar .item").first().click();
    await agentPage.getByRole("button", { name: "Claim" }).click();

    // History details should be visible
    await expect(
      agentPage.locator(".player-info-history summary"),
    ).toBeVisible({ timeout: 5_000 });

    await ctxB.close();
    await agentCtx.close();
  });

  test("admin Identification tab edits deployment-wide fields", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAsAgentInUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Admin" }).click();
    await page.getByRole("button", { name: "Identification" }).click();
    await expect(page.getByText(/Configure which identifiers/)).toBeVisible();

    // Toggle "require before chat" on, save, then off again.
    const cb = page.locator(
      "input[type='checkbox']",
      { hasNot: page.locator("[data-disabled]") },
    ).last();
    await cb.check();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    // Restore (other tests rely on require_before_chat=false).
    await cb.uncheck();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    await ctx.close();
  });

  test("hzaconnect.setIdentifiers() persists identifiers without the pre-chat UI", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const playerPage = await openHostPage(ctx);

    // Skip the pre-chat card so the chat panel is reachable.
    const widget = await openWidget(playerPage);
    await widget.getByRole("button", { name: "Skip — chat anonymously" }).click();

    // Programmatic identification from the host page.
    await playerPage.evaluate(() =>
      (window as any).hzaconnect.setIdentifiers([
        { kind: "player_id", value: "auto-7777" },
      ]),
    );

    await widget.locator("textarea").fill("hi");
    await widget.locator("textarea").press("Enter");

    // Verify via REST that the identifier landed.
    const sessionId = await playerPage.evaluate(() =>
      localStorage.getItem("hzaconnect_session_id"),
    );
    const sessionToken = await playerPage.evaluate(() =>
      localStorage.getItem("hzaconnect_session_token"),
    );
    const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/identifiers`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const list = (await res.json()) as Array<{ kind: string; value: string; superseded_at: string | null }>;
    const current = list.find((r) => !r.superseded_at && r.kind === "player_id");
    expect(current?.value).toBe("auto-7777");

    await ctx.close();
  });
});
