import { expect, test } from "@playwright/test";

// FLOW-403 (plan option A): Home's late-bills row opens the list, a row opens Search on that
// supplier; the project's "צפוי" month opens the sheet of who makes it up. Invented data only.
test.use({ viewport: { width: 375, height: 667 } });

test("Home: the late-bills row opens the list, and a bill opens Search on its supplier", async ({ page }) => {
  await page.goto("/e2e/home?preview=1");
  const row = page.getByRole("link", { name: "2 חשבונות לא הגיעו" });
  await expect(row).toBeVisible();
  // A count only: no total on the row.
  await expect(row).not.toContainText("₪");
  await row.click();
  // FLOW-415 (b-2): the קבועים screen, at its לא הגיעו section.
  await expect(page).toHaveURL(/\/e2e\/missing-bills\?preview=1#late$/);
  await expect(page.getByRole("heading", { name: "קבועים" })).toBeVisible();
  const bills = page.getByRole("region", { name: "לא הגיעו" }).getByRole("link");
  await expect(bills).toHaveCount(2);
  // FLOW-415: the row says when the bill usually comes and when the last one came.
  const power = page.getByRole("link", { name: "אור חשמל, בניין הדקל · חשמל, כל חודש ב־2 · אחרון 02/09, בערך ₪1,850" });
  await expect(power).toContainText("כ־");
  await power.click();
  await expect(page).toHaveURL(/\/search\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get("q")).toBe("אור חשמל");
  expect(url.searchParams.get("dir")).toBe("expense");
  await expect(page.getByRole("searchbox")).toHaveValue("אור חשמל");
});

test("קבועים: a late row hides for this user with ✕ and comes back on ביטול; a change opens its payment", async ({ page }) => {
  await page.goto("/e2e/missing-bills?preview=1");
  const late = page.getByRole("region", { name: "לא הגיעו" });
  await expect(late.getByRole("link")).toHaveCount(2);
  await late.getByRole("button", { name: "הסתרה, מים טובים" }).click();
  await expect(page.getByText("ההתראה הוסתרה")).toBeVisible();
  await expect(late.getByRole("link")).toHaveCount(1);
  await page.getByRole("button", { name: "ביטול" }).click();
  await expect(late.getByRole("link")).toHaveCount(2);
  const arrived = page.getByRole("region", { name: "הגיעו החודש" });
  await expect(arrived.getByRole("link")).toHaveCount(3);
  await arrived.getByRole("link", { name: /^אור חשמל, .*עלייה של 38%$/ }).click();
  await expect(page).toHaveURL(/\/transactions\/t-power-oct\?preview=1$/);
});

test("Home: with no alert in the box, לכל הקבועים still opens קבועים (FLOW-423)", async ({ page }) => {
  await page.goto("/e2e/cash?preview=1&box=none");
  const link = page.getByRole("link", { name: "לכל הקבועים" });
  await link.scrollIntoViewIfNeeded();
  expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await link.click();
  await expect(page).toHaveURL(/\/e2e\/missing-bills\?preview=1$/);
  await expect(page.getByRole("heading", { name: "קבועים" })).toBeVisible();
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
