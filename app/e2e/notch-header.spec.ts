import { expect, test } from "@playwright/test";

// An installed iPhone app reserves the notch with --safe-top (env(safe-area-inset-top)); tests run with 0.
// A page whose header dropped that padding drew its title under the notch, so the compact bar showed at
// the top of an unscrolled page and cut the line under it. Emulate the notch and open each such page.
test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });

const NOTCH = ":root { --safe-top: 59px; }";

for (const route of ["settings", "notifications", "categories", "team", "business", "connections/ai", "forecast/months"]) {
  test(`${route}: under a notch the large title shows and the compact bar stays hidden at the top`, async ({ page }) => {
    await page.goto(`/e2e/${route}`);
    await page.addStyleTag({ content: NOTCH });
    const header = page.locator("header.ui-page-stacked").first();
    await expect(header).toBeVisible();
    await expect(page.locator(".ui-compact-bar").first()).toHaveClass(/ui-compact-bar-gone/);
    const title = header.locator(".ui-focus-title").first();
    const top = await title.evaluate((node) => node.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(59);
  });
}
