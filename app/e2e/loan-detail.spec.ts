import { expect, test, type Page } from "@playwright/test";

// FLOW-106 B / FLOW-110. The loans list groups, a loan's page, the status change, a part's
// category, a rate change, and delete with undo, on the dev loan store (fake data, no network).
test.use({ viewport: { width: 390, height: 844 } });

function toast(page: Page, text: string | RegExp) {
  return page.getByRole("status").filter({ hasText: text });
}

test("the list puts paid-off and closed loans under a collapsed נסגרו (N), and a row opens its page", async ({ page }) => {
  await page.goto("/e2e/loans");
  await expect(page.getByRole("button", { name: /^הלוואת גישור, / })).toBeVisible();
  await expect(page.getByRole("button", { name: /ריבית בלבד · בית דוגמה 9$/ })).toBeVisible();
  const group = page.getByRole("button", { name: "נסגרו (2)" });
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: /^שטר ישן, / })).toHaveCount(0);
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: /^שטר ישן, .*נפרעה · 15\/06\/2026$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^הלוואת ציוד ישנה, .*נסגרה · 30\/11\/2025$/ })).toBeVisible();

  await page.getByRole("button", { name: /^הלוואת גישור, / }).click();
  await expect(page).toHaveURL(/\/e2e\/loans\/loan-bridge$/);
  await expect(page.getByRole("heading", { name: "הלוואת גישור" })).toBeVisible();
  // FLOW-434: the page leads with the next payment; the terms and payments are under פרטי הלוואה.
  await expect(page.getByText(/^תשלום הבא · /)).toBeVisible();
  await expect(page.getByRole("heading", { name: "שולם השנה" })).toBeVisible();
  await page.getByRole("link", { name: /^פרטי הלוואה/ }).click();
  await expect(page).toHaveURL(/\/e2e\/loans\/loan-bridge\/details$/);
  await expect(page.getByRole("heading", { name: "פרטים" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "שינויי ריבית" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "קטגוריות לחלקים" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "תשלומים" })).toBeVisible();
  // The last 3 payments, then כל התשלומים opens the rest.
  await expect(page.getByRole("link", { name: /^תשלום / })).toHaveCount(3);
  await page.getByRole("button", { name: "כל התשלומים (4)" }).click();
  await expect(page.getByRole("link", { name: /^תשלום / })).toHaveCount(4);
});

test("a missing loan shows the not-found state with a way back to the list", async ({ page }) => {
  await page.goto("/e2e/loans/no-such-loan");
  await expect(page.getByText("ההלוואה לא נמצאה")).toBeVisible();
  await page.getByRole("link", { name: "לרשימת ההלוואות" }).click();
  await expect(page).toHaveURL(/\/e2e\/loans$/);
});

test("marking a loan paid off takes a date from the last payment on, then undo reopens it", async ({ page }) => {
  await page.goto("/e2e/loans/loan-bridge/details?reset=1");
  await page.getByRole("button", { name: /^מצב/ }).click();
  const statusSheet = page.getByRole("dialog", { name: "מצב" });
  await statusSheet.getByRole("radio", { name: "נפרעה" }).click();
  const dateSheet = page.getByRole("dialog", { name: "תאריך פירעון" });
  await expect(dateSheet.getByText("התשלום האחרון שויך ב־01/10/2026. אי אפשר לבחור יום לפניו.")).toBeVisible();
  await expect(dateSheet.getByRole("button", { name: "חודש קודם" })).toBeDisabled();
  await dateSheet.getByRole("button", { name: "החלה" }).click();
  await expect(toast(page, "סומנה כנפרעה · נשארה יתרה $240,000 בספרים")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^מצב נפרעה · 01\/10\/2026/ })).toBeVisible();

  await toast(page, "סומנה כנפרעה").getByRole("button", { name: "ביטול" }).click();
  await expect(toast(page, "השינוי בוטל")).toBeVisible();
  await expect(page.getByRole("button", { name: /^מצב פתוחה/ })).toBeVisible();

  // Closed again, the loan moves under נסגרו on the list.
  await page.getByRole("button", { name: /^מצב/ }).click();
  await page.getByRole("dialog", { name: "מצב" }).getByRole("radio", { name: "נסגרה" }).click();
  await page.getByRole("dialog", { name: "תאריך סגירה" }).getByRole("button", { name: "החלה" }).click();
  await expect(toast(page, "סומנה כנסגרה")).toBeVisible();
  await page.goto("/e2e/loans");
  await expect(page.getByRole("button", { name: /^הלוואת גישור, / })).toHaveCount(0);
  await page.getByRole("button", { name: "נסגרו (3)" }).click();
  await expect(page.getByRole("button", { name: /^הלוואת גישור, .*נסגרה · 01\/10\/2026$/ })).toBeVisible();
});

