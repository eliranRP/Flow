import { expect, test } from "@playwright/test";
import { previewToast, toast } from "./controls-helpers";

test.use({ viewport: { width: 390, height: 844 } });
// Preview-mode tests, one page per test (see controls-review.spec.ts).
test.describe.configure({ mode: "parallel" });

test("projects list, finished projects, and the new-project sheet", async ({ page }) => {
  await page.goto("/e2e/projects?preview=1");
  // FLOW-445: the list has no search field; its top row links to search.
  await expect(page.getByRole("searchbox", { name: "חיפוש פרויקט" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Lark Hill/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^פרויקט ישן/ })).toHaveCount(0);
  await page.getByRole("button", { name: /הסתיימו/ }).click();
  await expect(page.getByRole("link", { name: /^פרויקט ישן/ })).toContainText("הסתיים");
  await page.getByRole("link", { name: /^Lark Hill/ }).click();
  await expect(page).toHaveURL(/\/projects\/p2/);
  await page.goto("/e2e/projects?preview=1&new=project");
  const dialog = page.getByRole("dialog", { name: "פרויקט חדש" });
  await expect(dialog).toBeVisible();
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

test("a project opens its menu, finishes with no confirm, and keeps the overhead switch", async ({ page }) => {
  await page.goto("/projects/herzl?preview=loading");
  await page.getByRole("button", { name: "עוד" }).click();
  await expect(page.getByRole("dialog", { name: "עוד" })).toBeVisible();
  await expect(page.getByText("הפרויקט עדיין נטען.")).toBeVisible();

  await page.goto("/e2e/project-detail?preview=1");
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/projects/);
  await page.goto("/e2e/project-detail?preview=1");
  await page.getByRole("button", { name: "עוד" }).click();
  // FLOW-961 (decision 0213): finishing can be undone, so the row finishes at once; preview writes nothing.
  await page.getByRole("button", { name: /^סיום הפרויקט/ }).click();
  await toast(page, previewToast);
  await expect(page.getByRole("dialog", { name: /^לסיים את/ })).toHaveCount(0);
  // The menu is the board's three rows; the overhead switch lives in the edit sheet it opens.
  await page.getByRole("button", { name: "עוד" }).click();
  const menu = page.getByRole("dialog", { name: "שיפוץ הרצל 12" });
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

test("next month's card opens the next-month page, and the project page's chart link opens its profit page", async ({ page }) => {
  await page.goto("/e2e/project-profit?preview=1");
  await page.getByRole("link", { name: /^צפי [^:]+: הכנסות צפויות/ }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/profit\/next\?preview=1$/);
  await page.goto("/e2e/project-detail?preview=1");
  await expect(page.getByRole("img", { name: /^נכנס ויצא לפי חודש, מתחילת הפרויקט/ })).toBeVisible();
  await page.getByRole("link", { name: "רווח לפי חודש" }).click();
  await expect(page).toHaveURL(/\/projects\/p1\/profit\?preview=1&period=all$/);
});

test("the profit page's category row opens that category, and the project page's waiting line opens the project's queue", async ({ page }) => {
  await page.goto("/e2e/project-profit?preview=1");
  await page.getByRole("button", { name: "לפי קטגוריה" }).click();
  await page.getByRole("link", { name: /^תיקונים ותחזוקה/ }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/categories\/repairs/);
  await page.goto("/e2e/project-detail?preview=1");
  // FLOW-961: the waiting items are Home v2's filled review button.
  await page.getByRole("link", { name: /^לאישור 2 פריטים/ }).click();
  await expect(page).toHaveURL(/project=p1/);
  await expect(page.getByRole("heading", { name: "לאישור" })).toBeVisible();
});
