import { expect, test } from "@playwright/test";

// FLOW-140c1 (board Profit and ProfitBasis): Home's רווח row opens the company profit page; its head
// has the summary rows, next month's card and the chart (FLOW-143); its category rows open in place,
// its chips set ?by=, its project row opens the project's profit, and the basis line opens the basis
// sheet. The period switch (FLOW-145) turns the page to this year, a closed year or since the start.
// Invented data only, in preview.
test.use({ viewport: { width: 390, height: 844 } });

test("Home's profit row opens the company profit page, and Back returns Home", async ({ page }) => {
  await page.goto("/e2e/cash?preview=1");
  await page.getByRole("button", { name: /^רווח החודש/ }).click();
  await expect(page).toHaveURL(/\/profit\?preview=1$/);
  await expect(page.getByRole("heading", { name: "רווח", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "חזרה", exact: true }).click();
  await expect(page).toHaveURL(/\/e2e\/cash\?preview=1$/);
});

test("the chips sort the page, a category opens in place, and a project opens its profit", async ({ page }) => {
  await page.goto("/e2e/company-profit?preview=1");
  const chips = page.getByRole("group", { name: "סידור" }).first();
  await chips.getByRole("button", { name: "לפי קטגוריה" }).click();
  await expect(page).toHaveURL(/\?preview=1&by=category$/);
  const categories = page.locator(".ui-pcat-button");
  const category = categories.first();
  await expect(category).toHaveAttribute("aria-expanded", "false");
  await category.click();
  await expect(category).toHaveAttribute("aria-expanded", "true");
  // One category open at a time: opening another closes the first.
  await categories.nth(1).click();
  await expect(categories.nth(1)).toHaveAttribute("aria-expanded", "true");
  await expect(category).toHaveAttribute("aria-expanded", "false");
  await categories.nth(1).click();
  await expect(categories.nth(1)).toHaveAttribute("aria-expanded", "false");
  await chips.getByRole("button", { name: "לפי פרויקט" }).click();
  await expect(page).toHaveURL(/\/e2e\/company-profit\?preview=1$/);
  // The general costs (get_breakdown's overhead and unassigned, and the overhead project's own lines) are one row
  // under the overhead project's name, opening that project (owner 20/10); no כללי row and no key in a link.
  const list = page.locator(".ui-cp-list");
  await expect(list.locator(".ui-cp-row", { hasText: "משרד החברה / תקורה" }).locator("a")).toHaveAttribute("href", /^\/projects\/p0\/profit\?from=profit&preview=1$/);
  await expect(list.locator(".ui-cp-row", { hasText: "כללי" })).toHaveCount(0);
  await expect(list.locator('a[href^="/projects/overhead"], a[href^="/projects/unassigned"]')).toHaveCount(0);
  await page.locator('a[href^="/projects/"]').first().click();
  await expect(page).toHaveURL(/\/projects\/p\d\/profit\?from=profit&preview=1$/);
});

test("the head: the summary rows, next month's card with no link, and the chart (FLOW-143)", async ({ page }) => {
  await page.goto("/e2e/company-profit?preview=1");
  const summary = page.locator(".ui-cp-card .ui-pp-label");
  await expect(summary).toHaveText(["הכנסות", "הוצאות שנספרות ברווח", "רווח אוקטובר", "רווח מתחילת השנה"]);
  // The bars and the loose year-to-date line are gone.
  await expect(page.locator(".ui-cp-head .ui-pp-bar")).toHaveCount(0);
  const card = page.locator(".ui-cp-head .ui-fc-card");
  await expect(card).toContainText("5 פרויקטים וכללי");
  await expect(card).toContainText("רווח צפוי");
  await expect(card.locator("a")).toHaveCount(0);
  await expect(page.getByRole("img", { name: /^הכנסות והוצאות של החברה, מאי עד אוקטובר, וצפי נובמבר/ })).toBeVisible();
  await expect(page.locator(".ui-cp-head .ui-fc-chart a")).toHaveCount(0);
});

test("the basis line opens the basis sheet; a pick in preview toasts and writes nothing", async ({ page }) => {
  await page.goto("/e2e/company-profit?preview=1");
  await page.getByRole("button", { name: /נספר לפי תאריך תשלום · שינוי/ }).click();
  const sheet = page.getByRole("dialog", { name: "רווח ותזרים לפי" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("radio", { name: /תאריך חשבונית/ }).click();
  await expect(page.getByText("במצב תצוגה זה לא נשמר.")).toBeVisible();
  // The pick does not save here: the sheet stays open.
  await expect(sheet).toBeVisible();
});

test("the chip row scrolls only sideways: a drag up or down never moves it", async ({ page }) => {
  await page.goto("/e2e/company-profit?preview=1");
  const chips = page.locator(".ui-cp-chips").first();
  await expect(chips).toBeVisible();
  // overflow-x: auto alone makes the row a vertical scroller too, so a drag over it nudged the chips up.
  expect(await chips.evaluate((el) => getComputedStyle(el).overflowY)).toBe("hidden");
  const box = await chips.boundingBox();
  await page.mouse.move((box?.x ?? 0) + 40, (box?.y ?? 0) + (box?.height ?? 0) / 2);
  await page.mouse.wheel(0, 120);
  expect(await chips.evaluate((el) => el.scrollTop)).toBe(0);
  // The row holds the chips' 44px hit area, so nothing in it is cut off at the top or bottom.
  const { client, scroll } = await chips.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }));
  expect(client).toBeGreaterThanOrEqual(scroll);
});

