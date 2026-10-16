import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });
// Each test opens its own page in preview mode, so the tests can run side by side and CI can
// split this file across e2e shards.
test.describe.configure({ mode: "parallel" });

const previewToast = "במצב תצוגה זה לא נשמר.";

async function toast(page: Page, message: string) {
  await expect(page.locator(".ui-toast").getByText(message)).toBeVisible();
}

async function cursorOf(locator: Locator) {
  return locator.evaluate((node) => getComputedStyle(node).cursor);
}

test("צפייה opens today's list, a row opens the transaction, and back returns", async ({ page }) => {
  await page.goto("/e2e/review-banner");
  await expect(page.getByRole("heading", { name: "לאישור" })).toBeVisible();
  await page.getByRole("link", { name: "לרשימה" }).click();
  await expect(page).toHaveURL(/\/review\/filed\?preview=1&sample=1$/);
  await expect(page.getByRole("heading", { name: "שויכו היום" })).toBeVisible();
  await page.getByRole("link", { name: /מנופים לדוגמה/ }).click();
  await expect(page).toHaveURL(/\/transactions\/t-filed\?preview=1$/);
  await expect(page.getByRole("button", { name: /^פרויקט / })).toBeVisible();
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page.getByRole("heading", { name: "שויכו היום" })).toBeVisible();
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page.getByRole("heading", { name: "לאישור" })).toBeVisible();
  await expect(page.getByRole("link", { name: "לרשימה" })).toBeVisible();
});

test("the banner close hides it for this visit", async ({ page }) => {
  await page.goto("/e2e/review-banner");
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page.getByRole("link", { name: "לרשימה" })).toHaveCount(0);
});

test("review approve, change, and skip give feedback", async ({ page }) => {
  await page.goto("/e2e/review-banner");
  await page.getByRole("button", { name: "אישור" }).click();
  await toast(page, previewToast);
  await page.getByRole("link", { name: "שינוי" }).click();
  await expect(page).toHaveURL(/\/review\/change/);
  await page.goto("/e2e/review-banner");
  await page.getByRole("button", { name: "דלג" }).click();
  await toast(page, previewToast);
});

test("undo on the approve toast brings the card back", async ({ page }) => {
  await page.goto("/e2e/review");
  await expect(page.getByText("1 מתוך 2")).toBeVisible();
  await page.getByRole("button", { name: "אישור" }).click();
  await expect(page.getByText("2 מתוך 2")).toBeVisible();
  await page.locator(".ui-toast button", { hasText: "ביטול" }).click();
  await expect(page.getByText("1 מתוך 2")).toBeVisible();
});

test("a near-miss on ביטול undoes the card instead of dismissing the toast", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/e2e/review");
  await expect(page.getByText("1 מתוך 2")).toBeVisible();
  await page.getByRole("button", { name: "אישור" }).click();
  await expect(page.getByText("2 מתוך 2")).toBeVisible();
  const action = page.locator(".ui-toast button", { hasText: "ביטול" });
  await expect(action).toBeVisible();
  const box = await action.boundingBox();
  expect(box).not.toBeNull();
  if (box == null) return;
  expect(box.height).toBeLessThan(44);
  const reach = (44 - box.height) / 2;
  expect(reach).toBeGreaterThan(4);
  const point = {
    x: box.x + box.width / 2,
    y: box.y - Math.min(8, reach - 1),
  };
  const hit = await page.evaluate(({ x, y }) => {
    const node = document.elementFromPoint(x, y);
    const button = node instanceof Element ? node.closest("button") : null;
    return button?.textContent ?? "";
  }, point);
  expect(hit).toContain("ביטול");
  await page.mouse.click(point.x, point.y);
  await expect(page.getByText("1 מתוך 2")).toBeVisible();
});

test("an empty review queue sends you home", async ({ page }) => {
  await page.goto("/review?preview=1");
  await page.getByRole("link", { name: "לדף הבית" }).click();
  await expect(page).toHaveURL(/\/\?preview=1$/);
});

