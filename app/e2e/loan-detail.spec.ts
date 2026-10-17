import { expect, test, type Page } from "@playwright/test";

// FLOW-106 B / FLOW-110, FLOW-139c. The loans list groups, a loan's page (its cards), the all-payments
// page and its sticky years, the status change, a part's category, a rate change, and delete with undo,
// on the dev loan store (fake data, no network). The day is pinned to the board's (?today=).
test.use({ viewport: { width: 390, height: 844 } });

const TODAY = "2026-10-17";

function toast(page: Page, text: string | RegExp) {
  return page.getByRole("status").filter({ hasText: text });
}

test("the list puts paid-off and closed loans under a collapsed group, and a row opens its page", async ({ page }) => {
  await page.goto("/e2e/loans");
  await expect(page.getByRole("button", { name: /^הלוואת גישור, / })).toBeVisible();
  await expect(page.getByRole("button", { name: /^הלוואת גישור, \$210,000, .*ריבית בלבד$/ })).toBeVisible();
  const group = page.getByRole("button", { name: /^נסגרו · 2/ });
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: /^שטר ישן, / })).toHaveCount(0);
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "true");
  // FLOW-139c: a paid-off loan shows its balance as $0, as the board draws it.
  await expect(page.getByRole("button", { name: /^שטר ישן, \$1,240, .*נפרעה 06\/2026$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^הלוואת ציוד ישנה, \$0, .*נסגרה 11\/2025$/ })).toBeVisible();

  await page.getByRole("button", { name: /^הלוואת גישור, / }).click();
  await expect(page).toHaveURL(/\/e2e\/loans\/loan-bridge$/);
  await expect(page.getByRole("heading", { name: "הלוואת גישור" })).toBeVisible();
  // The page leads with the balance and the next payment; the terms, the year's parts and the last payments follow.
  await expect(page.getByText("יתרה היום")).toBeVisible();
  await expect(page.getByText(/^התשלום הבא · /)).toBeVisible();
  await expect(page.getByRole("heading", { name: "שולם השנה" })).toBeVisible();
  // The bridge loan has no rate change (its rate is from the start), so the card is not drawn.
  await expect(page.getByRole("heading", { name: "שינויי ריבית" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "3 התשלומים האחרונים" })).toBeVisible();
  await page.getByRole("link", { name: "כל התשלומים" }).click();
  await expect(page).toHaveURL(/\/e2e\/loans\/loan-bridge\/payments$/);
  await expect(page.getByText("כל התשלומים", { exact: true })).toBeVisible();
  await expect(page.locator("a[href^='/transactions/']")).toHaveCount(4);
});

test("a missing loan shows the not-found state with a way back to the list", async ({ page }) => {
  await page.goto("/e2e/loans/no-such-loan");
  await expect(page.getByText("ההלוואה לא נמצאה")).toBeVisible();
  await page.getByRole("link", { name: "לרשימת ההלוואות" }).click();
  await expect(page).toHaveURL(/\/e2e\/loans$/);
});

