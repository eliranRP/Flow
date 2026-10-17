import { expect, test } from "@playwright/test";
import { previewToast, toast } from "./controls-helpers";

test.use({ viewport: { width: 390, height: 844 } });
// Preview-mode tests, one page per test (see controls-review.spec.ts).
test.describe.configure({ mode: "parallel" });

test("change sheet picks, remembers, splits, and saves", async ({ page }) => {
  await page.goto("/e2e/change?preview=1");
  await page.getByRole("button", { name: /פרויקט:/ }).click();
  await expect(page.getByRole("heading", { name: "בחירת פרויקט" })).toBeVisible();
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page.getByRole("heading", { name: "שינוי שיוך" })).toBeVisible();
  await page.getByRole("button", { name: /פרויקט:/ }).click();
  await page.getByRole("radio", { name: "וילה רעננה" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "שמירה", exact: true }).click();
  await toast(page, "השיוך נשמר");
  await expect(page.getByRole("button", { name: /וילה רעננה/ })).toBeVisible();
  await page.getByRole("button", { name: /קטגוריה:/ }).click();
  await expect(page.getByRole("heading", { name: "בחירת קטגוריה" })).toBeVisible();
  await page.getByRole("radio", { name: "הובלה" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "שמירה", exact: true }).click();
  await toast(page, "השיוך נשמר");
  const remember = page.getByRole("switch", { name: "לזכור לספק הזה" });
  await remember.click();
  await expect(remember).not.toBeChecked();
  await page.getByRole("button", { name: /פרויקט:/ }).click();
  await page.getByRole("button", { name: "פיצול בין פרויקטים" }).click();
  await toast(page, "הפיצול נעשה ממסך התנועה, אחרי השיוך.");
  await page.getByRole("button", { name: /פרויקט:/ }).click();
  await page.getByRole("button", { name: "פרויקט חדש" }).click();
  await page.getByRole("textbox", { name: "שם" }).fill("גג חדש");
  await page.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByRole("button", { name: /גג חדש/ })).toBeVisible();
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page).toHaveURL(/\/review\?preview=1$/);
});

test("open invoices: the list adds up, a row marks paid, and ביטול clears the mark", async ({ page }) => {
  await page.goto("/e2e/invoices");
  // FLOW-367: the fixture's open total, and the one invoice over 30 days.
  await expect(page.locator(".ui-inv-total")).toContainText("21,300");
  await expect(page.locator(".ui-inv-overdue")).toContainText("12,500");
  const larkspur = page.getByRole("link", { name: /^Larkspur HOA/ }).locator("xpath=ancestor::li");
  await larkspur.getByRole("button", { name: "סימון כשולם" }).click();
  await toast(page, "סומן כשולם");
  await expect(larkspur).toContainText("סומן כשולם · ממתין לסנכרון");
  await expect(page.locator(".ui-inv-total")).toContainText("15,700");
  await page.locator(".ui-toast").getByRole("button", { name: "ביטול" }).click();
  await toast(page, "הסימון בוטל.");
  await expect(page.locator(".ui-inv-total")).toContainText("21,300");
});

test("a transaction shows its VAT, changes, and confirms delete", async ({ page }) => {
  await page.goto("/e2e/txn?preview=1");
  await expect(page.getByRole("button", { name: "חשבונית ותשלום" })).toHaveCount(0);
  await expect(page.getByText(/^לפני מע״מ · מע״מ \(משוער\) ₪[\d,.]+$/)).toBeVisible();
  // The date sits on the meta line above the VAT line (FLOW-366).
  await expect(page.locator(".ui-txn-meta").first()).toContainText(/\d{2}\/\d{2}\/\d{4}/);
  await page.getByRole("button", { name: "עוד" }).click();
  await page.getByRole("button", { name: "מחיקה" }).click();
  await expect(page.getByRole("dialog", { name: "למחוק את הרשומה?" })).toBeVisible();
  await page.getByRole("button", { name: "מחיקה" }).click();
  await toast(page, previewToast);
  await page.getByRole("button", { name: "ביטול" }).click();
  // FLOW-320: the category row opens the category picker, and the pick closes it.
  await page.getByRole("button", { name: /קטגוריה/ }).click();
  await expect(page.getByRole("dialog", { name: "בחירת קטגוריה" })).toBeVisible();
  await page.getByRole("radio", { name: "הובלה" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "שמירה", exact: true }).click();
  await toast(page, "השיוך נשמר");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /הובלה/ })).toBeVisible();
  // FLOW-366: the פיצול row (its value names the split when there is one).
  await page.getByRole("button", { name: /^פיצול/ }).click();
  await expect(page).toHaveURL(/\/transactions\/t-manual\/split/);
});

test("the transaction change sheet opens split in place", async ({ page }) => {
  await page.goto("/e2e/txn?preview=1");
  await page.getByRole("button", { name: /^פרויקט / }).click();
  const sheet = page.getByRole("dialog", { name: "בחירת פרויקט" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "פיצול בין פרויקטים" }).click();
  await expect(page).toHaveURL(/\/transactions\/t-manual\/split\?preview=1$/);
  await expect(page.getByRole("heading", { name: "פיצול בין פרויקטים" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/e2e\/txn\?preview=1$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