test("tab bar has four tabs, and each opens its screen (FLOW-364)", async ({ page }) => {
  await page.goto("/?preview=1");
  const bar = page.getByRole("navigation", { name: "ניווט ראשי" });
  await expect(bar.getByRole("link")).toHaveCount(4);
  await page.getByRole("link", { name: "פרויקטים" }).click();
  await expect(page).toHaveURL(/\/projects\?preview=1$/);
  await bar.getByRole("link", { name: "הלוואות" }).click();
  await expect(page).toHaveURL(/\/settings\/loans\?preview=1$/);
  await bar.getByRole("link", { name: "קבועים" }).click();
  await expect(page).toHaveURL(/\/missing-bills\?preview=1$/);
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
  // FLOW-331: three quick actions, all enabled.
  for (const name of [/פרויקט חדש/, /הלוואה חדשה/, /חיבור בנק/]) {
    await expect(page.getByRole("button", { name })).toBeEnabled();
  }
  // FLOW-339: ✕ closes it; ביטול belongs to confirm sheets.
  await page.getByRole("dialog", { name: "הוספה" }).getByRole("button", { name: "סגירה" }).click();
  await expect(page.getByRole("dialog", { name: "הוספה" })).toHaveCount(0);
});

test("home connects, filters the period, and opens a project", async ({ page }) => {
  await page.goto("/?preview=1");
  await page.getByRole("link", { name: "חיבור Mercury" }).click();
  await expect(page).toHaveURL(/\/settings\/connections\?preview=1$/);

  await page.goto("/e2e/home?preview=1");
  // FLOW-355 (A): one period pill on the band; it opens the period sheet, and a row applies on tap.
  await expect(page.locator(".ui-band").getByRole("radiogroup", { name: "תקופה" })).toHaveCount(0);
  const label = page.locator(".ui-band").getByRole("button", { name: /בחירת תקופה$/ });
  const before = await label.textContent();
  await label.click();
  const periodSheet = page.getByRole("dialog", { name: "תקופה" });
  await expect(periodSheet).toBeVisible();
  await periodSheet.getByRole("radio", { name: "שנה" }).click();
  await expect(periodSheet).toHaveCount(0);
  await expect(label).not.toHaveText(before ?? "");
  // FLOW-358: the pill names the year, so the label is the word alone.
  await expect(page.locator(".ui-band .ui-band-label")).toHaveText(/^(רווח|הפסד|רווח והפסד)$/);

  await label.click();
  await page.getByRole("button", { name: "טווח מותאם" }).click();
  await expect(page.getByRole("dialog", { name: "תקופה" })).toHaveCount(0);
  const range = page.getByRole("dialog", { name: "טווח מותאם" });
  await expect(range).toBeVisible();
  const year = range.getByRole("button", { name: "מתחילת השנה" });
  await expect(year).toBeInViewport();
  await year.click();
  await expect(year).toHaveAttribute("aria-pressed", "true");
  const forward = range.getByRole("button", { name: "חודש הבא" });
  await expect(forward).toBeDisabled();
  expect(await cursorOf(forward)).toBe("not-allowed");
  await range.locator('button.ui-icon-btn[aria-label="חודש קודם"]').click();
  await expect(forward).toBeEnabled();
  const day = range.getByRole("group", { name: "טווח מותאם" }).getByRole("button").first();
  await day.click();
  await expect(day).toHaveAttribute("aria-selected", "true");
  const apply = range.getByRole("button", { name: /הצגת/ });
  await expect(apply).toBeInViewport();
  await apply.click();
  await expect(range).toHaveCount(0);

  await page.getByRole("link", { name: /פריטים ממתינים/ }).click();
  await expect(page).toHaveURL(/\/review\?preview=1$/);
  await page.goto("/e2e/home?preview=1");
  await page.getByRole("link", { name: "שיפוץ הרצל 12" }).click();
  await expect(page).toHaveURL(/\/projects\/p1\?preview=1$/);
  await page.goto("/e2e/home?preview=1");
  await page.getByRole("link", { name: "לכל הפרויקטים" }).click();
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

async function stableBox(shell: Locator) {
  const viewport = shell.page().viewportSize();
  const limit = viewport?.height ?? 800;
  let previous = "";
  let box = await shell.boundingBox();
  for (let i = 0; i < 20; i += 1) {
    await shell.page().waitForTimeout(50);
    const next = await shell.boundingBox();
    const key = next ? `${next.x.toFixed(1)}:${next.y.toFixed(1)}:${next.height.toFixed(1)}` : "";
    if (next != null && key === previous && next.y >= 0 && next.y + next.height <= limit + 1) return next;
    previous = key;
    box = next;
  }
  if (!box) throw new Error("field box missing");
  return box;
}

async function focusAt(page: Page, shell: Locator, input: Locator, xRatio: number) {
  await input.scrollIntoViewIfNeeded();
  await input.evaluate((node) => {
    (node as HTMLInputElement).blur();
  });
  const box = await stableBox(shell);
  const x = box.x + Math.min(box.width - 2, Math.max(2, box.width * xRatio));
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  await expect(input).toBeFocused();
}

test("amount and text fields focus on either edge and do not clip", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  // FLOW-331: פרויקט חדש lives on +, which lands here with ?new=project.
  await page.goto("/e2e/projects?preview=1&new=project");
  const dialog = page.getByRole("dialog", { name: "פרויקט חדש" });
  await expect(dialog).toBeVisible();
  const name = dialog.getByRole("textbox", { name: "שם הפרויקט" });
  await expect(name).toBeInViewport();
  await focusAt(page, name, name, 0.02);
  await focusAt(page, name, name, 0.5);
  await focusAt(page, name, name, 0.98);
  await expect(name).toHaveAttribute("autocomplete", "off");
  expect(await name.getAttribute("name")).toMatch(/^flow-text-/);

  const amount = dialog.getByRole("textbox", { name: "תקציב (אופציונלי)" });
  const amountBox = dialog.locator(".ui-money-field");
  await focusAt(page, amountBox, amount, 0.02);
  await focusAt(page, amountBox, amount, 0.5);
  await focusAt(page, amountBox, amount, 0.98);
  await amount.fill("9999999.99");
  await expect(amount).toHaveValue("9,999,999.99");
  await expect(amount).toHaveAttribute("inputmode", "decimal");
  await expect(amount).toHaveAttribute("autocomplete", "off");
  expect(await amount.getAttribute("name")).toMatch(/^flow-amount-/);
  const fit = await amount.evaluate((node) => {
    const field = node as HTMLInputElement;
    const font = Number.parseFloat(getComputedStyle(field).fontSize);
    return { fits: field.scrollWidth <= field.clientWidth, font };
  });
  expect(fit.font).toBeGreaterThanOrEqual(16);
  expect(fit.fits).toBe(true);
  const prefixInside = await amountBox.evaluate((node) => {
    const shell = node.getBoundingClientRect();
    const prefix = node.querySelector(".ui-money-prefix")?.getBoundingClientRect();
    if (!prefix) return false;
    return prefix.left >= shell.left - 1 && prefix.right <= shell.right + 1;
  });
  expect(prefixInside).toBe(true);

  await page.goto("/e2e/split");
  await page.getByRole("button", { name: "הוספת חלק" }).click();
  await page.getByRole("dialog", { name: "בחירת פרויקט" }).getByRole("radio", { name: "פרגולה בית כהן" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "שמירה", exact: true }).click();
  await page.getByRole("radiogroup", { name: "יחידה, פרגולה בית כהן" }).getByRole("radio", { name: "%" }).click();
  const share = page.locator("input[id^='psplit-pct-']").first();
  const shareBox = share.locator("xpath=ancestor::*[contains(@class,'ui-percent-control')]");
  await focusAt(page, shareBox, share, 0.02);
  await focusAt(page, shareBox, share, 0.5);
  await focusAt(page, shareBox, share, 0.98);
  await share.fill("100");
  const shareFit = await share.evaluate((node) => (node as HTMLInputElement).scrollWidth <= (node as HTMLInputElement).clientWidth);
  expect(shareFit).toBe(true);
});

test("projects list, finished projects, and the new-project sheet", async ({ page }) => {
  await page.goto("/e2e/projects?preview=1");
  // FLOW-445: the list has no search field; its top row links to search.
  await expect(page.getByRole("searchbox", { name: "חיפוש פרויקט" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^שיפוץ הרצל 12/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^פרויקט ישן/ })).toHaveCount(0);
  await page.getByRole("button", { name: /הסתיימו/ }).click();
  await expect(page.getByRole("link", { name: /^פרויקט ישן/ })).toContainText("הסתיים");
  await page.getByRole("link", { name: /^וילה רעננה/ }).click();
  await expect(page).toHaveURL(/\/projects\/p2/);
  await page.goto("/e2e/projects?preview=1&new=project");
  const dialog = page.getByRole("dialog", { name: "פרויקט חדש" });
  await expect(dialog).toBeVisible();
  const create = dialog.getByRole("button", { name: "יצירת פרויקט" });
  await expect(create).toBeDisabled();
  await dialog.getByRole("textbox", { name: "שם הפרויקט" }).fill("גג חדש");
  await expect(create).toBeEnabled();
  await create.click();
  await toast(page, previewToast);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "פרויקט חדש" })).toHaveCount(0);
});

