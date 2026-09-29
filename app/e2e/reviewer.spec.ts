import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

const refusal = "לא נשמר. בדקו את הפרטים ונסו שוב.";
const offline = "לא נשמר – אין חיבור";

async function toast(page: Page, message: string) {
  await expect(page.locator(".ui-toast").getByText(message)).toBeVisible();
}

function toastAction(page: Page, name: string) {
  return page.locator(".ui-toast button", { hasText: name });
}

async function horizontalOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const view = document.documentElement;
    if (view.scrollWidth > view.clientWidth + 1) {
      problems.push(`page +${String(view.scrollWidth - view.clientWidth)}px`);
    }
    const offenders: string[] = [];
    for (const node of document.body.querySelectorAll("*")) {
      if (!(node instanceof HTMLElement)) continue;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (style.position === "fixed") continue;
      const box = node.getBoundingClientRect();
      if (box.width < 1 && box.height < 1) continue;
      const pastEnd = box.right - view.clientWidth;
      const pastStart = -box.left;
      if (pastEnd > 1 || pastStart > 1) {
        const name = typeof node.className === "string" && node.className ? node.className : node.tagName;
        offenders.push(`${name} +${String(Math.round(Math.max(pastEnd, pastStart)))}px`);
      }
    }
    if (offenders.length > 0) problems.push(offenders.slice(0, 6).join("; "));
    return problems;
  });
}

async function expectNoOverflow(page: Page) {
  expect(await horizontalOverflow(page)).toEqual([]);
}

test("the reviewer index is marked as sample data and the lines add up", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/reviewer");
  await expect(page.getByText("נתוני דוגמה · Example data")).toBeVisible();
  await expect(page.getByRole("heading", { name: "תצוגת ביקורת" })).toBeVisible();
  await expect(page.getByText("₪1,800")).toBeVisible();
  await expect(page.getByText("₪850")).toBeVisible();
  await expect(page.getByText("₪950")).toBeVisible();
  await expect(page.getByText("₪1,000").first()).toBeVisible();
  await expectNoOverflow(page);
});

test("home links open a queue, a filed list, and each save", async ({ page }) => {
  await page.goto("/reviewer");
  const links: Array<[string, RegExp]> = [
    ["תור לאישור", /\/reviewer\/review$/],
    ["תור, שמירה שנדחית", /\/reviewer\/review\?save=fail$/],
    ["תור, בלי חיבור", /\/reviewer\/review\?save=offline$/],
    ["שויכו היום", /\/reviewer\/filed$/],
    ["שויכו היום, אין תנועות", /\/reviewer\/filed\?empty=1$/],
    ["קטגוריה, מלט", /\/reviewer\/category$/],
    ["קטגוריה, אין תנועות", /\/reviewer\/category\?empty=1$/],
    ["קטגוריה, עוד תנועות", /\/reviewer\/category\?more=1$/],
    ["לאישור בפרויקט", /\/reviewer\/waiting$/],
    ["תור של הפרויקט", /\/reviewer\/project$/],
    ["תור של הפרויקט, אין פריטים", /\/reviewer\/project\?empty=1$/],
    ["שמירה שמצליחה", /\/reviewer\/save\?save=ok$/],
    ["שמירה שנדחית", /\/reviewer\/save\?save=fail$/],
    ["שמירה בלי חיבור", /\/reviewer\/save\?save=offline$/],
    ["שמירה, עלות משותפת", /\/reviewer\/save\?save=shared$/],
  ];
  for (const [name, url] of links) {
    await page.goto("/reviewer");
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByText("נתוני דוגמה · Example data")).toBeVisible();
  }
});

