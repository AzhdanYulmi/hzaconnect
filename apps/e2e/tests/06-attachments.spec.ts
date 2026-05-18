import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  openHostPage,
  openWidget,
  loginAsAgentInUI,
  createAgent,
  uniqueEmail,
} from "./helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PIXEL_PNG = path.join(__dirname, "fixtures", "pixel.png");

test.describe("Image attachments", () => {
  const email = uniqueEmail("agent-att");
  const password = "agent-test-password-123";

  test.beforeAll(async () => {
    await createAgent({ email, password, display_name: "Agent Att" });
  });

  test("player can attach a PNG and agent sees it inline", async ({ browser }) => {
    const playerCtx = await browser.newContext();
    const agentCtx = await browser.newContext();
    const playerPage = await openHostPage(playerCtx);
    const widget = await openWidget(playerPage);

    // Player uploads and sends an image (no body required).
    await widget.locator('input[type="file"]').setInputFiles(PIXEL_PNG);
    // Pending-upload chip should appear with the file name.
    await expect(widget.locator(".hza-attach-chip")).toBeVisible({
      timeout: 5_000,
    });
    await expect(widget.locator(".hza-attach-chip-name")).toHaveText("pixel.png");
    await widget.getByRole("button", { name: /^Send$/ }).click();

    // Agent picks it up.
    const agentPage = await agentCtx.newPage();
    await loginAsAgentInUI(agentPage, email, password);
    await agentPage.locator(".sidebar .item").first().click();
    await agentPage.getByRole("button", { name: "Claim" }).click();

    // Agent sees an <img> for the attachment.
    const agentImg = agentPage.locator(".messages .msg img").first();
    await expect(agentImg).toBeVisible({ timeout: 10_000 });
    const src = await agentImg.getAttribute("src");
    expect(src).toMatch(/^https?:\/\//);

    await playerCtx.close();
    await agentCtx.close();
  });

  test("agent can attach a PNG and player sees it inline", async ({ browser }) => {
    const playerCtx = await browser.newContext();
    const agentCtx = await browser.newContext();
    const playerPage = await openHostPage(playerCtx);
    const widget = await openWidget(playerPage);
    await widget.locator("textarea").fill("ping");
    await widget.locator("textarea").press("Enter");
    await expect(widget.getByText("ping")).toBeVisible();

    const agentPage = await agentCtx.newPage();
    await loginAsAgentInUI(agentPage, email, password);
    await agentPage.locator(".sidebar .item").first().click();
    const claim = agentPage.getByRole("button", { name: "Claim" });
    if (await claim.isVisible().catch(() => false)) await claim.click();

    // Agent attaches and sends.
    await agentPage.locator('input[type="file"]').setInputFiles(PIXEL_PNG);
    await expect(agentPage.locator(".dash-attach-name")).toHaveText(
      "pixel.png",
    );
    await agentPage.getByRole("button", { name: "Send" }).click();

    // Player iframe shows the image.
    const playerImg = widget.locator("img[alt='attachment']").first();
    await expect(playerImg).toBeVisible({ timeout: 10_000 });

    await playerCtx.close();
    await agentCtx.close();
  });

  test("API rejects non-image MIME types at presign time", async () => {
    // Hit the presign endpoint with a disallowed mime — server-side guard.
    // We need a widget session token first.
    const sessionRes = await fetch("http://localhost:3000/api/widget/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const { session_token } = await sessionRes.json();

    const presign = await fetch("http://localhost:3000/api/attachments/presign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session_token}`,
      },
      body: JSON.stringify({
        mime_type: "application/pdf",
        byte_size: 1234,
      }),
    });
    expect(presign.ok).toBe(false);
    expect(presign.status).toBe(400);
  });

  test("API rejects oversize uploads at presign time", async () => {
    const sessionRes = await fetch("http://localhost:3000/api/widget/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const { session_token } = await sessionRes.json();

    const presign = await fetch("http://localhost:3000/api/attachments/presign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session_token}`,
      },
      body: JSON.stringify({
        mime_type: "image/png",
        byte_size: 6 * 1024 * 1024, // 6 MB > 5 MB cap
      }),
    });
    expect(presign.ok).toBe(false);
  });
});