test("a project opens its menu, categories, and a transaction", async ({ page }) => {
  await page.goto("/projects/herzl?preview=loading");
  await page.getByRole("button", { name: "עוד" }).click();
  await expect(page.getByRole("dialog", { name: "עוד" })).toBeVisible();
  await expect(page.getByText("הפרויקט עדיין נטען.")).toBeVisible();

  await page.goto("/e2e/project-detail?preview=1");
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/projects/);
  await page.goto("/e2e/project-detail?preview=1");
  await page.getByRole("button", { name: "עוד" }).click();
  await page.getByRole("button", { name: /^סיום הפרויקט/ }).click();
  // FLOW-334: either way can be undone, so the confirm repeats the action and is not red.
  const finish = page.getByRole("dialog", { name: /^לסיים את/ });
  await expect(finish).toBeVisible();
  await finish.getByRole("button", { name: "סיום הפרויקט" }).click();
  await toast(page, previewToast);
  await page.getByRole("button", { name: "ביטול" }).click();
  await expect(page.getByRole("dialog", { name: /^לסיים את/ })).toHaveCount(0);
  // FLOW-340 C: the overhead switch lives in the ⋯ menu.
  await page.getByRole("button", { name: "עוד" }).click();
  const overhead = page.getByRole("dialog", { name: "עוד" }).getByRole("switch", { name: "רווח אחרי הוצאות כלליות" });
  await overhead.click();
  await expect(overhead).toBeChecked();
  // FLOW-411: the lines show on open, with no extra tap and no jump to Settings (FLOW-340 C: on the expenses screen).
  await page.goto("/e2e/project-detail?preview=1&section=expenses");
  await expect(page.getByRole("link", { name: "כל הקטגוריות" })).toHaveCount(0);
  await page.goto("/e2e/project-detail?preview=1&section=transactions");
  await page.getByRole("link", { name: /^מלט/ }).click();
  await expect(page).toHaveURL(/\/transactions\/t1/);

  // FLOW-331: + → פרויקט חדש opens the project sheet on Projects; Back does not reopen +.
  await page.goto("/add?preview=1");
  await page.getByRole("button", { name: /פרויקט חדש/ }).click();
  await expect(page.getByRole("dialog", { name: "פרויקט חדש" })).toBeVisible();
  await expect(page).toHaveURL(/\/projects\?preview=1$/);
});

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