test("marking a loan paid off takes a date from the last payment on, then undo reopens it", async ({ page }) => {
  await page.goto(`/e2e/loans/loan-bridge?reset=1&today=${TODAY}`);
  await page.getByRole("button", { name: /^סטטוס/ }).click();
  const statusSheet = page.getByRole("dialog", { name: "מצב" });
  await statusSheet.getByRole("radio", { name: "נפרעה" }).click();
  const dateSheet = page.getByRole("dialog", { name: "תאריך פירעון" });
  await expect(dateSheet.getByText("התשלום האחרון שויך ב־01/10/2026. אי אפשר לבחור יום לפניו.")).toBeVisible();
  await expect(dateSheet.getByRole("button", { name: "חודש קודם" })).toBeDisabled();
  await dateSheet.getByRole("button", { name: "החלה" }).click();
  await expect(toast(page, "סומנה כנפרעה · נשארה יתרה $210,000 בספרים")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The paid-off loan leads with נפרעה and its date alone; the status row keeps the date.
  await expect(page.locator(".ui-loan-status").getByText(/^נפרעה · 01\/10\/2026$/)).toBeVisible();
  await expect(page.getByText("יתרה היום")).toHaveCount(0);

  await toast(page, "סומנה כנפרעה").getByRole("button", { name: "ביטול" }).click();
  await expect(toast(page, "השינוי בוטל")).toBeVisible();
  await expect(page.getByRole("button", { name: /^סטטוס פעילה/ })).toBeVisible();
  await expect(page.getByText("יתרה היום")).toBeVisible();

  // Closed again, the loan moves under נסגרו on the list.
  await page.getByRole("button", { name: /^סטטוס/ }).click();
  await page.getByRole("dialog", { name: "מצב" }).getByRole("radio", { name: "נסגרה" }).click();
  await page.getByRole("dialog", { name: "תאריך סגירה" }).getByRole("button", { name: "החלה" }).click();
  await expect(toast(page, "סומנה כנסגרה")).toBeVisible();
  await page.getByRole("button", { name: /^חזרה/ }).first().click();
  await expect(page).toHaveURL(/\/e2e\/loans$/);
  await expect(page.getByRole("button", { name: /^הלוואת גישור, / })).toHaveCount(0);
  await page.getByRole("button", { name: /^נסגרו · 3/ }).click();
  await expect(page.getByRole("button", { name: /^הלוואת גישור, .*נסגרה 10\/2026$/ })).toBeVisible();
});

test("a part's category saves on tap, and undo puts the default back", async ({ page }) => {
  await page.goto(`/e2e/loans/loan-bridge?reset=1&today=${TODAY}`);
  await page.getByRole("button", { name: /^עמלות/ }).click();
  const sheet = page.getByRole("dialog", { name: "עמלות" });
  await expect(sheet.getByRole("radio", { name: "בלי קבועה" })).toHaveAttribute("aria-checked", "true");
  // Income and hidden categories do not fit a part.
  await expect(sheet.getByRole("radio", { name: "שכירות" })).toHaveCount(0);
  await expect(sheet.getByRole("radio", { name: "ישנה" })).toHaveCount(0);
  await sheet.getByRole("radio", { name: "עלויות סגירה" }).click();
  await expect(toast(page, "עמלות · עלויות סגירה")).toBeVisible();
  await expect(page.getByRole("button", { name: /^עמלות עלויות סגירה/ })).toBeVisible();
  await toast(page, "עמלות · עלויות סגירה").getByRole("button", { name: "ביטול" }).click();
  // With no category the part's row shows its profit note, as the year's rows do.
  await expect(page.getByRole("button", { name: /^עמלות נספר ברווח/ })).toBeVisible();
});

test("a rate change saves, and undo takes it back", async ({ page }) => {
  await page.goto(`/e2e/loans/loan-bridge?reset=1&today=${TODAY}`);
  await page.getByRole("button", { name: /^ריבית 10\.5%/ }).click();
  const sheet = page.getByRole("dialog", { name: "קביעת ריבית" });
  await sheet.getByLabel("ריבית שנתית").fill("12");
  await sheet.getByRole("button", { name: "שמירה" }).click();
  await expect(toast(page, "הריבית עודכנה")).toBeVisible();
  await expect(page.getByRole("heading", { name: "שינויי ריבית" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^מ־.* 12%$/ })).toBeVisible();
  await toast(page, "הריבית עודכנה").getByRole("button", { name: "ביטול" }).click();
  await expect(toast(page, "הריבית הקודמת חזרה")).toBeVisible();
  await expect(page.getByRole("heading", { name: "שינויי ריבית" })).toHaveCount(0);
});

test("delete names the payments that go back, then ביטול restores the loan", async ({ page }) => {
  await page.goto(`/e2e/loans/loan-mortgage?reset=1&today=${TODAY}`);
  await page.getByRole("button", { name: "מחיקת ההלוואה" }).click();
  const confirm = page.getByRole("dialog", { name: "למחוק את ההלוואה?" });
  await expect(confirm.getByText("22 תשלומים יחזרו לקטגוריה שלהם.")).toBeVisible();
  await confirm.getByRole("button", { name: "מחיקה" }).click();
  await expect(page).toHaveURL(/\/e2e\/loans$/);
  await expect(toast(page, "משכנתא דוגמה נמחקה")).toBeVisible();
  await expect(page.getByRole("button", { name: /^משכנתא דוגמה, / })).toHaveCount(0);
  await toast(page, "משכנתא דוגמה נמחקה").getByRole("button", { name: "ביטול" }).click();
  await expect(toast(page, "ההלוואה חזרה")).toBeVisible();
  await expect(page.getByRole("button", { name: /^משכנתא דוגמה, / })).toBeVisible();
});

test("the kind sheet turns a mortgage interest-only with its months, and checks the range", async ({ page }) => {
  await page.goto(`/e2e/loans/loan-mortgage?reset=1&today=${TODAY}`);
  await page.getByRole("button", { name: /^סוג/ }).click();
  const sheet = page.getByRole("dialog", { name: "סוג ההלוואה" });
  await sheet.getByRole("radio", { name: "ריבית בלבד" }).click();
  const months = sheet.getByLabel("חודשי ריבית בלבד");
  await months.fill("900");
  await sheet.getByRole("button", { name: "שמירה" }).click();
  await expect(sheet.getByText("בין 1 ל־360")).toBeVisible();
  await months.fill("24");
  await sheet.getByRole("button", { name: "שמירה" }).click();
  await expect(toast(page, "סוג · ריבית בלבד · 24 מתוך 360 חודשים")).toBeVisible();
  await expect(page.getByRole("button", { name: /^סוג ריבית בלבד/ })).toBeVisible();
});

test("all payments: years newest first with sticky heads that push each other out, and Back names the loan", async ({ page }) => {
  await page.goto(`/e2e/loans/loan-mortgage/payments?reset=1&today=${TODAY}`);
  await expect(page.getByText("22 תשלומים מאז 01/2025 · שיפוץ דוגמה 12")).toBeVisible();
  const head2026 = page.locator(".ui-loan-year-head").filter({ hasText: "2026 · 10 תשלומים" });
  const head2025 = page.locator(".ui-loan-year-head").filter({ hasText: "2025 · 12 תשלומים" });
  await expect(head2026).toBeVisible();
  await expect(page.getByRole("button", { name: /^חזרה/ }).first()).toBeVisible();
  // Scrolled into 2025, the 2026 head has moved up out from under the top bar, and the 2025 head sits under it.
  await head2025.evaluate((node) => { node.scrollIntoView({ block: "start" }); });
  const bar = await page.locator(".ui-txn-top").boundingBox();
  const sticky = await head2025.boundingBox();
  expect(bar).not.toBeNull();
  expect(sticky).not.toBeNull();
  if (bar == null || sticky == null) return;
  expect(Math.abs(sticky.y - (bar.y + bar.height))).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: /^חזרה/ }).first().click();
  await expect(page.getByText("יתרה היום")).toBeVisible();
});