test("the period switch: this year, its projects, since the start and a closed year (FLOW-145)", async ({ page }) => {
  await page.goto("/e2e/company-profit?preview=1");
  const period = page.getByRole("radiogroup", { name: "תקופה" });
  await expect(period.getByRole("radio")).toHaveText(["אוקטובר", "2026", "מההתחלה"]);
  await expect(period.getByRole("radio", { name: "אוקטובר" })).toHaveAttribute("aria-checked", "true");

  await period.getByRole("radio", { name: "2026" }).click();
  await expect(page).toHaveURL(/\/e2e\/company-profit\?preview=1&period=year$/);
  await expect(page.getByText("2026 · עד היום, 11/10")).toBeVisible();
  await expect(page.locator(".ui-cp-card .ui-pp-label")).toHaveText(["הכנסות", "הוצאות שנספרות ברווח", "רווח 2026 עד היום", "רווח 2025 כולה"]);
  const card = page.locator(".ui-cp-head .ui-fc-card");
  await expect(card).toContainText("סוף 2026");
  await expect(card).toContainText("רווח עד היום");
  await expect(card).toContainText("רווח צפוי ל־2026");
  await expect(page.getByRole("img", { name: "הכנסות והוצאות לפי חודש ב־2026, וצפי לנובמבר ודצמבר" })).toBeVisible();
  // November and December are dashed.
  await expect(page.locator(".ui-cp-head .ui-fc-ahead")).toHaveCount(2);

  // By project: a project opens its profit page.
  await page.getByRole("group", { name: "סידור" }).first().getByRole("button", { name: "לפי פרויקט" }).click();
  await expect(page).toHaveURL(/period=year&list=project$/);
  await expect(page.getByText("פרויקטים שהסתיימו · 4")).toBeVisible();
  await page.getByRole("button", { name: "לפי חודש" }).first().click();
  await expect(page).toHaveURL(/\?preview=1&period=year$/);

  // This month's row opens the month view.
  await page.getByRole("button", { name: /^אוקטובר · עד היום/ }).click();
  await expect(page).toHaveURL(/\/e2e\/company-profit\?preview=1$/);
  await expect(period.getByRole("radio", { name: "אוקטובר" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".ui-cp-card .ui-pp-label")).toHaveText(["הכנסות", "הוצאות שנספרות ברווח", "רווח אוקטובר", "רווח מתחילת השנה"]);

  // Since the start: the years' chart and list; a year opens it, closed.
  await period.getByRole("radio", { name: "מההתחלה" }).click();
  await expect(page).toHaveURL(/\?preview=1&period=all$/);
  await expect(page.getByText("מאז ינואר 2024 · 3 שנים")).toBeVisible();
  await expect(page.getByText("השנה הרווחית ביותר · 2025")).toBeVisible();
  await expect(page.getByRole("img", { name: /^הכנסות לפי שנה: 2024/ })).toBeVisible();
  await page.getByRole("region", { name: "לפי שנה" }).getByRole("button", { name: /^2025/ }).click();
  await expect(page).toHaveURL(/\?preview=1&period=year&year=2025$/);
  await expect(period.getByRole("radio", { name: "2025" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("2025 · שנה סגורה")).toBeVisible();
  await expect(card).toHaveCount(0);
  await expect(page.locator(".ui-cp-head .ui-fc-ahead")).toHaveCount(0);
});

test("by project, a project of the year opens its profit page (FLOW-145)", async ({ page }) => {
  await page.goto("/e2e/company-profit?preview=1&period=year&list=project");
  await expect(page.locator(".ui-cp-period-list .ui-cp-row", { hasText: "משרד החברה / תקורה" }).locator("a")).toHaveAttribute("href", /^\/projects\/p0\/profit\?from=profit&preview=1$/);
  await page.locator('.ui-cp-period-list a[href^="/projects/"]').first().click();
  await expect(page).toHaveURL(/\/projects\/p\d\/profit\?from=profit&preview=1$/);
});