test("a project's by-month list opens a month, and Back steps back one screen at a time", async ({ page }) => {
  // FLOW-419: the by-month row lives on the profit page, one tap in from the project's cash.
  await page.goto("/e2e/project-detail?preview=1&section=profit");
  await page.getByRole("link", { name: /לפי חודש/ }).click();
  await expect(page).toHaveURL(/\/projects\/p1\/months\?preview=1&period=months3&at=\d{4}-\d{2}$/);
  await page.getByRole("button", { name: /^חזרה/ }).first().click();
  await expect(page).toHaveURL(/\/e2e\/project-detail\?preview=1&section=profit$/);
  await page.goto("/e2e/project-months?preview=1");
  await expect(page.getByRole("heading", { name: "לפי חודש" })).toBeVisible();
  await page.getByRole("link", { name: /^ספטמבר, הפסד/ }).click();
  await expect(page).toHaveURL(/\/projects\/p1\/profit\/2026-09\?preview=1&period=month&at=2026-09$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/e2e\/project-months\?preview=1$/);
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

test("the AI page selects a scope, and a preview does not mint", async ({ page }) => {
  await page.goto("/e2e/connections/ai?preview=1");
  const readOnly = page.getByRole("radio", { name: "קריאה בלבד", exact: true });
  await readOnly.click();
  await expect(readOnly).toBeChecked();
  await page.getByRole("button", { name: "יצירת קוד", exact: true }).click();
  await toast(page, previewToast);
  await expect(page.getByRole("textbox", { name: "פקודת חיבור" })).toHaveCount(0);

  await page.goto("/e2e/connections/ai");
  await page.getByRole("radio", { name: "קריאה בלבד", exact: true }).click();
  await page.getByRole("button", { name: "יצירת קוד", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "פקודת חיבור" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/connections/ai?assistant=connected&preview=1");
  await expect(page.locator(".ui-ai-status")).toContainText("מחובר");
  await expect(page.locator(".ui-ai-status")).toContainText("קריאה וכתיבה");
  const stamp = page.getByText("שימוש אחרון", { exact: true });
  await expect(stamp).toBeVisible();
  const stampLines = await stamp.evaluate((node) => node.parentElement?.getClientRects().length ?? 0);
  expect(stampLines).toBe(1);
  await page.getByRole("button", { name: "ניתוק", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "לנתק את העוזר?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "ניתוק" }).click();
  await expect(confirm).toBeHidden();
  await toast(page, previewToast);

  await page.goto("/e2e/connections/ai?assistant=loading&preview=1");
  await expect(page.getByText("מחובר", { exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/e2e/connections/ai?preview=1");
  await expect(page.getByRole("radio", { name: "קריאה בלבד", exact: true })).toBeVisible();
  const clipped = await page.evaluate(() => {
    const view = document.documentElement;
    return view.scrollWidth - view.clientWidth;
  });
  expect(clipped).toBeLessThanOrEqual(1);
});
test("settings connect, refresh, categories, and the account row", async ({ page }) => {
  await page.goto("/settings/connections/sumit?preview=1");
  // Empty fields are now checked in place (FLOW-508, #185), so fill them to reach the preview toast.
  await page.getByLabel("מספר חברה").fill("123456");
  await page.getByLabel("מפתח API").fill("preview-key");
  await page.getByRole("button", { name: "חיבור", exact: true }).click();
  await toast(page, previewToast);
  await page.goto("/e2e/business?preview=1");
  await page.getByRole("button", { name: "שם העסק: בדיקה" }).click();
  const rename = page.getByRole("dialog", { name: "שם העסק" });
  await expect(rename.getByLabel("שם")).toHaveValue("בדיקה");
  await rename.getByLabel("שם").fill("בדיקה חדשה");
  await rename.getByRole("button", { name: "שמירה" }).click();
  await toast(page, previewToast);
  await rename.getByRole("button", { name: "סגירה" }).click();
  await expect(page.getByRole("button", { name: "שם העסק: בדיקה" })).toBeFocused();
  await page.goto("/e2e/settings?preview=1");
  await expect(page.getByText("owner@example.com")).toBeVisible();
  await expect(page.getByText("עוסק מורשה")).toHaveCount(0);
  await expect(page.getByText("Flow 0.1")).toBeVisible();
  await page.getByRole("link", { name: "קטגוריות" }).click();
  await expect(page).toHaveURL(/\/settings\/categories/);
  await page.goto("/e2e/settings?preview=1");
  // The fixture draws the tab bar (FLOW-334): its פרויקטים tab is the only such link.
  await expect(page.getByRole("link", { name: "פרויקטים" })).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "ניווט ראשי" }).getByRole("link", { name: "פרויקטים" })).toHaveCount(1);
  for (const name of ["סיכום שבועי", "תזכורת לפריטים ממתינים", "אישור אוטומטי בביטחון גבוה"]) {
    await expect(page.getByRole("switch", { name })).toHaveCount(0);
  }
  // The overhead switch is on the העסק page now, not the Settings menu.
  await page.goto("/e2e/business?preview=1");
  const overhead = page.getByRole("switch", { name: "רווח אחרי הוצאות כלליות" });
  await overhead.click();
  await expect(overhead).toBeChecked();
  await page.goto("/e2e/settings?preview=1");
  await expect(page.getByRole("button", { name: "התנתקות" })).toHaveCount(0);
  await page.getByRole("link", { name: "התקנה למסך הבית" }).click();
  await expect(page).toHaveURL(/\/install/);

  await page.goto("/e2e/connections/sumit?preview=1");
  await page.getByRole("button", { name: "רענון עכשיו" }).click();
  await toast(page, previewToast);
  await page.getByRole("button", { name: "ניתוק" }).click();
  await page.getByRole("dialog", { name: "לנתק את SUMIT?" }).getByRole("button", { name: "ניתוק" }).click();
  await toast(page, previewToast);

  await page.goto("/e2e/settings?preview=1&nocompany=1");
  await expect(page.getByText("owner@example.com")).toBeVisible();
  await expect(page.getByText("עדיין בלי עסק")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "owner@example.com" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "תצוגה" })).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "רווח אחרי הוצאות כלליות" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "הלוואות" }).filter({ hasNot: page.locator(".ui-tab-label") })).toHaveCount(0);
  await page.goto("/e2e/connections?preview=1&nocompany=1");
  // With no company the connection rows say so, and the helpers section (the AI row) is not shown.
  await expect(page.getByRole("link", { name: /^SUMIT/ })).toContainText("אין עסק עדיין");
  await expect(page.getByRole("link", { name: /^חיבור ל־AI/ })).toHaveCount(0);
  await page.goto("/e2e/settings?preview=1&nocompany=1&email=none");
  await expect(page.getByText("owner@example.com")).toHaveCount(0);
  await expect(page.getByText("עדיין בלי עסק")).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/e2e/settings?preview=1&nocompany=1&email=long");
  const longEmail = "owner.with.a.very.long.mailbox.name@example.com";
  // The address is the page subtitle now: a long one must not push the page sideways at 320.
  await expect(page.getByText(longEmail, { exact: false })).toBeVisible();
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sideways).toBeLessThanOrEqual(1);

  await page.goto("/e2e/connections?preview=1&connected=auth");
  const reconnect = page.getByRole("link", { name: /^SUMIT/ });
  await expect(reconnect).toContainText("צריך חיבור");
  await page.goto("/e2e/connections/sumit?preview=1&state=problem");
  await expect(page.locator(".ui-connection-problem")).toBeVisible();
  await expect(page.getByRole("button", { name: "חיבור מחדש" })).toBeVisible();
});

