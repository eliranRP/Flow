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

// FLOW-976: First use v2.
test("sign-in says it is offline before the tap, and keeps its help in the error", async ({ page, context }) => {
  await page.goto("/sign-in?error=server_error");
  const help = page.getByRole("link", { name: "צריך עזרה בכניסה?" });
  expect(await help.evaluate((el) => el.closest(".ui-notice") != null)).toBe(true);
  expect((await help.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole("button", { name: "ניסיון חוזר עם Google" })).toBeVisible();
  for (const name of ["תנאי שימוש", "מדיניות פרטיות"]) {
    expect((await page.getByRole("link", { name }).boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  await page.goto("/sign-in");
  await context.setOffline(true);
  const offline = page.getByText("אין חיבור · הכניסה תעבוד כשהחיבור יחזור");
  await expect(offline).toBeVisible();
  await context.setOffline(false);
  await expect(offline).toHaveCount(0);
});

test("setup's buttons are never greyed out and say why a tap did nothing", async ({ page }) => {
  await page.goto("/e2e/setup/review");
  const before = page.getByRole("button", { name: "אשרו את השורה למעלה" });
  await expect(before).toBeEnabled();
  await before.click();
  await expect(page.getByRole("button", { name: "אישור", exact: true })).toBeFocused();
  for (const name of ["הקודם", "דילוג על הכל"]) {
    expect((await page.getByRole("button", { name }).boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }

  await page.goto("/e2e/setup/projects");
  const add = page.getByRole("button", { name: "הוספה", exact: true });
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.getByRole("alert")).toHaveText("כתבו שם לפרויקט");
});
