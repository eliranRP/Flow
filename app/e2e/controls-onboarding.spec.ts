import { expect, test } from "@playwright/test";
import { toast, cursorOf } from "./controls-helpers";

test.use({ viewport: { width: 390, height: 844 } });
// Preview-mode tests, one page per test (see controls-review.spec.ts).
test.describe.configure({ mode: "parallel" });

test("install and legal screens", async ({ page }) => {
  await page.goto("/install?preview=1");
  await page.getByRole("button", { name: "הבנתי" }).click();
  await expect(page).toHaveURL(/\/settings\?preview=1$/);
  await page.goto("/e2e/install-android");
  await page.getByRole("button", { name: "התקנה" }).click();
  await toast(page, "ההתקנה נפתחה");
  await page.getByRole("button", { name: "לא עכשיו" }).click();
  await expect(page).toHaveURL(/\/settings\?preview=1$/);
  await page.goto("/e2e/install-other");
  await expect(page.getByText("בוחרים שיתוף ואז ״הוספה למסך הבית״")).toBeVisible();
  await expect(page.getByText("ההתקנה באייפון עובדת רק מספארי.")).toHaveCount(0);
  await page.getByRole("button", { name: "הבנתי" }).click();
  await expect(page).toHaveURL(/\/settings\?preview=1$/);

  await page.goto("/sign-in");
  const google = page.getByRole("button", { name: "המשך עם Google" });
  if (await page.getByText("הגדרת השרת אינה תקינה").count()) {
    await expect(google).toBeDisabled();
    expect(await cursorOf(google)).toBe("not-allowed");
  } else {
    await expect(google).toBeEnabled();
  }
  await page.getByRole("link", { name: "תנאי שימוש" }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "מדיניות פרטיות" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await page.goto("/sign-in?error=server_error");
  await page.getByRole("link", { name: "צריך עזרה בכניסה?" }).click();
  await expect(page).toHaveURL(/\/help$/);
  const mail = page.getByRole("link").filter({ hasText: /@/ });
  await expect(mail).toHaveAttribute("href", /^mailto:/);
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});