test("categories filter, hide, merge, and create", async ({ page }) => {
  await page.goto("/e2e/categories?preview=1");
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/settings/);
  await page.goto("/e2e/categories?preview=1");
  await page.getByRole("radio", { name: "הכנסות" }).click();
  await expect(page.getByText("עבודה")).toBeVisible();
  await expect(page.getByText("חומרים")).toHaveCount(0);
  await page.getByRole("radio", { name: "הוצאות" }).click();
  await page.getByRole("button", { name: /מוסתרות/ }).click();
  await expect(page.getByText("ישנה")).toBeVisible();
  await page.getByRole("button", { name: "עוד, חומרים" }).click();
  await page.getByRole("button", { name: "הסתרה" }).click();
  await page.getByRole("button", { name: "הסתרה" }).last().click();
  await toast(page, previewToast);
  await page.getByRole("button", { name: "ביטול" }).click();
  await page.getByRole("button", { name: "עוד, ישנה" }).click();
  await page.getByRole("button", { name: "החזרה לרשימה" }).click();
  await expect(page.getByRole("dialog", { name: "להחזיר את הקטגוריה לרשימה?" })).toBeVisible();
  await page.getByRole("button", { name: "ביטול" }).click();
  await page.getByRole("button", { name: "עוד, חומרים" }).click();
  await page.getByRole("button", { name: "העברה לקטגוריה אחרת" }).click();
  await expect(page.getByRole("switch", { name: "להסתיר את חומרים" })).toBeVisible();
  await page.getByRole("button", { name: "סגירה" }).click();
  await page.getByRole("button", { name: "קטגוריה חדשה" }).click();
  await page.getByRole("button", { name: "שמירה" }).click();
  await toast(page, previewToast);
});

