import { expect, test } from "@playwright/test";

// FLOW-364: Home's band, the month drawer, a past month and the four-tab bar. The fixtures are invented.
test.use({ viewport: { width: 390, height: 844 } });

test("the four tabs open their screens, and the old paths still land", async ({ page }) => {
  await page.goto("/?preview=1");
  const bar = page.getByRole("navigation", { name: "ניווט ראשי" });
  await expect(bar.getByRole("link")).toHaveCount(4);
  await expect(bar.getByRole("link", { name: "בית", exact: true })).toHaveAttribute("href", "/?preview=1");
  await expect(bar.getByRole("link", { name: "פרויקטים" })).toHaveAttribute("href", "/projects?preview=1");
  await expect(bar.getByRole("link", { name: "הלוואות" })).toHaveAttribute("href", "/settings/loans?preview=1");
  await expect(bar.getByRole("link", { name: "קבועים" })).toHaveAttribute("href", "/missing-bills?preview=1");

  await page.goto("/review?preview=1");
  await expect(page.getByRole("heading", { name: "לאישור" })).toBeVisible();
  await page.goto("/settings/loans?preview=1");
  await expect(page).toHaveURL(/\/settings\/loans\?preview=1$/);
  await page.goto("/missing-bills?preview=1");
  await expect(page.getByRole("heading", { name: "קבועים" })).toBeVisible();
});

test("the drawer opens, a future month is disabled, and a pick replaces the month at the top", async ({ page }) => {
  await page.goto("/e2e/cash?preview=1");
  // The pill's name opens the drawer; the drawer's title is בחירת חודש.
  await page.locator(".ui-band-month-name").click();
  const drawer = page.getByRole("dialog", { name: "בחירת חודש" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { disabled: true }).first()).toBeVisible();
  const pick = drawer.getByRole("button", { name: /נטו/ }).first();
  await pick.click();
  await expect(drawer).toHaveCount(0);
  await expect(page).toHaveURL(/month=/);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("the later arrow is disabled on the current month", async ({ page }) => {
  await page.goto("/e2e/cash?preview=1");
  await expect(page.getByRole("button", { name: "חודש הבא" })).toBeDisabled();
});

test("a past month shows the way back to the current one", async ({ page }) => {
  await page.goto("/e2e/cash?preview=1&month=past");
  await expect(page.getByRole("link", { name: /^חזרה ל/ })).toBeVisible();
});

test("the compact bar shows after scrolling and its motion is off with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/e2e/cash?preview=1");
  await expect(page.locator(".m-page-enter").first()).toBeAttached();
  // The fixture fits one screen, so give the page height to scroll (a page with a long checklist does this).
  await page.evaluate(() => {
    document.querySelector<HTMLElement>(".m-page-enter")?.parentElement?.style.setProperty("min-height", "1400px");
    window.scrollTo(0, 400);
  });
  const bar = page.locator(".ui-compact-bar-band");
  await expect(bar).toBeVisible();
  const duration = await bar.evaluate((node) => getComputedStyle(node).transitionDuration);
  expect(duration.split(",").every((value) => value.trim().startsWith("0s"))).toBe(true);
});
