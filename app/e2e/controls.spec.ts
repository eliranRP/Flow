import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

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
  const capture = page.getByRole("button", { name: /צילום חשבונית/ });
  const manual = page.getByRole("button", { name: /הזנה ידנית/ });
  await expect(capture).toBeDisabled();
  await expect(manual).toBeDisabled();
  expect(await cursorOf(capture)).toBe("not-allowed");
  expect(await cursorOf(manual)).toBe("not-allowed");
  await page.getByRole("button", { name: "ביטול" }).click();
  await expect(page.getByRole("dialog", { name: "הוספה" })).toHaveCount(0);
});

test("home connects, filters the period, and opens a project", async ({ page }) => {
  await page.goto("/?preview=1");
  await page.getByRole("link", { name: "חיבור SUMIT" }).click();
  await expect(page).toHaveURL(/\/settings\?preview=1$/);

  await page.goto("/e2e/home?preview=1");
  await page.getByRole("button", { name: "החודש" }).click();
  await expect(page.getByRole("dialog", { name: "תקופה" })).toBeVisible();
  await page.getByRole("radio", { name: "חודש קודם" }).click();
  await expect(page.getByRole("dialog", { name: "תקופה" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "חודש קודם" })).toBeVisible();

  await page.getByRole("button", { name: "חודש קודם" }).click();
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

  await page.getByRole("button", { name: "פרויקט חדש" }).click();
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
  await page.getByRole("button", { name: "חלוקה ידנית" }).click();
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
  await page.getByRole("button", { name: "ניקוי החיפוש" }).click();
  await expect(page.getByRole("searchbox", { name: "חיפוש פרויקט" })).toHaveValue("");
  await page.getByRole("button", { name: /הסתיימו/ }).click();
  await expect(page.getByRole("link", { name: "פרויקט ישן" })).toBeVisible();
  await page.getByRole("link", { name: "וילה רעננה" }).click();
  await expect(page).toHaveURL(/\/projects\/p2/);
  await page.goto("/e2e/projects?preview=1");
  await page.getByRole("button", { name: "פרויקט חדש" }).click();
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
  await expect(page.getByRole("dialog", { name: "לסיים את הפרויקט?" })).toBeVisible();
  await page.getByRole("button", { name: "אישור" }).click();
  await toast(page, previewToast);
  await page.getByRole("button", { name: "ביטול" }).click();
  await expect(page.getByRole("dialog", { name: "לסיים את הפרויקט?" })).toHaveCount(0);
  const overhead = page.getByRole("switch", { name: "אחרי חלק בהוצאות כלליות" });
  await overhead.click();
  await expect(overhead).toBeChecked();
  await page.getByRole("link", { name: "כל הקטגוריות" }).click();
  await expect(page).toHaveURL(/\/settings\/categories/);
  await page.goto("/e2e/project-detail?preview=1");
  await page.getByRole("button", { name: "תנועות אחרונות" }).click();
  await page.getByRole("link", { name: "מלט" }).click();
  await expect(page).toHaveURL(/\/transactions\/t1/);

  await page.goto("/projects/missing?preview=1");
  await page.getByRole("link", { name: /צילום חשבונית/ }).click();
  await expect(page.getByRole("dialog", { name: "הוספה" })).toBeVisible();
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

test("unpaid explains the mark and then hides the row", async ({ page }) => {
  await page.goto("/e2e/unpaid?preview=1");
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/\?preview=1$/);
  await page.goto("/e2e/unpaid?preview=1");
  await page.getByRole("button", { name: "סימון כשולם" }).click();
  await expect(page.getByRole("dialog", { name: "סימון כשולם" })).toBeVisible();
  await page.getByRole("button", { name: "הבנתי" }).click();
  await expect(page.getByText("לקוח לדוגמה")).toHaveCount(0);
});

test("a transaction expands, changes, and confirms delete", async ({ page }) => {
  await page.goto("/e2e/txn?preview=1");
  await page.getByRole("button", { name: "חשבונית ותשלום" }).click();
  await expect(page.getByText("מע״מ משוער 18%")).toBeVisible();
  await page.getByRole("button", { name: "עוד" }).click();
  await page.getByRole("button", { name: "מחיקה" }).click();
  await expect(page.getByRole("dialog", { name: "למחוק את הרשומה?" })).toBeVisible();
  await page.getByRole("button", { name: "מחיקה" }).click();
  await toast(page, previewToast);
  await page.getByRole("button", { name: "ביטול" }).click();
  await page.getByRole("button", { name: /פרויקט/ }).click();
  await expect(page.getByRole("dialog", { name: "שינוי שיוך" })).toBeVisible();
  await page.getByRole("button", { name: /קטגוריה:/ }).click();
  await page.getByRole("radio", { name: "הובלה" }).click();
  await toast(page, "השיוך נשמר");
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page.getByRole("button", { name: /הובלה/ })).toBeVisible();
  await page.getByRole("link", { name: "פיצול בין פרויקטים" }).click();
  await expect(page).toHaveURL(/\/transactions\/t-manual\/split/);
});