test("a category save with no client reports the failure without a retry", async ({ page }) => {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    // The app, and the local Supabase API when CI points the suite at it.
    // Anything else, including the hosted project, is aborted.
    if (url.includes("43123") || url.includes("127.0.0.1:54321") || url.includes("localhost:54321")) {
      return route.continue();
    }
    return route.abort();
  });
  await page.goto("/e2e/categories");
  await page.getByRole("button", { name: "קטגוריה חדשה" }).click();
  await page.getByRole("button", { name: "שמירה" }).click();
  const note = page.locator(".ui-toast");
  await expect(note.getByText("לא הצלחנו ליצור את הקטגוריה.")).toBeVisible();
  await expect(note.locator("button", { hasText: "ניסיון חוזר" })).toHaveCount(0);
});

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

function overlaps(left: { x: number; y: number; width: number; height: number }, right: { x: number; y: number; width: number; height: number }): boolean {
  return left.y < right.y + right.height && left.y + left.height > right.y
    && left.x < right.x + right.width && left.x + left.width > right.x;
}

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

test("a preview toast stays clear of שמירה in the new-category sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/e2e/categories?preview=1");
  await page.getByRole("button", { name: "קטגוריה חדשה" }).click();
  const save = page.getByRole("button", { name: "שמירה" });
  await expect(save).toBeVisible();
  await save.click();
  const note = page.locator(".ui-toast");
  await expect(note).toBeVisible();
  await expect.poll(async () => {
    const toast = await note.boundingBox();
    const button = await save.boundingBox();
    if (!toast || !button) return true;
    return overlaps(toast, button);
  }).toBe(false);
});

