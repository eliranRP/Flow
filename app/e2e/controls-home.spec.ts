import { expect, test } from "@playwright/test";
import { cursorOf } from "./controls-helpers";

test.use({ viewport: { width: 390, height: 844 } });
// Preview-mode tests, one page per test (see controls-review.spec.ts).
test.describe.configure({ mode: "parallel" });

test("tab bar has four tabs, and each opens its screen (FLOW-364)", async ({ page }) => {
  await page.goto("/?preview=1");
  const bar = page.getByRole("navigation", { name: "ניווט ראשי" });
  await expect(bar.getByRole("link")).toHaveCount(4);
  await page.getByRole("link", { name: "פרויקטים" }).click();
  await expect(page).toHaveURL(/\/projects\?preview=1$/);
  await bar.getByRole("link", { name: "הלוואות" }).click();
  await expect(page).toHaveURL(/\/settings\/loans\?preview=1$/);
  await bar.getByRole("link", { name: "קבועים" }).click();
  await expect(page).toHaveURL(/\/recurring\?preview=1$/);
  // Let the route change settle before the next tab click: the lazy screen can drop an early click.
  await expect(bar.getByRole("link", { name: "קבועים" })).toHaveAttribute("aria-current", "page");
  await bar.getByRole("link", { name: "בית", exact: true }).click();
  await expect(page).toHaveURL(/\/\?preview=1$/);
  // The add sits in Home's band, not in the tab bar (FLOW-364).
  await expect(bar.getByRole("link", { name: "הוספה", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "הוספה", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "הוספה" })).toBeVisible();
});

test("the current tab stays put and capture rows stay disabled", async ({ page }) => {
  await page.goto("/?preview=1");
  const home = page.getByRole("link", { name: "בית", exact: true });
  await expect(home).toHaveAttribute("aria-current", "page");
  await home.click();
  await expect(page).toHaveURL(/\/\?preview=1$/);
  await page.goto("/add?preview=1");
  const addSheet = page.getByRole("dialog", { name: "הוספה" });
  await expect(addSheet).toBeVisible();
  await expect(addSheet).toHaveAttribute("data-state", "open");
  // The band's + opens the sheet and its close returns to Home (FLOW-364).
  await page.goto("/?preview=1");
  await page.getByRole("link", { name: "הוספה", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "הוספה" })).toBeVisible();
  await page.getByRole("dialog", { name: "הוספה" }).getByRole("button", { name: "סגירה" }).click();
  await expect(page.getByRole("dialog", { name: "הוספה" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/\?preview=1$/);
  await page.goto("/add?preview=1");
  // FLOW-331: three quick actions, all enabled.
  for (const name of [/פרויקט חדש/, /הלוואה חדשה/, /חיבור בנק/]) {
    await expect(page.getByRole("button", { name })).toBeEnabled();
  }
  // FLOW-339: ✕ closes it; ביטול belongs to confirm sheets.
  await page.getByRole("dialog", { name: "הוספה" }).getByRole("button", { name: "סגירה" }).click();
  await expect(page.getByRole("dialog", { name: "הוספה" })).toHaveCount(0);
});

test("home connects, filters the period, and opens a project", async ({ page }) => {
  await page.goto("/?preview=1");
  await page.getByRole("link", { name: "חיבור Mercury" }).click();
  await expect(page).toHaveURL(/\/settings\/connections\?preview=1$/);

  // The period pill sits on the project's profit section, which still hosts the period sheet and the range sheet.
  await page.goto("/e2e/project-detail?preview=1&section=profit");
  // FLOW-355 (A): one period pill on the band; it opens the period sheet, and a row applies on tap.
  await expect(page.getByRole("radiogroup", { name: "תקופה" })).toHaveCount(0);
  const label = page.getByRole("button", { name: /בחירת תקופה$/ });
  const before = await label.textContent();
  await label.click();
  const periodSheet = page.getByRole("dialog", { name: "תקופה" });
  await expect(periodSheet).toBeVisible();
  await periodSheet.getByRole("radio", { name: "שנה" }).click();
  await expect(periodSheet).toHaveCount(0);
  await expect(label).not.toHaveText(before ?? "");
  // FLOW-358: the pill names the year, so the label is the word alone.
  await expect(page.getByRole("heading", { name: /^(רווח|הפסד|רווח והפסד)$/ })).toBeVisible();

  await label.click();
  await page.getByRole("button", { name: "טווח מותאם" }).click();
  await expect(page.getByRole("dialog", { name: "תקופה" })).toHaveCount(0);
  const range = page.getByRole("dialog", { name: "טווח מותאם" });
  await expect(range).toBeVisible();
  const year = range.getByRole("button", { name: "מתחילת השנה" });
  await expect(year).toBeInViewport();
  await year.click();
  await expect(year).toHaveAttribute("aria-pressed", "true");
  const forward = range.getByRole("button", { name: "חודש הבא" });
  await expect(forward).toBeDisabled();
  expect(await cursorOf(forward)).toBe("not-allowed");
  await range.locator('button.ui-icon-btn[aria-label="חודש קודם"]').click();
  await expect(forward).toBeEnabled();
  const day = range.getByRole("group", { name: "טווח מותאם" }).getByRole("button").first();
  await day.click();
  await expect(day).toHaveAttribute("aria-selected", "true");
  const apply = range.getByRole("button", { name: /הצגת/ });
  await expect(apply).toBeInViewport();
  await apply.click();
  await expect(range).toHaveCount(0);

  // Home's pending row, then the company profit page's project row, then the Projects tab (the profit page has no link to the list).
  await page.goto("/e2e/cash?preview=1");
  await page.getByRole("link", { name: /פריטים ממתינים/ }).click();
  await expect(page).toHaveURL(/\/review\?preview=1$/);
  await page.goto("/e2e/company-profit?preview=1");
  await page.getByRole("link", { name: /^בית הדקל/ }).click();
  await expect(page).toHaveURL(/\/projects\/p1\/profit\?from=profit&preview=1$/);
  await page.goto("/e2e/cash?preview=1");
  await page.getByRole("navigation", { name: "ניווט ראשי" }).getByRole("link", { name: "פרויקטים" }).click();
  await expect(page).toHaveURL(/\/projects\?preview=1$/);
});

test("a preview load error returns to the empty preview", async ({ page }) => {
  await page.goto("/?preview=error");
  await page.getByRole("button", { name: "נסו שוב" }).click();
  await expect(page).toHaveURL(/\/\?preview=1$/);
  await expect(page.getByRole("heading", { name: "חברו את הבנק" })).toBeVisible();
  await page.goto("/unpaid?preview=error");
  await page.getByRole("button", { name: "נסו שוב" }).click();
  await expect(page).toHaveURL(/\/unpaid\?preview=1$/);
  await expect(page.getByText("אין חיבור לאינטרנט")).toHaveCount(0);
});
