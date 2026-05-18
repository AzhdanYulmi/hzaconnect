import { test, expect } from "@playwright/test";
import {
  openHostPage,
  openWidget,
  loginAsAgentInUI,
  createAgent,
  uniqueEmail,
} from "./helpers.js";

test.describe("Supervisor read-only observation", () => {
  const supEmail = uniqueEmail("sup");
  const agEmail = uniqueEmail("agent-sup");
  const password = "agent-test-password-123";

  test.beforeAll(async () => {
    await createAgent({
      email: supEmail,
      password,
      display_name: "Sup Visor",
      role: "supervisor",
    });
    await createAgent({
      email: agEmail,
      password,
      display_name: "Worker Bee",
      role: "agent",
    });
  });

  test("supervisor sees agent-player conversation read-only", async ({
    browser,
  }) => {
    // Start a conversation: player + agent claims.
    const playerCtx = await browser.newContext();
    const agentCtx = await browser.newContext();
    const supCtx = await browser.newContext();

    const playerPage = await openHostPage(playerCtx);
    const widget = await openWidget(playerPage);
    await widget.locator("textarea").fill("hello supervisor scenario");
    await widget.locator("textarea").press("Enter");
    await expect(widget.getByText("hello supervisor scenario")).toBeVisible();

    const agentPage = await agentCtx.newPage();
    await loginAsAgentInUI(agentPage, agEmail, password);
    await agentPage.locator(".sidebar .item").first().click();
    await agentPage.getByRole("button", { name: "Claim" }).click();
    await expect(
      agentPage.locator(".pane header .status-chip.assigned"),
    ).toBeVisible();

    // Supervisor logs in and opens the same conversation.
    const supPage = await supCtx.newPage();
    await loginAsAgentInUI(supPage, supEmail, password);
    await supPage.locator(".sidebar .item").first().click();

    // Supervisor sees the message
    await expect(supPage.getByText("hello supervisor scenario")).toBeVisible({
      timeout: 5_000,
    });

    // Supervisor's composer should be disabled (they aren't the assigned agent).
    const supComposer = supPage.locator(".composer textarea");
    await supComposer.waitFor({ state: "visible" });
    await expect(supComposer).toBeDisabled();

    // Agent sends another message — supervisor sees it live.
    await agentPage.locator(".composer textarea").fill("agent reply for sup");
    await agentPage.locator(".composer textarea").press("Enter");
    await expect(supPage.getByText("agent reply for sup")).toBeVisible({
      timeout: 5_000,
    });

    await playerCtx.close();
    await agentCtx.close();
    await supCtx.close();
  });
});