test("the project page lists one row per section and each opens its screen (FLOW-340 C)", async ({ page }) => {
  // FLOW-419: these rows moved to the profit page.
  await page.goto("/e2e/project-detail?preview=1&section=profit");
  // FLOW-438: the lines are listed under the rows, so there is no תנועות row.
  for (const name of ["הכנסות", "הוצאות", "לפי חודש"]) {
    await expect(page.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "תנועות" })).toBeVisible();
  await page.getByRole("link", { name: /^הוצאות/ }).click();
  await expect(page).toHaveURL(/section=expenses/);
  await expect(page.getByRole("heading", { name: "הוצאות" })).toBeVisible();
  await page.getByRole("button", { name: /^חזרה/ }).first().click();
  await expect(page).toHaveURL(/\/e2e\/project-detail\?preview=1&section=profit$/);
  await page.getByRole("link", { name: /^הכנסות/ }).click();
  await expect(page).toHaveURL(/\/search\?.*dir=income/);
});

test("a category row opens its transactions and the waiting line opens that project's queue", async ({ page }) => {
  await page.goto("/e2e/project-detail?preview=1&section=expenses");
  await page.getByRole("link", { name: /^חומרים/ }).click();
  await expect(page.getByRole("heading", { name: "חומרים" })).toBeVisible();
  await expect(page.getByText("מלט")).toBeVisible();
  await page.goto("/e2e/project-detail?preview=1&section=expenses");
  await page.getByRole("link", { name: /ממתינה לאישור/ }).click();
  await expect(page).toHaveURL(/project=p1/);
  await expect(page.getByRole("heading", { name: "לאישור" })).toBeVisible();
});

