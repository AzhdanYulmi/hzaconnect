import { test, expect } from "@playwright/test";
import {
  openHostPage,
  openWidget,
  loginAsAgentInUI,
  createAgent,
  uniqueEmail,
} from "./helpers.js";

test.describe("Happy path bidirectional", () => {
  const email = uniqueEmail("agent");
  const password = "agent-test-password-123";

  test.beforeAll(async () => {
    await createAgent({ email, password, display_name: "Agent E2E", role: "agent" });
  });

  test("player → agent → player message round trip", async ({ browser }) => {
    // Two independent contexts: one for the player, one for the agent.
    const playerCtx = await browser.newContext();
    const agentCtx = await browser.newContext();

    const playerPage = await openHostPage(playerCtx);
    const widget = await openWidget(playerPage);

    // Player sends "hello"
    await widget.locator("textarea").fill("hello from player");
    await widget.locator("textarea").press("Enter");
    await expect(widget.getByText("hello from player")).toBeVisible();

    // Agent logs in
    const agentPage = await agentCtx.newPage();
    await loginAsAgentInUI(agentPage, email, password);

    // Conversation should appear in queue within a couple seconds.
    const item = agentPage.locator(".sidebar .item").first();
    await expect(item).toBeVisible({ timeout: 5_000 });
    await item.click();

    // Agent sees the player message
    await expect(agentPage.getByText("hello from player")).toBeVisible();

    // Agent claims and replies
    await agentPage.getByRole("button", { name: "Claim" }).click();
    await expect(
      agentPage.locator(".pane header .status-chip.assigned"),
    ).toBeVisible();

    const composer = agentPage.locator(".composer textarea");
    await composer.waitFor({ state: "visible" });
    await expect(composer).toBeEnabled();
    await composer.fill("hi from agent");
    await composer.press("Enter");

    // Player receives the agent reply within the iframe.
    await expect(widget.getByText("hi from agent")).toBeVisible({ timeout: 5_000 });

    await playerCtx.close();
    await agentCtx.close();
  });

  test("typing indicator appears within 1s on both sides", async ({ browser }) => {
    const playerCtx = await browser.newContext();
    const agentCtx = await browser.newContext();
    const playerPage = await openHostPage(playerCtx);
    const widget = await openWidget(playerPage);

    // Force a conversation by sending something
    await widget.locator("textarea").fill("ping");
    await widget.locator("textarea").press("Enter");
    await expect(widget.getByText("ping")).toBeVisible();

    const agentPage = await agentCtx.newPage();
    await loginAsAgentInUI(agentPage, email, password);
    await agentPage.locator(".sidebar .item").first().click();
    // Claim if we haven't already
    const claim = agentPage.getByRole("button", { name: "Claim" });
    if (await claim.isVisible().catch(() => false)) {
      await claim.click();
    }

    // Agent starts typing — player should see "is typing"
    await agentPage.locator(".composer textarea").fill("typing now");
    await expect(widget.getByText(/is typing/i)).toBeVisible({ timeout: 4_000 });

    await playerCtx.close();
    await agentCtx.close();
  });
});
