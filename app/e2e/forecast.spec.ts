import { expect, test } from "@playwright/test";

// FLOW-403 (plan option A): Home's late-bills row opens the list, a row opens Search on that
// supplier; the project's "צפוי" month opens the sheet of who makes it up. Invented data only.
test.use({ viewport: { width: 375, height: 667 } });

test("Home: the late-bills row opens the list at its לא הגיעו section", async ({ page }) => {
  await page.goto("/e2e/home?preview=1");
  const row = page.getByRole("link", { name: "2 חשבונות לא הגיעו" });
  await expect(row).toBeVisible();
  // A count only: no total on the row.
  await expect(row).not.toContainText("₪");
  await row.click();
  // FLOW-415 (b-2): the קבועים screen, at its לא הגיעו section.
  await expect(page).toHaveURL(/\/e2e\/recurring\?preview=1#late$/);
  await expect(page.getByRole("heading", { name: "קבועים" })).toBeVisible();
  const late = page.locator("section", { has: page.getByRole("heading", { name: "לא הגיעו" }) });
  await expect(late.locator("li")).toHaveCount(2);
  // FLOW-447: the row says how many days late the bill is, counted from its usual day.
  await expect(late.locator("li").first()).toContainText("באיחור");
});

test("קבועים: a charge up 20% or more shows its change as the bad-news hint", async ({ page }) => {
  await page.goto("/e2e/recurring?preview=1");
  await expect(page.getByText("▲ 38%", { exact: true })).toBeVisible();
});

test("Home: the קבועים tab opens קבועים, and the box has no link to it (FLOW-364)", async ({ page }) => {
  await page.goto("/e2e/cash?preview=1&box=none");
  await expect(page.getByRole("link", { name: "לכל הקבועים" })).toHaveCount(0);
  const tab = page.getByRole("navigation", { name: "ניווט ראשי" }).getByRole("link", { name: "קבועים" });
  await expect(tab).toBeVisible();
  expect((await tab.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await tab.click();
  await expect(page).toHaveURL(/\/recurring\?preview=1$/);
});

test("קבועים on one project shows only its rows and names it (FLOW-424)", async ({ page }) => {
  await page.goto("/e2e/recurring?preview=1&project=p-birch-lane");
  await expect(page.getByRole("heading", { name: "קבועים" })).toBeVisible();
  await expect(page.locator(".ui-recurring-head").getByText("Birch Lane", { exact: true })).toBeVisible();
  await expect(page.locator(".ui-recurring li")).toHaveCount(4);
  await expect(page.getByText("Juniper Pointe HOA")).toHaveCount(0);
});

test("Project: a צפוי month opens the sheet of its parties, and the sheet closes", async ({ page }) => {
  await page.goto("/e2e/project-detail?preview=1&section=expenses");
  const section = page.getByRole("region", { name: "צפוי" });
  await expect(section).toBeVisible();
  await expect(section.getByRole("button")).toHaveCount(3);
  await expect(section.getByRole("button", { name: "שאר אוקטובר, בערך ₪2,330" })).toBeVisible();
  await section.getByRole("button", { name: "נובמבר, בערך ₪4,090" }).click();
  const sheet = page.getByRole("dialog", { name: "נובמבר" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".ui-expected-parties li")).toHaveCount(4);
  await expect(sheet.locator(".ui-approx-income")).toHaveCount(0);
  await sheet.getByRole("button", { name: "סגירה" }).click();
  await expect(sheet).toBeHidden();
  await expect(section.getByRole("button", { name: "נובמבר, בערך ₪4,090" })).toBeFocused();
});

test("Project: with no history the section says so in one line", async ({ page }) => {
  await page.goto("/e2e/project-detail?preview=1&expected=none&section=expenses");
  const section = page.getByRole("region", { name: "צפוי" });
  await expect(section).toContainText("אין עדיין צפי.");
  await expect(section.getByRole("button")).toHaveCount(0);
});