test("a part's category saves on tap, and undo puts the default back", async ({ page }) => {
  await page.goto("/e2e/loans/loan-bridge/details?reset=1");
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
  await expect(page.getByRole("button", { name: /^עמלות לא נקבעה/ })).toBeVisible();
});

test("a rate change saves, and undo puts the old rate back", async ({ page }) => {
  await page.goto("/e2e/loans/loan-bridge/details?reset=1");
  await page.getByRole("button", { name: /^שינוי ריבית מ־01\/09\/2026/ }).click();
  const sheet = page.getByRole("dialog", { name: "שינוי ריבית" });
  await expect(sheet.getByRole("button", { name: "הסרת השינוי" })).toBeVisible();
  await sheet.getByLabel("ריבית שנתית").fill("12");
  await sheet.getByRole("button", { name: "שמירה" }).click();
  await expect(toast(page, "הריבית עודכנה")).toBeVisible();
  await expect(page.getByRole("button", { name: /^שינוי ריבית מ־01\/09\/2026, 12%$/ })).toBeVisible();
  await toast(page, "הריבית עודכנה").getByRole("button", { name: "ביטול" }).click();
  await expect(page.getByRole("button", { name: /^שינוי ריבית מ־01\/09\/2026, 11.25%$/ })).toBeVisible();
});

test("delete names the payments that go back, then ביטול restores the loan", async ({ page }) => {
  await page.goto("/e2e/loans/loan-mortgage/details?reset=1");
  await page.getByRole("button", { name: "מחיקת ההלוואה" }).click();
  const confirm = page.getByRole("dialog", { name: "למחוק את ההלוואה?" });
  await expect(confirm.getByText("2 תשלומים יחזרו לקטגוריה שלהם.")).toBeVisible();
  await confirm.getByRole("button", { name: "מחיקה" }).click();
  await expect(page).toHaveURL(/\/e2e\/loans$/);
  await expect(toast(page, "משכנתא דוגמה נמחקה")).toBeVisible();
  await expect(page.getByRole("button", { name: /^משכנתא דוגמה, / })).toHaveCount(0);
  await toast(page, "משכנתא דוגמה נמחקה").getByRole("button", { name: "ביטול" }).click();
  await expect(toast(page, "ההלוואה חזרה")).toBeVisible();
  await expect(page.getByRole("button", { name: /^משכנתא דוגמה, / })).toBeVisible();
});

test("the kind sheet turns a mortgage interest-only with its months, and checks the range", async ({ page }) => {
  await page.goto("/e2e/loans/loan-mortgage/details?reset=1");
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
  await expect(page.getByRole("button", { name: /^סוג ריבית בלבד · 24 מתוך 360 חודשים/ })).toBeVisible();
});

test("the next payments open by year, and a year opens its parts (FLOW-434)", async ({ page }) => {
  await page.goto("/e2e/loans/loan-mortgage?reset=1");
  await page.getByRole("link", { name: /^תשלומים הבאים/ }).click();
  await expect(page).toHaveURL(/\/e2e\/loans\/loan-mortgage\/future$/);
  await expect(page.getByRole("heading", { name: "לפי שנה" })).toBeVisible();
  await page.getByRole("link", { name: /^2027,/ }).click();
  await expect(page).toHaveURL(/\/future\/2027$/);
  await expect(page.getByText("לתשלום בשנה")).toBeVisible();
  await page.getByRole("button", { name: "חזרה" }).first().click();
  await expect(page).toHaveURL(/\/future$/);
  await page.getByRole("link", { name: /^עד סוף ההלוואה/ }).click();
  await expect(page.getByText(/^לתשלום עד \d{4}$/)).toBeVisible();
});
