import { expect, test } from "@playwright/test";

// FLOW-974: an on-demand screen's styles load with its chunk (ui/lazy.css), not with Home. On a
// slow network the screen must not draw before they arrive: the stylesheet is in place the moment
// the screen's heading first appears. Invented data only.
test.use({ viewport: { width: 375, height: 667 } });

for (const tab of ["פרויקטים", "דוחות", "הלוואות"]) {
  test(`Home → ${tab}: the screen draws only after its styles load`, async ({ page }) => {
    await page.addInitScript((heading) => {
      const seen = { at: 0, styled: false };
      (window as unknown as { __lazyCss: typeof seen }).__lazyCss = seen;
      new MutationObserver(() => {
        if (seen.at) return;
        const h1 = [...document.querySelectorAll("h1")].find((el) => el.textContent.trim() === heading);
        if (!h1) return;
        seen.at = performance.now();
        seen.styled = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
          .some((link) => link.href.includes("/lazy") && link.sheet !== null);
      }).observe(document, { childList: true, subtree: true });
    }, tab);
    // Hold the on-demand stylesheet back from the first request, before Home's idle preload asks for it.
    let delayed = 0;
    await page.route(/\/lazy[^/]*\.css$/, async (route) => {
      delayed += 1;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.continue();
    });
    // The app's own routes, not /e2e/: the dev fixtures import every screen up front.
    await page.goto("/?preview=1");
    await expect(page.getByRole("navigation", { name: "ניווט ראשי" })).toBeVisible();
    await page.getByRole("navigation", { name: "ניווט ראשי" }).getByRole("link", { name: tab }).click();
    await expect(page.getByRole("heading", { level: 1, name: tab })).toBeVisible({ timeout: 10_000 });
    const seen = await page.evaluate(() => (window as unknown as { __lazyCss: { at: number; styled: boolean } }).__lazyCss);
    expect(delayed).toBeGreaterThan(0);
    expect(seen.at).toBeGreaterThan(0);
    expect(seen.styled).toBe(true);
  });
}