test("the queue opens a shared split, blocks a missing category, and approves the rest", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/reviewer/review");
  await expect(page.getByText("הוצאה משותפת")).toBeVisible();
  await expect(page.getByText("1 מתוך 3")).toBeVisible();
  await page.getByRole("link", { name: "צפייה" }).click();
  await expect(page).toHaveURL(/\/reviewer\/filed$/);
  await page.goto("/reviewer/review");
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page.getByRole("link", { name: "צפייה" })).toHaveCount(0);
  await expectNoOverflow(page);
  const approve = page.getByRole("button", { name: "אישור" });
  expect(await approve.evaluate((node) => getComputedStyle(node).cursor)).toBe("pointer");
  await approve.click();
  await expect(page).toHaveURL(/\/reviewer\/split\?save=ok$/);
  await expect(page.getByRole("heading", { name: "חלוקה בין פרויקטים" })).toBeVisible();
  const save = page.getByRole("button", { name: "שמירה" });
  await expect(save).toBeDisabled();
  expect(await save.evaluate((node) => getComputedStyle(node).cursor)).toBe("not-allowed");
  await page.getByRole("radio", { name: /שווה בין כל הפרויקטים/ }).click();
  await expect(save).toBeEnabled();
  expect(await save.evaluate((node) => getComputedStyle(node).cursor)).toBe("pointer");
  await save.click();
  await toast(page, "החלוקה נשמרה");
  await expect(page).toHaveURL(/\/reviewer\/review\?save=ok$/);

  await page.goto("/reviewer/review");
  await page.getByRole("button", { name: "דלג" }).click();
  await toast(page, "דילגנו על הפריט");
  await expect(page.getByText("חסר קטגוריה, בחרו בשינוי")).toBeVisible();
  const held = page.getByRole("button", { name: "אישור" });
  await expect(held).toBeDisabled();
  expect(await held.evaluate((node) => getComputedStyle(node).cursor)).toBe("not-allowed");
  await held.click({ force: true });
  await expect(page.getByText("חסר קטגוריה, בחרו בשינוי")).toBeVisible();
  await page.getByRole("link", { name: "שינוי" }).click();
  await expect(page).toHaveURL(/\/reviewer\/save\?save=ok&item=q-bolts$/);
  await page.goto("/reviewer/review");
  await page.getByRole("button", { name: "דלג" }).click();
  await page.getByRole("button", { name: "דלג" }).click();
  await expect(page.getByRole("heading", { name: "צבעי הכרמל בע״מ" })).toBeVisible();
  await page.getByRole("button", { name: "אישור" }).click();
  await toast(page, "הפריט אושר");
  await expect(page.getByText("הכל מאושר")).toBeVisible();
  await page.getByRole("link", { name: "לתצוגת הביקורת" }).click();
  await expect(page).toHaveURL(/\/reviewer$/);
});

test("a refused queue save has no retry, and a dropped connection does", async ({ page }) => {
  await page.goto("/reviewer/review?save=fail");
  await page.getByRole("button", { name: "דלג" }).click();
  await toast(page, refusal);
  await expect(toastAction(page, "ניסיון חוזר")).toHaveCount(0);
  await page.goto("/reviewer/review?save=offline");
  await page.getByRole("button", { name: "דלג" }).click();
  await toast(page, offline);
  const retry = toastAction(page, "ניסיון חוזר");
  await expect(retry).toBeVisible();
  expect(await retry.evaluate((node) => getComputedStyle(node).cursor)).toBe("pointer");
  await retry.click();
  await toast(page, offline);
});

test("the category page shows the materials line, and can be empty", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/reviewer/category");
  await expect(page.getByRole("heading", { name: "מלט" })).toBeVisible();
  await expect(page.getByText("בית הספר אלון")).toBeVisible();
  await expect(page.getByText("₪220")).toBeVisible();
  await expectNoOverflow(page);
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/reviewer$/);
  await page.goto("/reviewer/category?empty=1");
  await expect(page.getByText("אין תנועות בקטגוריה הזו")).toBeVisible();
  await expectNoOverflow(page);
});

