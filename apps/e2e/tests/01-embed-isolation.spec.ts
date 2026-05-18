import { test, expect } from "@playwright/test";
import { openHostPage, openWidget, HOST_BASE } from "./helpers.js";

test.describe("Widget embed isolation", () => {
  test("loads on host page without console errors", async ({ context }) => {
    const errors: string[] = [];
    const consoleMessages: string[] = [];
    const page = await context.newPage();
    page.on("console", (msg) => consoleMessages.push(`${msg.type()}:${msg.text()}`));
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto(HOST_BASE);
    await page.waitForFunction(() => !!(window as any).hzaconnect);

    // Host page's own button still works (i.e. widget didn't replace event handlers).
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Play now" }).click();

    expect(errors, JSON.stringify(consoleMessages, null, 2)).toEqual([]);
  });

  test("widget styles do not bleed into host page (and vice versa)", async ({
    context,
  }) => {
    const page = await openHostPage(context);
    await openWidget(page);

    // Host has aggressive Comic Sans styling. The widget iframe should not
    // pick that up because it's a different document.
    const hostBodyFont = await page.evaluate(
      () => getComputedStyle(document.body).fontFamily,
    );
    expect(hostBodyFont.toLowerCase()).toContain("comic sans");

    // Inside the widget iframe, the font is system-ui, not Comic Sans.
    const target = page
      .frames()
      .find((f) => f.url().includes("/widget/frame.html"))!;
    const widgetBodyFont = await target.evaluate(
      () => getComputedStyle(document.body).fontFamily,
    );
    expect(widgetBodyFont.toLowerCase()).not.toContain("comic sans");
  });

  test("session id persists across page reloads", async ({ context }) => {
    const page = await openHostPage(context);
    const before = await page.evaluate(() =>
      localStorage.getItem("hzaconnect_session_id"),
    );
    expect(before).toBeTruthy();
    await page.reload();
    await page.waitForFunction(() => !!(window as any).hzaconnect);
    const after = await page.evaluate(() =>
      localStorage.getItem("hzaconnect_session_id"),
    );
    expect(after).toBe(before);
  });
});
