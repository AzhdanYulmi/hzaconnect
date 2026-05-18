import { test, expect } from "@playwright/test";
import { DASHBOARD_BASE, openHostPage, openWidget } from "./helpers.js";

test.describe("i18n", () => {
  test("dashboard login screen flips to Turkish via the language switcher", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(DASHBOARD_BASE);

    // English by default
    await expect(page.getByRole("heading", { name: "Agent Sign-in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    // Switch to Turkish
    await page.getByLabel("Language").selectOption("tr");
    await expect(page.getByRole("heading", { name: "Temsilci Girişi" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Giriş yap" })).toBeVisible();

    // Choice persists across reload
    await page.reload();
    await expect(page.getByRole("heading", { name: "Temsilci Girişi" })).toBeVisible();

    await ctx.close();
  });

  test("widget renders Turkish copy when host page sets data-locale='tr'", async ({
    browser,
  }) => {
    // Override the host page to add data-locale="tr" via a route handler so we
    // don't have to ship a second fixture file.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.route("**/dev/host.html", async (route) => {
      const res = await route.fetch();
      const html = await res.text();
      const patched = html.replace(
        'data-deployment="lucky-nines-demo"',
        'data-deployment="lucky-nines-demo" data-locale="tr"',
      );
      await route.fulfill({ body: patched, contentType: "text/html" });
    });
    await page.goto(`${process.env.HZA_API_BASE ?? "http://localhost:3000"}/dev/host.html`);
    await page.waitForFunction(() => !!(window as any).hzaconnect);
    const widget = await openWidget(page);

    // Header title and composer placeholder both in Turkish.
    await expect(widget.getByText("Destek")).toBeVisible();
    await expect(widget.locator('textarea[placeholder="Mesaj yazın…"]')).toBeVisible();
    await expect(widget.getByRole("button", { name: "Gönder" })).toBeVisible();

    await ctx.close();
  });

  test("hzaconnect.setLocale('tr') flips an already-mounted widget live", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await openHostPage(ctx);
    const widget = await openWidget(page);

    // English first
    await expect(widget.getByRole("button", { name: "Send" })).toBeVisible();

    // Programmatic switch
    await page.evaluate(() => (window as any).hzaconnect.setLocale("tr"));

    await expect(widget.getByRole("button", { name: "Gönder" })).toBeVisible();
    await expect(widget.getByText("Destek")).toBeVisible();

    await ctx.close();
  });
});
