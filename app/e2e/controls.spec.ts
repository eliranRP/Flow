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
  await page.getByRole("link", { name: /מנופי המרכז/ }).click();
  await expect(page).toHaveURL(/\/transactions\/t-filed\?preview=1$/);
  await expect(page.getByRole("heading", { name: "הוצאה" })).toBeVisible();
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

test("tab bar opens each section and the add sheet", async ({ page }) => {
  await page.goto("/?preview=1");
  await page.getByRole("link", { name: "פרויקטים" }).click();
  await expect(page).toHaveURL(/\/projects\?preview=1$/);
  await page.getByRole("link", { name: "לאישור" }).click();
  await expect(page).toHaveURL(/\/review\?preview=1$/);
  await page.getByRole("link", { name: "הגדרות" }).click();
  await expect(page).toHaveURL(/\/settings\?preview=1$/);
  await page.getByRole("link", { name: "בית", exact: true }).click();
  await expect(page).toHaveURL(/\/\?preview=1$/);
  await page.getByRole("link", { name: "הוספה" }).click();
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
  // The sheet covers the tab bar, so a coordinate click hits the panel. The button still owns the close.
  await page.locator("button.ui-tab-slot-fab").evaluate((node: HTMLButtonElement) => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await expect(addSheet).toHaveCount(0);
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
  await page.getByRole("link", { name: "חיבור בנק או SUMIT" }).click();
  await expect(page).toHaveURL(/\/settings\/connections\?preview=1$/);

  await page.goto("/e2e/home?preview=1");
  // The period bar (decision 0141): a preset is one tap, the arrows step by its length.
  const presets = page.locator(".ui-band").getByRole("radiogroup", { name: "תקופה" });
  await presets.getByRole("radio", { name: "חודש", exact: true }).click();
  await expect(presets.getByRole("radio", { name: "חודש", exact: true })).toHaveAttribute("aria-checked", "true");
  const earlier = page.locator(".ui-pbar-arrow").first();
  const later = page.locator(".ui-pbar-arrow").nth(1);
  await expect(later).toHaveAttribute("aria-disabled", "true");
  expect(await cursorOf(later)).toBe("not-allowed");
  const label = page.getByRole("button", { name: /בחירת תקופה$/ });
  const before = await label.textContent();
  await earlier.click();
  await expect(later).not.toHaveAttribute("aria-disabled", "true");
  await expect(label).not.toHaveText(before ?? "");
  await later.click();
  await expect(later).toHaveAttribute("aria-disabled", "true");
  await expect(label).toHaveText(before ?? "");

  await label.click();
  const periodSheet = page.getByRole("dialog", { name: "תקופה" });
  await expect(periodSheet).toBeVisible();
  await periodSheet.getByRole("radio", { name: "שנה" }).click();
  await expect(periodSheet).toHaveCount(0);
  await expect(presets.getByRole("radio", { name: "שנה" })).toHaveAttribute("aria-checked", "true");

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
  await range.locator("button.ui-icon-btn", { hasText: "›" }).click();
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
  await page.getByRole("button", { name: "ניסיון חוזר" }).click();
  await expect(page).toHaveURL(/\/\?preview=1$/);
  await expect(page.getByRole("heading", { name: "כאן יופיע הרווח הנקי של העסק" })).toBeVisible();
  await page.goto("/unpaid?preview=error");
  await page.getByRole("button", { name: "ניסיון חוזר" }).click();
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
  await page.goto("/e2e/projects?preview=1");
  const search = page.getByRole("searchbox", { name: "חיפוש פרויקט" });
  const searchBox = page.locator(".ui-search");
  await focusAt(page, searchBox, search, 0.02);
  await focusAt(page, searchBox, search, 0.5);
  await focusAt(page, searchBox, search, 0.98);

  // FLOW-331: פרויקט חדש lives on +, which lands here with ?new=project.
  await page.goto("/e2e/projects?preview=1&new=project");
  const dialog = page.getByRole("dialog", { name: "פרויקט" });
  await expect(dialog).toBeVisible();
  const name = dialog.getByRole("textbox", { name: "שם" });
  await expect(name).toBeInViewport();
  await focusAt(page, name, name, 0.02);
  await focusAt(page, name, name, 0.5);
  await focusAt(page, name, name, 0.98);
  await expect(name).toHaveAttribute("autocomplete", "off");
  expect(await name.getAttribute("name")).toMatch(/^flow-text-/);

  const amount = dialog.getByRole("textbox", { name: "תקציב בשקלים, או ריק" });
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
  await page.getByRole("button", { name: "פיצול ידני" }).click();
  const share = page.locator("input[name^='split-pct-']").first();
  const shareBox = share.locator("xpath=ancestor::*[contains(@class,'ui-percent-control')]");
  await focusAt(page, shareBox, share, 0.02);
  await focusAt(page, shareBox, share, 0.5);
  await focusAt(page, shareBox, share, 0.98);
  await share.fill("100");
  const shareFit = await share.evaluate((node) => (node as HTMLInputElement).scrollWidth <= (node as HTMLInputElement).clientWidth);
  expect(shareFit).toBe(true);
});

test("projects search, expand, open, and the new-project sheet", async ({ page }) => {
  await page.goto("/e2e/projects?preview=1");
  await page.getByRole("searchbox", { name: "חיפוש פרויקט" }).fill("אין כזה");
  // FLOW-342: a miss offers the transaction search; the field's ✕ clears it.
  await expect(page.getByRole("link", { name: /^חיפוש בתנועות: אין כזה/ })).toBeVisible();
  await page.getByRole("button", { name: "ניקוי", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "חיפוש פרויקט" })).toHaveValue("");
  await expect(page.getByRole("link", { name: /^פרויקט ישן/ })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "חיפוש פרויקט" }).fill("ישן");
  await expect(page.getByRole("link", { name: /^פרויקט ישן/ })).toContainText("הסתיים");
  await page.getByRole("searchbox", { name: "חיפוש פרויקט" }).fill("");
  await page.getByRole("button", { name: /שהסתיים/ }).click();
  await expect(page.getByRole("link", { name: "פרויקט ישן" })).toBeVisible();
  await page.getByRole("link", { name: "וילה רעננה" }).click();
  await expect(page).toHaveURL(/\/projects\/p2/);
  await page.goto("/e2e/projects?preview=1&new=project");
  await expect(page.getByRole("dialog", { name: "פרויקט" })).toBeVisible();
  await page.getByRole("textbox", { name: "שם" }).fill("גג חדש");
  await page.getByRole("button", { name: "שמירה" }).click();
  await toast(page, previewToast);
  await page.getByRole("button", { name: "ביטול" }).click();
  await expect(page.getByRole("dialog", { name: "פרויקט" })).toHaveCount(0);
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
  await page.getByRole("button", { name: "סיום הפרויקט" }).click();
  // FLOW-334: either way can be undone, so the confirm repeats the action and is not red.
  const finish = page.getByRole("dialog", { name: "לסיים את הפרויקט?" });
  await expect(finish).toBeVisible();
  await finish.getByRole("button", { name: "סיום הפרויקט" }).click();
  await toast(page, previewToast);
  await page.getByRole("button", { name: "ביטול" }).click();
  await expect(page.getByRole("dialog", { name: "לסיים את הפרויקט?" })).toHaveCount(0);
  // FLOW-340 C: the overhead switch lives in the ⋯ menu.
  await page.getByRole("button", { name: "עוד" }).click();
  const overhead = page.getByRole("dialog", { name: "עוד" }).getByRole("switch", { name: "רווח אחרי כלליות" });
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
  await expect(page.getByRole("dialog", { name: "פרויקט" })).toBeVisible();
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
  await toast(page, "השיוך נשמר");
  await expect(page.getByRole("button", { name: /וילה רעננה/ })).toBeVisible();
  await page.getByRole("button", { name: /קטגוריה:/ }).click();
  await expect(page.getByRole("heading", { name: "בחירת קטגוריה" })).toBeVisible();
  await page.getByRole("radio", { name: "הובלה" }).click();
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

test("unpaid marks a row paid in one tap, keeps it listed, and clears the mark", async ({ page }) => {
  await page.goto("/e2e/unpaid?preview=1");
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/\?preview=1$/);
  await page.goto("/e2e/unpaid?preview=1");
  await expect(page.locator(".ui-unpaid-totals")).toHaveText("₪500");
  // FLOW-335: the total sits on the start (right) side, lined up with the title, not on the end side.
  const totalBox = await page.locator(".ui-unpaid-totals bdi").first().boundingBox();
  const titleBox = await page.getByRole("heading", { name: "חשבוניות שלא שולמו" }).boundingBox();
  expect(Math.abs((totalBox?.x ?? 0) + (totalBox?.width ?? 0) - ((titleBox?.x ?? 0) + (titleBox?.width ?? 0)))).toBeLessThan(4);
  await expect(page.getByRole("button", { name: /רענון מ־SUMIT/ })).toHaveCount(0);
  await page.getByRole("button", { name: "סימון כשולם" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await toast(page, "סומן כשולם. החשבונית תצא מהרשימה אחרי הסנכרון עם SUMIT.");
  await expect(page.getByText("לקוח לדוגמה")).toBeVisible();
  await expect(page.getByText(/סומן כשולם · ממתין לסנכרון/)).toBeVisible();
  // FLOW-335: a marked row brings the SUMIT sync onto the page.
  await expect(page.getByRole("button", { name: /רענון מ־SUMIT/ })).toBeVisible();
  await expect(page.locator(".ui-unpaid-totals")).toHaveText("₪0");
  await page.getByRole("button", { name: "ביטול הסימון" }).click();
  await expect(page.getByRole("button", { name: "סימון כשולם" })).toBeVisible();
  await expect(page.locator(".ui-unpaid-totals")).toHaveText("₪500");
});

test("a project's by-month list opens a month, and Back steps back one screen at a time", async ({ page }) => {
  await page.goto("/e2e/project-detail?preview=1");
  await page.getByRole("link", { name: /לפי חודש/ }).click();
  await expect(page).toHaveURL(/\/projects\/p1\/months\?preview=1&period=months3&at=\d{4}-\d{2}$/);
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/e2e\/project-detail\?preview=1$/);
  await page.goto("/e2e/project-months?preview=1");
  await expect(page.getByRole("heading", { name: "לפי חודש" })).toBeVisible();
  await page.getByRole("link", { name: /^ספטמבר, הפסד/ }).click();
  await expect(page).toHaveURL(/\/projects\/p1\?preview=1&period=month&at=2026-09$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/e2e\/project-months\?preview=1$/);
});

test("a transaction shows its VAT, changes, and confirms delete", async ({ page }) => {
  await page.goto("/e2e/txn?preview=1");
  await expect(page.getByRole("button", { name: "חשבונית ותשלום" })).toHaveCount(0);
  await expect(page.getByText(/^לפני מע״מ · מע״מ משוער ₪[\d,.]+ · \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();
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
  await toast(page, "השיוך נשמר");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /הובלה/ })).toBeVisible();
  await page.getByRole("link", { name: "פיצול בין פרויקטים" }).click();
  await expect(page).toHaveURL(/\/transactions\/t-manual\/split/);
});

