import { expect, test } from "@playwright/test";

test("preview home is the first-run empty state", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?preview=1");
  await expect(page.getByRole("heading", { name: "כאן יופיע הרווח הנקי של העסק" })).toBeVisible();
  await expect(page.getByText("שלום, …")).toBeVisible();
  await expect(page.getByText("עוד אין נתונים")).toBeVisible();
  await expect(page.getByRole("link", { name: "חיבור SUMIT" })).toBeVisible();
  await expect(page.getByText("מצב תצוגה")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "ניווט ראשי" })).toBeVisible();
  await expect(page.getByText("₪0")).toHaveCount(0);
});

test("preview error and loading states are reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?preview=error");
  await expect(page.getByText("לא הצלחנו לטעון")).toBeVisible();
  await page.goto("/?preview=loading");
  await expect(page.locator("[aria-busy=true]")).toBeVisible();
});

test("add is a sheet and transaction detail has no tab bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/add?preview=1");
  await expect(page.getByRole("dialog", { name: "הוספה" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "ניווט ראשי" })).toBeVisible();
  await page.goto("/transactions/1?preview=1");
  await expect(page.getByRole("heading", { name: "פרטי תנועה" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "ניווט ראשי" })).toHaveCount(0);
});

test("signed-out home redirects to sign-in", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("button", { name: "המשך עם Google" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "תנאי שימוש" })).toBeVisible();
});