test("the project queue goes back, and its empty state offers חזרה לפרויקט", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/reviewer/project");
  await expect(page.getByRole("heading", { name: "לאישור" })).toBeVisible();
  await expect(page.getByText("₪150")).toBeVisible();
  await expectNoOverflow(page);
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/reviewer$/);
  await page.goto("/reviewer/project?empty=1");
  await expect(page.getByText("אין פריטים לאישור בפרויקט הזה")).toBeVisible();
  await expect(page.getByText("אין פריטים של הפרויקט הזה בתור.")).toBeVisible();
  await expectNoOverflow(page);
  await page.getByRole("link", { name: "חזרה לפרויקט" }).click();
  await expect(page).toHaveURL(/\/reviewer$/);
});

test("filed today lists both rows, opens one, and can be empty", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/reviewer/filed");
  await expect(page.getByRole("heading", { name: "שויכו היום" })).toBeVisible();
  await expect(page.getByRole("link", { name: /מחצבת הדקל/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /שינוע הנמל/ })).toBeVisible();
  await expectNoOverflow(page);
  await page.getByRole("link", { name: /מחצבת הדקל/ }).click();
  await expect(page).toHaveURL(/\/reviewer\/transaction\/t-sample-sand$/);
  await expect(page.getByText("₪220")).toBeVisible();
  await expect(page.getByText("בית הספר אלון · מלט")).toBeVisible();
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page.getByRole("heading", { name: "שויכו היום" })).toBeVisible();
  await page.goto("/reviewer/filed?empty=1");
  await expect(page.getByText("אין תנועות ששויכו היום")).toBeVisible();
  await expectNoOverflow(page);
});

test("the change sheet can succeed, refuse, or lose the connection", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/reviewer/save?save=fail");
  await expectNoOverflow(page);
  await page.getByRole("button", { name: "שמירה ואישור" }).click();
  await toast(page, refusal);
  await expect(toastAction(page, "ניסיון חוזר")).toHaveCount(0);
  await page.goto("/reviewer/save?save=offline");
  await page.getByRole("button", { name: "שמירה ואישור" }).click();
  await toast(page, offline);
  await expect(page.getByRole("dialog", { name: "שינוי שיוך" })).toBeVisible();
  const retry = toastAction(page, "ניסיון חוזר");
  await expect(retry).toBeVisible();
  expect(await retry.evaluate((node) => getComputedStyle(node).cursor)).toBe("pointer");
  await retry.click();
  await toast(page, offline);
  await expect(page.getByRole("dialog", { name: "שינוי שיוך" })).toBeVisible();
  await page.goto("/reviewer/save?save=ok");
  await page.getByRole("button", { name: "שמירה ואישור" }).click();
  await toast(page, "השיוך נשמר");
  await expect(page).toHaveURL(/\/reviewer\/review$/);
});

test("a tap on the toast does not close the sheet under it", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/reviewer/save?save=offline");
  await page.getByRole("button", { name: "שמירה ואישור" }).click();
  await toast(page, offline);
  const sheet = page.getByRole("dialog", { name: "שינוי שיוך" });
  await expect(sheet).toBeVisible();
  const toastBox = await page.locator(".ui-toast").boundingBox();
  const sheetBox = await sheet.boundingBox();
  expect(toastBox).not.toBeNull();
  expect(sheetBox).not.toBeNull();
  if (toastBox && sheetBox) expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(sheetBox.y + 1);
  await toastAction(page, "ניסיון חוזר").click();
  await expect(sheet).toBeVisible();
  await toast(page, offline);
  await page.locator(".ui-toast-text").click();
  await expect(page.locator(".ui-toast")).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await expectNoOverflow(page);
});

