import { test, expect } from "@playwright/test";
import {
  openHostPage,
  openWidget,
  loginAsAgentInUI,
  createAgent,
  uniqueEmail,
} from "./helpers.js";

test.describe("Reconnect UX", () => {
  test("widget does NOT show 'Reconnecting…' immediately on a brief WS blip", async ({
    browser,
  }) => {
    const playerCtx = await browser.newContext();
    const playerPage = await openHostPage(playerCtx);
    const widget = await openWidget(playerPage);
    await widget.locator("textarea").fill("hi");
    await widget.locator("textarea").press("Enter");
    await expect(widget.getByText("hi")).toBeVisible();

    // Force a brief offline blip; bring back online before grace expires.
    await playerCtx.setOffline(true);
    await playerPage.waitForTimeout(2000);
    // Banner must NOT have appeared yet (10s grace).
    await expect(widget.getByText(/Reconnecting/)).toHaveCount(0);
    await playerCtx.setOffline(false);

    await playerCtx.close();
  });
});

test.describe("Resume on disconnect / refresh", () => {
  const email = uniqueEmail("agent-resume");
  const password = "agent-test-password-123";

  test.beforeAll(async () => {
    await createAgent({ email, password, display_name: "Agent Resume" });
  });

  test("page refresh restores conversation and last messages", async ({
    browser,
  }) => {
    const playerCtx = await browser.newContext();
    const playerPage = await openHostPage(playerCtx);
    const widget = await openWidget(playerPage);
    await widget.locator("textarea").fill("first message");
    await widget.locator("textarea").press("Enter");
    await expect(widget.getByText("first message")).toBeVisible();

    // Refresh the host page
    await playerPage.reload();
    await playerPage.waitForFunction(() => !!(window as any).hzaconnect);
    const widget2 = await openWidget(playerPage);
    await expect(widget2.getByText("first message")).toBeVisible({
      timeout: 5_000,
    });

    await playerCtx.close();
  });

  test("messages sent while player is offline arrive on reconnect", async ({
    browser,
  }) => {
    const playerCtx = await browser.newContext();
    const agentCtx = await browser.newContext();
    const playerPage = await openHostPage(playerCtx);
    const widget = await openWidget(playerPage);
    await widget.locator("textarea").fill("hello");
    await widget.locator("textarea").press("Enter");
    await expect(widget.getByText("hello")).toBeVisible();

    const agentPage = await agentCtx.newPage();
    await loginAsAgentInUI(agentPage, email, password);
    const item = agentPage.locator(".sidebar .item").first();
    await item.waitFor({ timeout: 5_000 });
    await item.click();
    const claim = agentPage.getByRole("button", { name: "Claim" });
    if (await claim.isVisible().catch(() => false)) await claim.click();

    // Take the player offline, agent sends three messages, bring back online.
    await playerCtx.setOffline(true);
    const composer = agentPage.locator(".composer textarea");
    await composer.fill("offline-1");
    await composer.press("Enter");
    await composer.fill("offline-2");
    await composer.press("Enter");
    await composer.fill("offline-3");
    await composer.press("Enter");

    // Wait for them to land on the agent side first.
    await expect(agentPage.getByText("offline-3")).toBeVisible({ timeout: 5_000 });

    // Bring player back online — widget should reconnect and resume.
    await playerCtx.setOffline(false);

    await expect(widget.getByText("offline-1")).toBeVisible({ timeout: 15_000 });
    await expect(widget.getByText("offline-2")).toBeVisible();
    await expect(widget.getByText("offline-3")).toBeVisible();

    await playerCtx.close();
    await agentCtx.close();
  });
});