test("the transaction change sheet opens split in place", async ({ page }) => {
  await page.goto("/e2e/txn?preview=1");
  await page.getByRole("button", { name: /פרויקט/ }).click();
  const sheet = page.getByRole("dialog", { name: "שינוי שיוך" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: /פרויקט:/ }).click();
  await expect(page.getByRole("heading", { name: "בחירת פרויקט" })).toBeVisible();
  await page.getByRole("button", { name: "פיצול בין פרויקטים" }).click();
  await expect(page).toHaveURL(/\/transactions\/t-manual\/split\?preview=1$/);
  await expect(page.getByRole("heading", { name: "חלוקה בין פרויקטים" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/e2e\/txn\?preview=1$/);
  await expect(page.getByRole("dialog", { name: "שינוי שיוך" })).toHaveCount(0);
});

test("the assistant row selects a scope and does not mint in preview", async ({ page }) => {
  await page.goto("/e2e/settings?preview=1");
  await page.getByRole("button", { name: "עוזר AI", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "חיבור עוזר AI" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("radio", { name: "קריאה בלבד" }).click();
  await expect(sheet.getByRole("radio", { name: "קריאה בלבד" })).toBeChecked();
  await sheet.getByRole("button", { name: "יצירת קוד" }).click();
  await toast(page, previewToast);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/settings?preview=1&assistant=connected");
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
  await page.goto("/e2e/settings?preview=1&assistant=loading");
  const loadingRow = page.locator(".ui-row", { hasText: "עוזר AI" });
  await expect(loadingRow).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("button", { name: "עוזר AI", exact: true })).toHaveCount(0);
  await expect(loadingRow).not.toContainText("מחובר");
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/e2e/settings?preview=1");
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
  await page.goto("/e2e/settings?preview=1");
  await page.getByRole("button", { name: "SUMIT" }).click();
  await expect(page.getByRole("dialog", { name: "חיבור SUMIT" })).toBeVisible();
  await page.getByRole("button", { name: "חיבור" }).click();
  await toast(page, previewToast);
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page.getByRole("group", { name: "בדיקה" })).toBeVisible();
  await expect(page.getByText("owner@example.com")).toBeVisible();
  await expect(page.getByText("עוסק מורשה")).toHaveCount(0);
  await expect(page.getByText("Flow 0.1")).toBeVisible();
  await page.getByRole("link", { name: "קטגוריות" }).click();
  await expect(page).toHaveURL(/\/settings\/categories/);
  await page.goto("/e2e/settings?preview=1");
  await expect(page.getByRole("link", { name: "פרויקטים" })).toHaveCount(0);
  for (const name of ["סיכום שבועי", "תזכורת לפריטים ממתינים", "אישור אוטומטי בביטחון גבוה"]) {
    await expect(page.getByRole("switch", { name })).toHaveCount(0);
  }
  const overhead = page.getByRole("switch", { name: "רווח אחרי כלליות" });
  await overhead.click();
  await expect(overhead).toBeChecked();
  await expect(page.getByRole("button", { name: "התנתקות" })).toHaveCount(0);
  await page.getByRole("link", { name: "התקנה למסך הבית" }).click();
  await expect(page).toHaveURL(/\/install/);

  await page.goto("/e2e/settings?preview=1&connected=1");
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

  await page.goto("/e2e/settings?preview=1&connected=auth");
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
  await page.getByRole("button", { name: "מיזוג" }).click();
  await expect(page.getByRole("dialog", { name: "מיזוג אל" })).toBeVisible();
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

test("install, notifications, onboarding, and legal screens", async ({ page }) => {
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
  await page.goto("/notifications?preview=1");
  await page.getByRole("button", { name: "חזרה" }).click();
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

test("a category row opens its transactions and the waiting line opens that project's queue", async ({ page }) => {
  await page.goto("/e2e/project-detail?preview=1");
  await page.getByRole("link", { name: /חומרים/ }).click();
  await expect(page.getByRole("heading", { name: "חומרים" })).toBeVisible();
  await expect(page.getByText("מלט")).toBeVisible();
  await page.goto("/e2e/project-detail?preview=1");
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
  await expect(page.getByText("בחרו איך לחלק")).toBeVisible();
  await page.getByRole("radio", { name: "שווה בין כל הפרויקטים" }).click();
  await page.getByRole("button", { name: "הצגת הפירוט" }).click();
  await expect(page.getByRole("button", { name: "הסתרת הפירוט" })).toBeVisible();
  await page.getByRole("radio", { name: "לפי הכנסות" }).click();
  await expect(page.getByText(/לפי הכנסות · 3 פרויקטים/)).toBeVisible();
  await page.getByRole("radio", { name: "שווה בין פרויקטים שאבחר" }).click();
  await page.getByRole("button", { name: "שיפוץ הרצל 12" }).click();
  await expect(page.getByRole("button", { name: "שיפוץ הרצל 12" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "חלוקה ידנית" }).click();
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

type Control = {
  index: number;
  name: string;
  href: string;
  current: string;
  checked: string;
  type: string;
  tag: string;
};

async function describeControls(page: Page): Promise<Control[]> {
  return page.locator("a[href], button, input, textarea").evaluateAll((nodes) => {
    return nodes.flatMap((node, index) => {
      const el = node as HTMLElement;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) return [];
      if (el.getAttribute("aria-hidden") === "true") return [];
      const input = el as HTMLInputElement;
      const disabled = input.disabled || el.getAttribute("aria-disabled") === "true";
      const rawType = (el as { type?: unknown }).type;
      const type = typeof rawType === "string" ? rawType : "";
      if (disabled || type === "hidden") return [];
      const name = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim();
      return [{
        index,
        name,
        href: el.getAttribute("href") ?? "",
        current: el.getAttribute("aria-current") ?? "",
        checked: el.getAttribute("aria-checked") ?? el.getAttribute("aria-pressed") ?? "",
        type,
        tag: el.tagName.toLowerCase(),
      }];
    });
  });
}

async function fingerprint(page: Page) {
  return page.evaluate(() => ({
    url: location.pathname + location.search,
    dialogs: document.querySelectorAll("[role='dialog']").length,
    toast: document.querySelector(".ui-toast")?.textContent ?? "",
    checked: [...document.querySelectorAll("[aria-checked],[aria-pressed],[aria-selected],input[type='checkbox'],input[type='radio']")].map((node) => {
      if (node instanceof HTMLInputElement && (node.type === "checkbox" || node.type === "radio")) return node.checked ? "1" : "0";
      return node.getAttribute("aria-checked") ?? node.getAttribute("aria-pressed") ?? node.getAttribute("aria-selected");
    }).join(","),
    expanded: [...document.querySelectorAll("[aria-expanded]")].map((node) => node.getAttribute("aria-expanded")).join(","),
    text: document.body.innerText,
  }));
}

function hitTarget(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const rect = el.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, Math.max(rect.height - 1, 0)));
  if (!hit) return false;
  const label = el.closest("label");
  return el === hit || el.contains(hit) || hit.contains(el) || (label != null && label === hit.closest("label"));
}

function sameUrl(href: string, current: string) {
  if (href === "" || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("http")) return false;
  const next = new URL(href, current);
  const here = new URL(current);
  return next.pathname === here.pathname && next.search === here.search;
}

const sweepPages = [
  "/?preview=1",
  "/projects?preview=1",
  "/review?preview=1",
  "/review/filed?preview=1",
  "/unpaid?preview=1",
  "/settings?preview=1",
  "/settings/categories?preview=1",
  "/onboarding?preview=1",
  "/install?preview=1",
  "/notifications?preview=1",
  "/sign-in",
  "/sign-in?error=server_error",
  "/help",
  "/terms",
  "/privacy",
  "/add?preview=1",
  "/projects/herzl?preview=1",
  "/transactions/1?preview=1",
  "/review/change?preview=1",
  "/?preview=error",
  "/e2e/review-banner",
  "/e2e/filed?preview=1",
  "/e2e/home?preview=1",
  "/e2e/projects?preview=1",
  "/e2e/settings?preview=1",
  "/e2e/settings?preview=1&connected=1",
  "/e2e/settings?preview=1&connected=auth",
  "/e2e/categories?preview=1",
  "/e2e/unpaid?preview=1",
  "/e2e/txn?preview=1",
  "/e2e/project-detail?preview=1",
  "/e2e/change?preview=1",
  "/e2e/split",
  "/e2e/review",
  "/e2e/install-android",
  "/e2e/install-other",
];

/** These routes open a sheet on load, so controls under the scrim are covered. */
const sheetOnLoad = new Set(["/add?preview=1", "/review/change?preview=1"]);

for (const url of sweepPages) {
  test(`no enabled control is a no-op on ${url}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(url);
    const found = await describeControls(page);
    const failures: string[] = [];
    let skipped = 0;
    for (const control of found) {
      if (control.name.includes("המשך עם Google")) continue;
      if (control.href.startsWith("mailto:") || control.href.startsWith("tel:") || control.href.startsWith("http")) continue;
      await page.goto(url);
      const target = page.locator("a[href], button, input, textarea").nth(control.index);
      const here = page.url();
      if (control.tag === "a" && sameUrl(control.href, here) && control.current !== "page") {
        failures.push(`${control.name || control.tag} links to the current page`);
        continue;
      }
      if (control.tag === "a" && control.current === "page" && sameUrl(control.href, here)) continue;
      if ((control.tag === "input" || control.tag === "textarea") && control.type !== "checkbox" && control.type !== "radio") {
        await target.click();
        const focused = await target.evaluate((node) => document.activeElement === node);
        if (!focused) failures.push(`${control.name || "field"} did not focus`);
        continue;
      }
      if (control.checked === "true") continue;
      await target.scrollIntoViewIfNeeded();
      let reachable = await target.evaluate(hitTarget);
      if (!reachable) {
        await target.evaluate((el) => {
          el.scrollIntoView({ block: "center", inline: "nearest" });
        });
        reachable = await target.evaluate(hitTarget);
      }
      if (!reachable) {
        const covered = await target.evaluate((el) => {
          const sheet = document.querySelector("[data-vaul-drawer][data-state='open']");
          return sheet != null && !sheet.contains(el);
        });
        if (covered) {
          skipped += 1;
          continue;
        }
        failures.push(`${control.name || control.tag} at ${url} stayed unclickable`);
        continue;
      }
      const before = await fingerprint(page);
      try {
        await target.click({ timeout: 2_000 });
      } catch {
        failures.push(`${control.name || control.tag} at ${url} could not be clicked`);
        continue;
      }
      try {
        await expect.poll(() => fingerprint(page), { timeout: 1_500 }).not.toEqual(before);
      } catch {
        const invalid = await page.evaluate(() => {
          const field = document.activeElement;
          return field instanceof HTMLInputElement && field.validationMessage !== "";
        });
        if (!invalid) failures.push(`${control.name || control.tag} at ${url} did nothing`);
      }
    }
    console.log(`no-op sweep ${url}: skipped ${String(skipped)} covered controls`);
    if (!sheetOnLoad.has(url)) expect(skipped).toBe(0);
    expect(failures).toEqual([]);
  });
}
