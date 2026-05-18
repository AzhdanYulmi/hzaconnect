import { test, expect } from "@playwright/test";
import {
  loginAsAgentInUI,
  uniqueEmail,
  createAgent,
  openHostPage,
  openWidget,
  DASHBOARD_BASE,
} from "./helpers.js";

test.describe("Agent push notifications", () => {
  test("toggle button toggles enabled state and persists", async ({ browser }) => {
    const ctx = await browser.newContext({
      permissions: ["notifications"],
    });
    const page = await ctx.newPage();
    const email = uniqueEmail("notif");
    const password = "notif-pw-1234";
    await createAgent({ email, password, display_name: "Notif" });
    await loginAsAgentInUI(page, email, password);

    const toggle = page.getByLabel(/Notifications/i).first();
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    // Choice persists across reload.
    await page.reload();
    await expect(page.getByLabel(/Notifications/i).first()).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await ctx.close();
  });

  test("notification fires on conversation.new when agent isn't viewing the queue", async ({
    browser,
  }) => {
    // Grant the OS-level permission so our wrapper can call new Notification().
    const ctx = await browser.newContext({ permissions: ["notifications"] });
    const page = await ctx.newPage();

    // Stub Notification constructor BEFORE first navigation so the dashboard
    // JS uses our wrapper rather than the real browser one.
    await page.addInitScript(() => {
      const calls: any[] = [];
      (window as any).__notificationCalls = calls;
      class FakeNotification {
        onclick: (() => void) | null = null;
        constructor(title: string, opts: any) {
          calls.push({ title, opts });
        }
        close() {}
        static permission = "granted";
        static requestPermission = async () => "granted";
      }
      (window as any).Notification = FakeNotification;
    });

    // Use an admin so the Admin button is available — the test assumes a
    // dashboard view *other than* the chat queue at the moment a new
    // conversation arrives.
    const email = uniqueEmail("notif-fire");
    const password = "notif-pw-1234";
    await createAgent({ email, password, display_name: "Notif Fire", role: "admin" });
    await loginAsAgentInUI(page, email, password);

    // Enable notifications.
    await page.getByLabel(/Notifications/i).first().click();

    // Switch to admin view so the agent isn't on the chat queue.
    await page.getByRole("button", { name: "Admin" }).click();

    // Player creates a new conversation.
    const playerCtx = await browser.newContext();
    const playerPage = await openHostPage(playerCtx);
    const widget = await openWidget(playerPage);
    await widget.locator("textarea").fill("notify me");
    await widget.locator("textarea").press("Enter");
    await expect(widget.getByText("notify me")).toBeVisible();

    // Within a couple seconds, the agent's stubbed Notification should have
    // been called at least once.
    await page.waitForFunction(
      () => ((window as any).__notificationCalls ?? []).length > 0,
      undefined,
      { timeout: 5_000 },
    );
    const calls = await page.evaluate(() => (window as any).__notificationCalls);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].title.toLowerCase()).toContain("conversation");

    await playerCtx.close();
    await ctx.close();
  });
});
