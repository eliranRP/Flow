import { expect, test } from "@playwright/test";
import { previewToast, toast, overlaps } from "./controls-helpers";

test.use({ viewport: { width: 390, height: 844 } });
// Preview-mode tests, one page per test (see controls-review.spec.ts).
test.describe.configure({ mode: "parallel" });

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
  await page.goto("/e2e/categories?preview=1&hidden=1");
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/settings/);
  await page.goto("/e2e/categories?preview=1&hidden=1");
  await page.getByRole("radio", { name: "הכנסות" }).click();
  await expect(page.getByText("הכנסות משכירות")).toBeVisible();
  await expect(page.getByText("חומרים")).toHaveCount(0);
  await page.getByRole("radio", { name: "הוצאות" }).click();
  await page.getByRole("button", { name: /^חשמל ומים/ }).click();
  await page.getByRole("dialog", { name: "חשמל ומים" }).getByRole("button", { name: "הסתרה", exact: true }).click();
  await page.getByRole("dialog", { name: "להסתיר את הקטגוריה?" }).getByRole("button", { name: "הסתרה", exact: true }).click();
  await toast(page, previewToast);
  await expect(page.getByRole("dialog", { name: "חשמל ומים" })).toHaveCount(0);
  // In preview a blocked write leaves the confirm sheet open; dismiss it so its open dialog does not hide the footer.
  await page.getByRole("dialog", { name: "להסתיר את הקטגוריה?" }).getByRole("button", { name: "ביטול" }).click();
  await expect(page.getByRole("dialog", { name: "להסתיר את הקטגוריה?" })).toHaveCount(0);
  await page.getByRole("button", { name: /מוסתרות/ }).click();
  await page.getByRole("button", { name: /^ישנה/ }).click();
  await page.getByRole("button", { name: "החזרה לרשימה" }).click();
  const unhide = page.getByRole("dialog", { name: "להחזיר את הקטגוריה לרשימה?" });
  await unhide.getByRole("button", { name: "החזרה לרשימה", exact: true }).click();
  // The preview guard blocks the write: the confirm stays open with the blocked-write toast, and nothing moves.
  await toast(page, previewToast);
  await unhide.getByRole("button", { name: "ביטול" }).click();
  await expect(unhide).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^ישנה/ })).toBeVisible();
  await page.getByRole("button", { name: /^חומרים/ }).click();
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
  await expect(page).toHaveURL(/\/loans\?preview=1$/);
  await expect(page.getByText("משכנתא אלון")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/settings\?preview=1$/);

  await page.goto("/settings?preview=1&sheet=sumit");
  await expect(page).toHaveURL(/\/settings\/connections\/sumit\?preview=1/);
  await expect(page.getByRole("heading", { name: "SUMIT", exact: true })).toBeVisible();
});