test("a toast dismisses on tap", async ({ page }) => {
  await page.goto("/onboarding?preview=1");
  await page.getByRole("textbox", { name: "שם העסק" }).fill("בדיקה");
  await page.getByRole("button", { name: "המשך" }).click();
  const note = page.locator(".ui-toast");
  await expect(note).toBeVisible();
  await note.click();
  await expect(note).toHaveCount(0);
});

test("split parts, units, the hold, and close", async ({ page }) => {
  await page.goto("/e2e/split");
  await expect(page.getByRole("button", { name: "שמירה" })).toHaveCount(0);
  await expect(page.getByText("נשאר לשורה")).toBeVisible();
  await page.getByRole("button", { name: "הוספת חלק" }).click();
  await page.getByRole("dialog", { name: "בחירת פרויקט" }).getByRole("radio", { name: "שיפוץ דירה ביאליק 8 חולון" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "שמירה", exact: true }).click();
  await page.getByRole("radiogroup", { name: "יחידה, שיפוץ דירה ביאליק 8 חולון" }).getByRole("radio", { name: "%" }).click();
  const field = page.getByRole("textbox", { name: "אחוז, שיפוץ דירה ביאליק 8 חולון" });
  await field.fill("120");
  await expect(page.getByText("עד 100%")).toBeVisible();
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page).toHaveURL(/\/e2e\/split$/);
  await expect(page.getByRole("button", { name: "ביטול השינוי" })).toBeVisible();
  await field.fill("40");
  await page.getByRole("button", { name: /^הסרת החלק/ }).click();
  await expect(page.getByRole("textbox", { name: "אחוז, שיפוץ דירה ביאליק 8 חולון" })).toHaveCount(0);
  await page.getByRole("button", { name: "הוספת חלק" }).click();
  await page.getByRole("dialog", { name: "בחירת פרויקט" }).getByRole("radio", { name: "פרגולה בית כהן" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "שמירה", exact: true }).click();
  await page.getByRole("textbox", { name: "אחוז, פרגולה בית כהן" }).fill("50");
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page.locator("#e2e-split-saved")).not.toHaveText("");
  await expect(page).toHaveURL(/\/transactions\//);
});

test("settings opens the Connections page, and Back returns to the row (FLOW-501)", async ({ page }) => {
  await page.goto("/settings?preview=1");
  const connections = page.getByRole("link", { name: /^חיבורים/ });
  await expect(connections).toBeVisible();
  await connections.click();
  await expect(page).toHaveURL(/\/settings\/connections\?preview=1$/);
  await expect(page.getByRole("heading", { name: "חיבורים" })).toBeVisible();
  // Settings has no tab (FLOW-364): no tab is current.
  await expect(page.locator(".ui-tabbar [aria-current=page]")).toHaveCount(0);
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/settings\?preview=1$/);
  await expect(connections).toBeFocused();
  // The Settings menu has no הלוואות row (FLOW-512): the loans page is the tab bar's tab.
  await page.locator(".ui-tabbar").getByRole("link", { name: "הלוואות" }).click();
  await expect(page).toHaveURL(/\/settings\/loans\?preview=1$/);
  await expect(page.getByText("משכנתא אלון")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/settings\?preview=1$/);

  await page.goto("/settings?preview=1&sheet=sumit");
  await expect(page).toHaveURL(/\/settings\/connections\/sumit\?preview=1/);
  await expect(page.getByRole("heading", { name: "SUMIT", exact: true })).toBeVisible();
});