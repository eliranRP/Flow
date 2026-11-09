import { expect, test } from "@playwright/test";
import { previewToast, toast } from "./controls-helpers";

test.use({ viewport: { width: 390, height: 844 } });
// Preview-mode tests, one page per test (see controls-review.spec.ts).
test.describe.configure({ mode: "parallel" });

test("projects list, finished projects, and the new-project sheet", async ({ page }) => {
  await page.goto("/e2e/projects?preview=1");
  // FLOW-445: the list has no search field; search is the band's link.
  await expect(page.getByRole("searchbox", { name: "חיפוש פרויקט" })).toHaveCount(0);
  // FLOW-1044: פעילים / הסתיימו / הכול, and the rows grouped by kind under a head with the count and total.
  const filter = page.getByRole("radiogroup", { name: "סינון פרויקטים" });
  await expect(filter.getByRole("radio", { name: "פעילים" })).toBeChecked();
  const renovation = page.getByRole("region", { name: "שיפוץ" });
  await expect(renovation.getByRole("link", { name: /^Lark Hill/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "השכרה" }).getByRole("link", { name: /^Birch St/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "פרויקט" }).getByRole("link", { name: /^Halvorsen/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "תקורה" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^פרויקט ישן/ })).toHaveCount(0);
  await filter.getByRole("radio", { name: "הסתיימו" }).click();
  await expect(filter.getByRole("radio", { name: "הסתיימו" })).toBeChecked();
  await expect(page.getByRole("link", { name: /^פרויקט ישן/ })).toContainText("הסתיים");
  await expect(renovation.getByRole("link", { name: /^Lark Hill/ })).toHaveCount(0);
  await filter.getByRole("radio", { name: "הכול" }).click();
  await expect(page.getByRole("link", { name: /^פרויקט ישן/ })).toBeVisible();
  await renovation.getByRole("link", { name: /^Lark Hill/ }).click();
  await expect(page).toHaveURL(/\/projects\/p2/);
  await page.goto("/e2e/projects?preview=1&new=project");
  const dialog = page.getByRole("dialog", { name: "פרויקט חדש" });
  await expect(dialog).toBeVisible();
  // FLOW-1044: the kind is picked first, and its fields follow it.
  const kind = dialog.getByRole("radiogroup", { name: "סוג" });
  await expect(kind.getByRole("radio", { name: "שיפוץ" })).toBeChecked();
  await expect(dialog.getByRole("textbox", { name: "מחיר קנייה" })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "תקציב שיפוץ" })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "שווי צפוי אחרי שיפוץ" })).toBeVisible();
  await kind.getByRole("radio", { name: "השכרה" }).click();
  await expect(dialog.getByRole("textbox", { name: "שווי הנכס היום" })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "תקציב שיפוץ" })).toHaveCount(0);
  await kind.getByRole("radio", { name: "פרויקט" }).click();
  await expect(dialog.getByRole("textbox", { name: "סכום החוזה" })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "מחיר קנייה" })).toHaveCount(0);
  await kind.getByRole("radio", { name: "תקורה" }).click();
  await expect(dialog.getByRole("textbox", { name: "סכום החוזה" })).toHaveCount(0);
  await kind.getByRole("radio", { name: "שיפוץ" }).click();
  const create = dialog.getByRole("button", { name: "יצירת פרויקט" });
  // FLOW-961: never a dead button: with no name the tap says why under the field.
  await expect(create).toBeEnabled();
  await create.click();
  await expect(dialog.getByText("צריך שם כדי ליצור את הפרויקט")).toBeVisible();
  await dialog.getByRole("textbox", { name: "שם הפרויקט" }).fill("גג חדש");
  await expect(dialog.getByText("צריך שם כדי ליצור את הפרויקט")).toHaveCount(0);
  await create.click();
  await toast(page, previewToast);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "פרויקט חדש" })).toHaveCount(0);
});

