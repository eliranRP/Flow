import { expect, test } from "@playwright/test";

// FLOW-364: Home's band, the month drawer, a past month and the four-tab bar. The fixtures are invented.
test.use({ viewport: { width: 390, height: 844 } });

test("the four tabs open their screens, and the old paths still land", async ({ page }) => {
  await page.goto("/?preview=1");
  const bar = page.getByRole("navigation", { name: "ניווט ראשי" });
  await expect(bar.getByRole("link")).toHaveCount(4);
  await expect(bar.getByRole("link", { name: "בית", exact: true })).toHaveAttribute("href", "/?preview=1");
  await expect(bar.getByRole("link", { name: "פרויקטים" })).toHaveAttribute("href", "/projects?preview=1");
  await expect(bar.getByRole("link", { name: "דוחות" })).toHaveAttribute("href", "/reports?preview=1");
  await expect(bar.getByRole("link", { name: "הלוואות" })).toHaveAttribute("href", "/loans?preview=1");

  await page.goto("/review?preview=1");
  await expect(page.getByRole("heading", { name: "לאישור" })).toBeVisible();
  await page.goto("/loans?preview=1");
  await expect(page).toHaveURL(/\/loans\?preview=1$/);
  await page.goto("/missing-bills?preview=1");
  await expect(page).toHaveURL(/\/recurring\?preview=1$/);
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

test("the later arrow on the current month lands on Home for next month, and the earlier one comes back (FLOW-1056)", async ({ page }) => {
  await page.goto("/e2e/cash?preview=1");
  await page.locator(".ui-band").getByRole("button", { name: "חודש הבא" }).click();
  await expect(page.getByText(/^תזרים צפוי · /u)).toBeVisible();
  await expect(page.getByText("צפוי להיכנס")).toBeVisible();
  await expect(page.getByRole("link", { name: /פירוט ועריכה/u })).toHaveAttribute("href", "/forecast/next?preview=1");
  await expect(page.getByRole("heading", { name: /^הצפוי ב/u })).toBeVisible();
  await page.locator(".ui-band").getByRole("button", { name: "חודש קודם" }).click();
  await expect(page.getByText("תזרים · עד היום")).toBeVisible();
});

test("the later arrow goes on through the forecast's months, to its last and no further (FLOW-1066)", async ({ page }) => {
  // The fixture's current month is October 2026: its forecast runs from November 2026 to October 2027.
  await page.goto("/e2e/cash?preview=1&future=2026-11");
  const band = page.locator(".ui-band");
  await band.getByRole("button", { name: "חודש הבא" }).click();
  await expect(page.getByText("תזרים צפוי · דצמבר")).toBeVisible();
  // A month after next: the estimate's note, its own פירוט ועריכה, with the month's expected profit in its name.
  await expect(page.getByText("הערכה · לפי קבועים, הלוואות וממוצע 6 חודשים")).toBeVisible();
  const details = page.getByRole("link", { name: /^פירוט ועריכה, רווח צפוי בדצמבר /u });
  await expect(details).toHaveAttribute("href", "/forecast/next?preview=1&month=2026-12");
  await page.goto("/e2e/cash?preview=1&future=2027-10");
  await expect(page.getByText("תזרים צפוי · אוקטובר")).toBeVisible();
  await expect(band.getByRole("button", { name: "חודש הבא" })).toHaveAttribute("aria-disabled", "true");
  await band.getByRole("button", { name: "חודש קודם" }).click();
  await expect(page.getByText("תזרים צפוי · ספטמבר")).toBeVisible();
});

test("next month in the drawer picks like any month: the drawer closes on Home for next month (FLOW-1056)", async ({ page }) => {
  await page.goto("/e2e/cash?preview=1");
  await page.locator(".ui-band-month-name").click();
  const drawer = page.getByRole("dialog", { name: "בחירת חודש" });
  await expect(drawer).toBeVisible();
  const next = drawer.locator(".ui-month-cell-forecast");
  // December's drawer reaches January's forecast a year on.
  if ((await next.count()) === 0) await drawer.getByRole("button", { name: "שנה הבאה" }).click();
  await drawer.locator(".ui-month-cell-forecast").click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByText(/^תזרים צפוי · /u)).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("the month's filter docks into the bar once it reaches it (FLOW-1036)", async ({ page }) => {
  await page.goto("/e2e/cash?preview=1");
  await page.locator(".ui-dock-slot").evaluate((node) => {
    window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY);
  });
  await expect(page.locator(".ui-compact-bar-band .ui-compact-dock")).toHaveAttribute("data-open", "true");
  await page.locator(".ui-compact-bar-band .ui-compact-dock").getByRole("radio", { name: "נותר לשלם" }).click();
  await expect(page.getByRole("heading", { name: "קבועים ששולמו" })).toHaveCount(0);
});

test("a past month shows the way back to the current one", async ({ page }) => {
  await page.goto("/e2e/cash?preview=1&month=past");
  await expect(page.getByRole("link", { name: /^חזרה ל/ })).toBeVisible();
  // FLOW-1056 (owner): the month's lines under it, as קבועים and חד-פעמי, with how the month finished.
  await expect(page.getByRole("heading", { name: /^הפעילות ב/u })).toBeVisible();
  await expect(page.locator(".ui-home-act-close")).toContainText("נכנס");
  await expect(page.getByRole("heading", { name: "חד-פעמי" })).toBeVisible();
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

// FLOW-374: the bar is the board's 64px and its figure is whole inside it, at a phone and a narrow width.
for (const width of [390, 320]) {
  test(`the compact bar's figure is inside the bar at ${String(width)}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/e2e/cash?preview=1&scrolled=1&recurring=1");
    const bar = page.locator(".ui-compact-bar-band");
    await expect(bar).toBeVisible();
    // The bar slides in: measure once it has arrived (CI once read it mid-slide, 6px above the top).
    await bar.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)));
    const barBox = await bar.boundingBox();
    const netBox = await page.locator(".ui-compact-bar-centre-net").boundingBox();
    if (barBox == null || netBox == null) throw new Error("the compact bar or its figure is not drawn");
    expect(netBox.y + netBox.height).toBeLessThanOrEqual(barBox.y + barBox.height);
    expect(netBox.y).toBeGreaterThanOrEqual(barBox.y);
  });
}
