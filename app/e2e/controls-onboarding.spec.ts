import { expect, test } from "@playwright/test";
import { previewToast, toast, cursorOf, overlaps } from "./controls-helpers";

test.use({ viewport: { width: 390, height: 844 } });
// Preview-mode tests, one page per test (see controls-review.spec.ts).
test.describe.configure({ mode: "parallel" });

test("install, onboarding, and legal screens", async ({ page }) => {
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

  await page.goto("/onboarding?preview=1");
  await page.getByRole("radio", { name: "עוסק פטור" }).click();
  await expect(page.getByRole("radio", { name: "עוסק פטור" })).toBeChecked();
  await page.getByRole("textbox", { name: "שם העסק" }).fill("בדיקה");
  await page.getByRole("button", { name: "המשך" }).click();
  await toast(page, previewToast);
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/\?preview=1$/);

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

test("a preview toast stays clear of the onboarding business-type controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/onboarding?preview=1");
  await page.getByRole("textbox", { name: "שם העסק" }).fill("בדיקה");
  await page.getByRole("button", { name: "המשך" }).click();
  const note = page.locator(".ui-toast");
  await expect(note).toBeVisible();
  await expect.poll(async () => {
    const toast = await note.boundingBox();
    const registered = await page.getByRole("radio", { name: "עוסק מורשה" }).boundingBox();
    const exempt = await page.getByRole("radio", { name: "עוסק פטור" }).boundingBox();
    if (!toast || !registered || !exempt) return true;
    return overlaps(toast, registered) || overlaps(toast, exempt);
  }).toBe(false);
});