test("category, project queue, and waiting stay inside the sample", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/reviewer/category");
  await page.getByRole("link", { name: /חול/ }).click();
  await expect(page).toHaveURL(/\/reviewer\/transaction\/t-sample-sand$/);
  await expect(page.getByText("נתוני דוגמה · Example data")).toBeVisible();

  await page.goto("/reviewer/category?more=1");
  await expect(page.getByRole("button", { name: "עוד תנועות" })).toBeVisible();
  await expect(page.getByText("₪140")).toBeVisible();
  await expect(page.getByText("₪80")).toHaveCount(0);
  await page.getByRole("button", { name: "עוד תנועות" }).click();
  await expect(page.getByText("₪140")).toBeVisible();
  await expect(page.getByText("₪80")).toBeVisible();
  await expect(page.getByText("₪180")).toHaveCount(0);
  await expectNoOverflow(page);

  await page.goto("/reviewer/waiting");
  await expect(page.getByRole("heading", { name: "לאישור" })).toBeVisible();
  await expect(page.getByText("₪150")).toBeVisible();
  await expect(page.getByText("₪300")).toBeVisible();
  await page.getByRole("link", { name: /ברגים/ }).click();
  await expect(page).toHaveURL(/\/reviewer\/save\?save=ok&item=q-bolts$/);
  await expect(page.getByText("ברגי העמק בע״מ · ₪150")).toBeVisible();
  await page.goto("/reviewer/waiting");
  await page.getByRole("link", { name: /צבע/ }).click();
  await expect(page).toHaveURL(/\/reviewer\/save\?save=ok&item=q-paint$/);
  await expect(page.getByText("צבעי הכרמל בע״מ · ₪300")).toBeVisible();

  await page.goto("/reviewer/project");
  await page.getByRole("link", { name: "צפייה" }).click();
  await expect(page).toHaveURL(/\/reviewer\/filed$/);
  await page.goto("/reviewer/project");
  await page.getByRole("link", { name: "שינוי" }).click();
  await expect(page).toHaveURL(/\/reviewer\/save\?save=ok&item=q-bolts$/);
  await expect(page.getByText("ברגי העמק בע״מ · ₪150")).toBeVisible();
  await page.goto("/reviewer/project");
  await page.getByRole("button", { name: "דלג" }).click();
  await toast(page, "דילגנו על הפריט");
  await expect(page.getByRole("heading", { name: "צבעי הכרמל בע״מ" })).toBeVisible();
  await page.getByRole("button", { name: "אישור" }).click();
  await toast(page, "הפריט אושר");
  await expect(toastAction(page, "ביטול")).toBeVisible();
  await toastAction(page, "ביטול").click();
  await expect(page.getByRole("heading", { name: "צבעי הכרמל בע״מ" })).toBeVisible();
  await expectNoOverflow(page);
});

test("a shared-cost save offers לחלוקה and stays on the sheet", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/reviewer/save?save=shared");
  await page.getByRole("button", { name: "שמירה ואישור" }).click();
  await toast(page, "עלות משותפת מחולקת במסך החלוקה.");
  await expect(page.getByRole("dialog", { name: "שינוי שיוך" })).toBeVisible();
  const split = toastAction(page, "לחלוקה");
  await expect(split).toBeVisible();
  expect(await split.evaluate((node) => getComputedStyle(node).cursor)).toBe("pointer");
  await split.click();
  await expect(page).toHaveURL(/\/reviewer\/split\?save=shared$/);
  await expect(page.getByRole("heading", { name: "חלוקה בין פרויקטים" })).toBeVisible();
});

test("reviewer screens stay inside the viewport at 320 in both themes", async ({ page }) => {
  const routes = ["/reviewer", "/reviewer/review", "/reviewer/waiting", "/reviewer/category?more=1", "/reviewer/save?save=ok"];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const route of routes) {
      await page.setViewportSize({ width: 320, height: 844 });
      await page.goto(route);
      await expect(page.getByText("נתוני דוגמה · Example data")).toBeVisible();
      await expectNoOverflow(page);
    }
  }
});

test("a refused split save has no retry", async ({ page }) => {
  await page.goto("/reviewer/split?save=fail");
  await page.getByRole("radio", { name: /שווה בין כל הפרויקטים/ }).click();
  await page.getByRole("button", { name: "שמירה" }).click();
  await toast(page, refusal);
  await expect(toastAction(page, "ניסיון חוזר")).toHaveCount(0);
});