test("a project opens its menu, confirms the finish in the sheet, and keeps the overhead switch", async ({ page }) => {
  await page.goto("/projects/herzl?preview=loading");
  await page.getByRole("button", { name: "עוד" }).click();
  await expect(page.getByRole("dialog", { name: "עוד" })).toBeVisible();
  await expect(page.getByText("הפרויקט עדיין נטען.")).toBeVisible();

  await page.goto("/e2e/project-detail?preview=1");
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/projects/);
  await page.goto("/e2e/project-detail?preview=1");
  await page.getByRole("button", { name: "עוד" }).click();
  // FLOW-1044: סיום הפרויקט asks inside the same sheet first; חזרה goes back to the menu.
  await page.getByRole("dialog", { name: "שיפוץ הרצל 12" }).getByRole("button", { name: /^סיום הפרויקט/ }).click();
  const confirm = page.getByRole("dialog", { name: "לסיים את שיפוץ הרצל 12?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "חזרה" }).click();
  await expect(page.getByRole("dialog", { name: "שיפוץ הרצל 12" })).toBeVisible();
  await page.getByRole("dialog", { name: "שיפוץ הרצל 12" }).getByRole("button", { name: /^סיום הפרויקט/ }).click();
  // The confirm finishes at once (the toast offers ביטול, FLOW-961 decision 0213); preview writes nothing.
  await confirm.getByRole("button", { name: "סיום הפרויקט" }).click();
  await toast(page, previewToast);
  await expect(page.getByRole("dialog", { name: /^לסיים את/ })).toHaveCount(0);
  // The menu is the board's rows; the overhead switch lives in the edit sheet it opens.
  await page.getByRole("button", { name: "עוד" }).click();
  const menu = page.getByRole("dialog", { name: "שיפוץ הרצל 12" });
  await expect(menu.getByRole("link", { name: /^השקעה והלוואות/ })).toBeVisible();
  await expect(menu.getByRole("link", { name: /^רווח מתחילת הפרויקט/ })).toHaveAttribute("href", /\/projects\/p1\/profit\?preview=1&period=all$/);
  await expect(menu.getByRole("switch")).toHaveCount(0);
  await expect(menu.getByRole("button", { name: "סגירה" })).toHaveCount(0);
  await menu.getByRole("button", { name: /^עריכת פרטים/ }).click();
  const overhead = page.getByRole("dialog", { name: "עריכת פרויקט" }).getByRole("switch", { name: "רווח אחרי הוצאות כלליות" });
  await overhead.click();
  await expect(overhead).toBeChecked();
  // FLOW-331: + → פרויקט חדש opens the project sheet on Projects; Back does not reopen +.
  await page.goto("/add?preview=1");
  await page.getByRole("button", { name: /פרויקט חדש/ }).click();
  await expect(page.getByRole("dialog", { name: "פרויקט חדש" })).toBeVisible();
  await expect(page).toHaveURL(/\/projects\?preview=1$/);
});

test("a project's profit page opens a month, and Back steps back one screen at a time", async ({ page }) => {
  await page.goto("/e2e/project-profit?preview=1");
  await page.getByRole("link", { name: /^ספטמבר/ }).first().click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/profit\/\d{4}-\d{2}\?preview=1&period=month&at=\d{4}-\d{2}$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/e2e\/project-profit\?preview=1$/);
});

test("next month's card opens the next-month page, and the project page's links open its profit pages", async ({ page }) => {
  await page.goto("/e2e/project-profit?preview=1");
  await page.getByRole("link", { name: /^צפי [^:]+: הכנסות צפויות/ }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/profit\/next\?preview=1$/);
  // FLOW-1044: the project page's chart and next-month card are gone; its link rows open those pages.
  await page.goto("/e2e/project-detail?preview=1");
  await expect(page.getByRole("link", { name: /^רווח מתחילת הפרויקט/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /^נכנס ויצא לפי חודש/ })).toHaveCount(0);
  await page.getByRole("link", { name: /^צפוי לחודש הבא/ }).click();
  await expect(page).toHaveURL(/\/projects\/p1\/profit\/next\?preview=1$/);
  await page.goto("/e2e/project-detail?preview=1");
  await page.getByRole("link", { name: /^רווח מתחילת הפרויקט/ }).click();
  await expect(page).toHaveURL(/\/projects\/p1\/profit\?preview=1&period=all$/);
});

test("the profit page's category row opens that category, and the project page's waiting line opens the project's queue", async ({ page }) => {
  await page.goto("/e2e/project-profit?preview=1");
  await page.getByRole("radio", { name: "לפי קטגוריה" }).click();
  // FLOW-1044: לפי קטגוריה is a הכנסות group and a הוצאות group of rows.
  await expect(page.getByRole("region", { name: "הכנסות" })).toBeVisible();
  await page.getByRole("region", { name: "הוצאות" }).getByRole("link", { name: /^תיקונים ותחזוקה/ }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/categories\/repairs/);
  await page.goto("/e2e/project-detail?preview=1");
  // FLOW-1044: the waiting items are the first attention card, with no hide button.
  const waiting = page.getByRole("link", { name: "2 פריטים ממתינים לאישור" });
  await expect(page.getByRole("listitem").filter({ has: waiting }).getByRole("button", { name: /^הסתרה/ })).toHaveCount(0);
  await waiting.click();
  await expect(page).toHaveURL(/project=p1/);
  await expect(page.getByRole("heading", { name: "לאישור" })).toBeVisible();
});
