import { expect, test } from "@playwright/test";

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
  await expect(page).toHaveURL(/\/loans\?preview=1$/);
  await bar.getByRole("link", { name: "דוחות" }).click();
  await expect(page).toHaveURL(/\/reports\?preview=1$/);
  // Let the route change settle before the next tab click: the lazy screen can drop an early click.
  await expect(bar.getByRole("link", { name: "דוחות" })).toHaveAttribute("aria-current", "page");
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
  // FLOW-331: two quick actions, all enabled; the bank row is gone (Settings connects a bank).
  for (const name of [/פרויקט חדש/, /הלוואה חדשה/]) {
    await expect(page.getByRole("button", { name })).toBeEnabled();
  }
  await expect(page.getByRole("button", { name: /חיבור בנק/ })).toHaveCount(0);
  // FLOW-339: ✕ closes it; ביטול belongs to confirm sheets.
  await page.getByRole("dialog", { name: "הוספה" }).getByRole("button", { name: "סגירה" }).click();
  await expect(page.getByRole("dialog", { name: "הוספה" })).toHaveCount(0);
});

test("home connects and opens a project", async ({ page }) => {
  await page.goto("/?preview=1");
  await page.getByRole("link", { name: "חיבור Mercury" }).click();
  await expect(page).toHaveURL(/\/settings\/connections\?preview=1$/);

  // Home's review button (FLOW-958), then the company profit page's project row, then the Projects tab (the profit page has no link to the list).
  await page.goto("/e2e/cash?preview=1");
  await page.getByRole("link", { name: /^לאישור \d+ פריטים/ }).click();
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