test("the transaction change sheet opens split in place", async ({ page }) => {
  await page.goto("/e2e/txn?preview=1");
  await page.getByRole("button", { name: /פרויקט/ }).click();
  const sheet = page.getByRole("dialog", { name: "בחירת פרויקט" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "פיצול בין פרויקטים" }).click();
  await expect(page).toHaveURL(/\/transactions\/t-manual\/split\?preview=1$/);
  await expect(page.getByRole("heading", { name: "פיצול בין פרויקטים" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/e2e\/txn\?preview=1$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the assistant row selects a scope and does not mint in preview", async ({ page }) => {
  await page.goto("/e2e/connections?preview=1");
  await page.getByRole("button", { name: "עוזר AI", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "חיבור עוזר AI" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("radio", { name: "קריאה בלבד" }).click();
  await expect(sheet.getByRole("radio", { name: "קריאה בלבד" })).toBeChecked();
  await sheet.getByRole("button", { name: "יצירת קוד" }).click();
  await toast(page, previewToast);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/connections?preview=1&assistant=connected");
  const assistantRow = page.getByRole("button", { name: "עוזר AI", exact: true });
  await expect(assistantRow).toContainText("מחובר · קריאה וכתיבה");
  await expect(page.getByText("שימוש אחרון ב-30.9")).toHaveCount(0);
  await assistantRow.click();
  await expect(page.getByText("שימוש אחרון ב-30.9")).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  const stampLines = await page.getByText("שימוש אחרון ב-30.9").evaluate((node) => node.getClientRects().length);
  expect(stampLines).toBe(1);
  await page.getByRole("dialog", { name: "עוזר AI", exact: true }).getByRole("button", { name: "ניתוק" }).click();
  const confirm = page.getByRole("dialog", { name: "לנתק את העוזר?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "ניתוק" }).click();
  await expect(confirm).toBeHidden();
  await toast(page, previewToast);
  await page.goto("/e2e/connections?preview=1&assistant=loading");
  const loadingRow = page.locator(".ui-row", { hasText: "עוזר AI" });
  await expect(loadingRow).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("button", { name: "עוזר AI", exact: true })).toHaveCount(0);
  await expect(loadingRow).not.toContainText("מחובר");
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/e2e/connections?preview=1");
  await page.getByRole("button", { name: "עוזר AI", exact: true }).click();
  const narrow = page.getByRole("dialog", { name: "חיבור עוזר AI" });
  await expect(narrow).toBeVisible();
  const clipped = await page.evaluate(() => {
    const view = document.documentElement;
    return view.scrollWidth - view.clientWidth;
  });
  expect(clipped).toBeLessThanOrEqual(1);
});

test("settings connect, refresh, categories, and the account row", async ({ page }) => {
  await page.goto("/e2e/connections?preview=1");
  await page.getByRole("button", { name: "SUMIT" }).click();
  const sumitSheet = page.getByRole("dialog", { name: "חיבור SUMIT" });
  await expect(sumitSheet).toBeVisible();
  // Empty fields are now checked in place (FLOW-508, #185), so fill them to reach the preview toast.
  await sumitSheet.getByLabel("מספר חברה").fill("12345");
  await sumitSheet.getByLabel("מפתח API").fill("preview-key");
  await page.getByRole("button", { name: "חיבור" }).click();
  await toast(page, previewToast);
  await page.getByRole("button", { name: "סגירה" }).click();
  await page.goto("/e2e/settings?preview=1");
  await expect(page.getByText("owner@example.com")).toBeVisible();
  await page.getByRole("button", { name: "שם העסק: בדיקה" }).click();
  const rename = page.getByRole("dialog", { name: "שם העסק" });
  await expect(rename.getByLabel("שם")).toHaveValue("בדיקה");
  await rename.getByLabel("שם").fill("בדיקה חדשה");
  await rename.getByRole("button", { name: "שמירה" }).click();
  await toast(page, previewToast);
  await rename.getByRole("button", { name: "סגירה" }).click();
  await expect(page.getByRole("button", { name: "שם העסק: בדיקה" })).toBeFocused();
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
  const overhead = page.getByRole("switch", { name: "רווח אחרי כלליות" });
  await overhead.click();
  await expect(overhead).toBeChecked();
  await expect(page.getByRole("button", { name: "התנתקות" })).toHaveCount(0);
  await page.getByRole("link", { name: "התקנה למסך הבית" }).click();
  await expect(page).toHaveURL(/\/install/);

  await page.goto("/e2e/connections?preview=1&connected=1");
  await page.getByRole("button", { name: "SUMIT" }).click();
  const connectedSheet = page.getByRole("dialog", { name: "SUMIT", exact: true });
  await connectedSheet.getByRole("button", { name: "רענון עכשיו" }).click();
  await toast(page, previewToast);
  await connectedSheet.getByRole("button", { name: "ניתוק" }).click();
  await page.getByRole("dialog", { name: "לנתק את SUMIT?" }).getByRole("button", { name: "ניתוק" }).click();
  await toast(page, previewToast);

  await page.goto("/e2e/settings?preview=1&nocompany=1");
  await expect(page.getByText("owner@example.com")).toBeVisible();
  await expect(page.getByText("עדיין בלי עסק")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "owner@example.com" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "תצוגה" })).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "רווח אחרי כלליות" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "הלוואות" })).toHaveCount(0);
  await page.goto("/e2e/connections?preview=1&nocompany=1");
  const sumit = page.getByRole("button", { name: "SUMIT" });
  await expect(sumit).toBeEnabled();
  await expect(sumit).toContainText("לא מחובר");
  await expect(page.getByRole("button", { name: "עוזר AI", exact: true })).toBeDisabled();
  await page.goto("/e2e/settings?preview=1&nocompany=1&email=none");
  await expect(page.getByText("owner@example.com")).toHaveCount(0);
  await expect(page.getByText("עדיין בלי עסק")).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/e2e/settings?preview=1&nocompany=1&email=long");
  const longEmail = "owner.with.a.very.long.mailbox.name@example.com";
  const emailStart = await page.locator(".ui-row-title", { hasText: longEmail }).evaluate((node, email) => {
    const text = node.querySelector("bdi")?.firstChild;
    if (!text || text.textContent !== email) return false;
    const box = node.getBoundingClientRect();
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 1);
    const start = range.getBoundingClientRect();
    range.setStart(text, email.length - 1);
    range.setEnd(text, email.length);
    const end = range.getBoundingClientRect();
    const startInside = start.width > 0 && start.left >= box.left - 1 && start.right <= box.right + 1;
    const endClipped = end.right > box.right + 1 || node.scrollWidth > node.clientWidth + 1;
    return startInside && endClipped;
  }, longEmail);
  expect(emailStart).toBe(true);

  await page.goto("/e2e/connections?preview=1&connected=auth");
  const reconnect = page.getByRole("button", { name: "SUMIT" });
  await expect(reconnect).toContainText("צריך לחבר מחדש");
  await reconnect.click();
  const authSheet = page.getByRole("dialog", { name: "SUMIT", exact: true });
  await expect(authSheet).toBeVisible();
  await expect(authSheet.getByText("המזהה או המפתח לא התקבלו")).toBeVisible();
  await expect(authSheet.getByRole("button", { name: "חיבור מחדש" })).toBeVisible();
  await expect(authSheet.getByRole("button", { name: "ניתוק" })).toBeVisible();
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
  await expect(page.getByText("שיתוף ואז הוספה למסך הבית")).toBeVisible();
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
  await page.goto("/e2e/project-detail?preview=1");
  for (const name of ["הכנסות", "הוצאות", "תנועות", "לפי חודש"]) {
    await expect(page.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await page.getByRole("link", { name: /^הוצאות/ }).click();
  await expect(page).toHaveURL(/section=expenses/);
  await expect(page.getByRole("heading", { name: "הוצאות" })).toBeVisible();
  await page.getByRole("button", { name: /^חזרה/ }).first().click();
  await expect(page).toHaveURL(/\/e2e\/project-detail\?preview=1$/);
  await page.getByRole("link", { name: /^תנועות/ }).click();
  await expect(page).toHaveURL(/section=transactions/);
  await expect(page.getByRole("heading", { name: "תנועות" })).toBeVisible();
  await page.goto("/e2e/project-detail?preview=1");
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

test("split choices, manual percents, and close", async ({ page }) => {
  await page.goto("/e2e/split");
  await expect(page.getByRole("button", { name: "שמירה" })).toHaveCount(0);
  await expect(page.getByText("בחרו איך לפצל")).toBeVisible();
  await page.getByRole("radio", { name: "שווה בין כל הפרויקטים" }).click();
  await page.getByRole("button", { name: "הצגת הפירוט" }).click();
  await expect(page.getByRole("button", { name: "הסתרת הפירוט" })).toBeVisible();
  await page.getByRole("radio", { name: "לפי הכנסות" }).click();
  await expect(page.getByText(/לפי הכנסות · 3 פרויקטים/)).toBeVisible();
  await page.getByRole("radio", { name: "שווה בין פרויקטים שאבחר" }).click();
  await page.getByRole("button", { name: "שיפוץ הרצל 12" }).click();
  await expect(page.getByRole("button", { name: "שיפוץ הרצל 12" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "פיצול ידני" }).click();
  const field = page.getByRole("textbox", { name: "אחוז, שיפוץ הרצל 12" });
  await field.fill("120");
  await expect(page.getByText("עד 100%")).toBeVisible();
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page).toHaveURL(/\/e2e\/split$/);
  await expect(page.getByText("עד 100%")).toBeVisible();
  await page.getByRole("button", { name: "חזרה לאפשרויות" }).click();
  await expect(page.getByRole("radio", { name: "שווה בין כל הפרויקטים" })).toBeVisible();
  await page.getByRole("radio", { name: "שווה בין כל הפרויקטים" }).click();
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page.locator("#e2e-split-saved")).not.toHaveText("");
  await expect(page).toHaveURL(/\/e2e\/split$/);
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page).toHaveURL(/\/transactions\//);
});

test("settings opens the Connections and Loans pages, and Back returns to the row (FLOW-501)", async ({ page }) => {
  await page.goto("/settings?preview=1");
  const connections = page.getByRole("link", { name: "חיבורים" });
  await expect(connections).toBeVisible();
  await connections.click();
  await expect(page).toHaveURL(/\/settings\/connections\?preview=1$/);
  await expect(page.getByRole("heading", { name: "חיבורים" })).toBeVisible();
  await expect(page.getByRole("link", { name: "הגדרות" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/settings\?preview=1$/);
  await expect(connections).toBeFocused();
  const loans = page.getByRole("link", { name: "הלוואות" });
  await loans.click();
  await expect(page).toHaveURL(/\/settings\/loans\?preview=1$/);
  await expect(page.getByText("משכנתא אלון")).toBeVisible();
  await page.goBack();
  await expect(loans).toBeFocused();

  await page.goto("/settings?preview=1&sheet=sumit");
  await expect(page).toHaveURL(/\/settings\/connections\?preview=1/);
  await expect(page.getByRole("dialog", { name: "חיבור SUMIT" })).toBeVisible();
});
