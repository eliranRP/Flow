import { expect, test } from "@playwright/test";

// An installed iPhone app reserves the notch with --safe-top (env(safe-area-inset-top)); tests run with 0.
// A page whose header dropped that padding drew its title under the notch, so the compact bar showed at
// the top of an unscrolled page and cut the line under it. Emulate the notch and open each such page.
test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });

const NOTCH = ":root { --safe-top: 59px; }";

// Before the app's scripts run: the compact bar reads the safe area once, when its observer starts.
test.beforeEach(async ({ page }) => {
  await page.addInitScript((css) => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.append(style);
    });
  }, NOTCH);
});

const ROUTES = ["settings", "notifications", "categories", "team", "business", "connections/ai", "forecast/months", "company-profit"];

for (const route of ROUTES) {
  test(`${route}: under a notch the large title shows and the compact bar stays hidden at the top`, async ({ page }) => {
    await page.goto(`/e2e/${route}`);
    const header = page.locator("header.ui-page-stacked").first();
    await expect(header).toBeVisible();
    await expect(page.locator(".ui-compact-bar").first()).toHaveClass(/ui-compact-bar-gone/);
    const title = header.locator(".ui-focus-title").first();
    const top = await title.evaluate((node) => node.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(59);
  });
}

// The search screen's head is its own bar, not a stacked header: its field sat under the status bar.
test("search: under a notch the search field sits below the status bar", async ({ page }) => {
  await page.goto("/e2e/cash?preview=1");
  await page.getByRole("link", { name: "חיפוש", exact: true }).click();
  const field = page.getByRole("searchbox", { name: "חיפוש תנועות" });
  await expect(field).toBeVisible();
  const top = await page.locator(".ui-search").first().evaluate((node) => node.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(59);
});

// The loans tab has no stacked header: its "+ הלוואה חדשה" link is the top line, and it sat under the
// iPhone status bar because the screen's own top pad left out --safe-top.
test("loans: under a notch the new-loan link sits below the status bar", async ({ page }) => {
  await page.goto("/e2e/loans");
  const add = page.getByRole("button", { name: "+ הלוואה חדשה" });
  await expect(add).toBeVisible();
  const top = await add.evaluate((node) => node.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(59);
});

// FLOW-942: the compact bar (and a transaction-style top bar once it takes its line) came down while a header
// line was still on screen, so for a band of scroll positions that line sat half under the bar's edge; iOS
// momentum often rests there. At every 4px step through the header zone, no header line may straddle a shown
// bar's bottom edge. The project profit pages also dropped the notch padding, so their bar showed at the top.
const CLIP_ROUTES = [
  "project-profit?preview=1",
  "project-month-profit",
  "project-next-month",
  "project-investment?preview=1",
  "company-profit?preview=1",
  "company-profit?preview=1&period=all",
  "categories?preview=1",
  "connections/ai?preview=1",
  "connections/sumit?preview=1&state=problem",
  "notifications",
  "forecast?preview=1",
  "recurring-charge",
  "loans/summary",
  "loans/loan-mortgage/payments?reset=1&today=2026-10-15",
];

/** In the page: scroll through the header zone and list every line half under a shown top bar. */
async function headerCuts(): Promise<string[]> {
  const frame = () => new Promise<void>((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });
  const cuts: string[] = [];
  const end = Math.min(400, document.documentElement.scrollHeight - innerHeight);
  for (let y = 0; y <= end; y += 4) {
    window.scrollTo(0, y);
    await frame();
    await frame();
    const bars = [...document.querySelectorAll<HTMLElement>(".ui-compact-bar.m-bar-in, .ui-txn-top-past")];
    if (bars.length === 0) continue;
    const edge = Math.max(...bars.map((bar) => bar.getBoundingClientRect().bottom));
    for (const root of document.querySelectorAll("header:not(.ui-txn-top), .ui-txn-head, .ui-loans-title, .ui-loans-count, .ui-pp-figure")) {
      if (root.closest(".ui-compact-bar, .ui-sheet, [role=dialog]")) continue;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim() ?? "";
        if (text === "" || node.parentElement?.checkVisibility({ visibilityProperty: true, opacityProperty: true }) !== true) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const line of range.getClientRects()) {
          if (line.top < edge - 1 && line.bottom > edge + 1) cuts.push(`${String(y)}px: "${text.slice(0, 30)}"`);
        }
      }
    }
  }
  return cuts;
}

test.describe("header lines and the top bar's edge", () => {
  // No slide or fade: the bar is where its class says at each step.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = "*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important}";
        document.head.append(style);
      });
    });
  });

  for (const route of CLIP_ROUTES) {
    test(`${route}: under a notch no header line sits half under the top bar at any scroll`, async ({ page }) => {
      await page.goto(`/e2e/${route}`);
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.locator(".ui-compact-bar.m-bar-in, .ui-txn-top-past")).toHaveCount(0);
      expect(await page.evaluate(headerCuts)).toEqual([]);
    });
  }

  test.describe("on a small phone with no notch", () => {
    test.use({ viewport: { width: 375, height: 667 } });
    // Added after the notch's style, so it wins.
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        document.addEventListener("DOMContentLoaded", () => {
          const style = document.createElement("style");
          style.textContent = ":root { --safe-top: 0px; }";
          document.head.append(style);
        });
      });
    });

    for (const route of ["categories?preview=1", "notifications", "project-profit?preview=1"]) {
      test(`${route}: no header line sits half under the compact bar at any scroll`, async ({ page }) => {
        await page.goto(`/e2e/${route}`);
        await expect(page.locator("h1").first()).toBeVisible();
        expect(await page.evaluate(headerCuts)).toEqual([]);
      });
    }
  });
});
