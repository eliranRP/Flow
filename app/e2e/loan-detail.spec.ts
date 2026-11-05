import { expect, test, type Page } from "@playwright/test";

// FLOW-106 B / FLOW-110, FLOW-139c. The loans list groups, a loan's page (its cards), the all-payments
// page and its sticky years, the status change, a part's category, a rate change, and delete with undo,
// on the dev loan store (fake data, no network). The day is pinned to the board's (?today=).
test.use({ viewport: { width: 390, height: 844 } });

const TODAY = "2026-10-17";

function toast(page: Page, text: string | RegExp) {
  return page.getByRole("status").filter({ hasText: text });
}

test("the list puts paid-off and closed loans under נסגרו, and a row opens its page", async ({ page }) => {
  await page.goto("/e2e/loans");
  await expect(page.getByRole("button", { name: /^הלוואת גישור, / })).toBeVisible();
  // FLOW-1046: the rows sit in groups by kind; the bridge loan is under ריבית בלבד.
  await expect(page.getByRole("heading", { name: "ריבית בלבד" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^הלוואת גישור, \$210,000, / })).toBeVisible();
  const closed = page.getByRole("radio", { name: /^נסגרו · 2/ });
  await expect(closed).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("button", { name: /^שטר ישן, / })).toHaveCount(0);
  await closed.click();
  await expect(closed).toHaveAttribute("aria-checked", "true");
  // FLOW-139c: a paid-off loan shows its balance as $0, as the board draws it.
  await expect(page.getByRole("button", { name: /^שטר ישן, \$1,240, נפרעה 06\/2026/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^הלוואת ציוד ישנה, \$0, נסגרה 11\/2025/ })).toBeVisible();

  await page.getByRole("radio", { name: /^פעילות · / }).click();
  await page.getByRole("button", { name: /^הלוואת גישור, / }).click();
  await expect(page).toHaveURL(/\/e2e\/loans\/loan-bridge$/);
  await expect(page.getByRole("heading", { name: "הלוואת גישור" })).toBeVisible();
  // FLOW-1046: the band leads with the balance; the next payment, what was paid, the terms and the last payments follow.
  await expect(page.getByText("יתרה היום")).toBeVisible();
  await expect(page.getByRole("region", { name: "שולם" })).toBeVisible();
  await expect(page.getByText(/^התשלום הבא · /)).toBeVisible();
  // The bridge loan has no rate change (its rate is from the start), so the card is not drawn.
  await expect(page.getByRole("heading", { name: "שינויי ריבית" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "3 התשלומים האחרונים" })).toBeVisible();
  await page.getByRole("link", { name: "כל התשלומים" }).click();
  await expect(page).toHaveURL(/\/e2e\/loans\/loan-bridge\/payments$/);
  await expect(page.getByRole("heading", { level: 1, name: "תשלומים" })).toBeVisible();
  await expect(page.locator("a[href^='/transactions/']")).toHaveCount(3);
});

test("the band opens the loans summary, its switch moves to this year, and a row opens its loan (FLOW-142)", async ({ page }) => {
  await page.goto("/e2e/loans?reset=1");
  await page.getByRole("link", { name: /^נשאר לשלם/ }).first().click();
  await expect(page).toHaveURL(/\/e2e\/loans\/summary$/);
  await expect(page.getByRole("heading", { level: 1, name: "סיכום הלוואות" })).toBeVisible();
  await expect(page.getByText("החוב בהתחלה")).toBeVisible();
  await page.getByRole("radio", { name: /^20\d\d$/ }).click();
  await expect(page.getByText(/^החוב ב־01\/01\/20\d\d$/)).toBeVisible();
  await page.getByRole("button", { name: /^משכנתא דוגמה, / }).click();
  await expect(page).toHaveURL(/\/e2e\/loans\/loan-mortgage$/);
  await expect(page.getByRole("heading", { name: "משכנתא דוגמה" })).toBeVisible();
});

test("a missing loan shows the not-found state with a way back to the list", async ({ page }) => {
  await page.goto("/e2e/loans/no-such-loan");
  await expect(page.getByText("ההלוואה לא נמצאה")).toBeVisible();
  await page.getByRole("link", { name: "לרשימת ההלוואות" }).click();
  await expect(page).toHaveURL(/\/e2e\/loans$/);
});

test("סגירת ההלוואה takes why and a day from the last payment on, then undo reopens it (FLOW-962)", async ({ page }) => {
  await page.goto(`/e2e/loans/loan-bridge?reset=1&today=${TODAY}`);
  await page.getByRole("button", { name: "סגירת ההלוואה" }).click();
  const closeSheet = page.getByRole("dialog", { name: /^סגירת הלוואת גישור/ });
  await expect(closeSheet.getByRole("radio", { name: /נפרעה במלואה/ })).toHaveAttribute("aria-checked", "true");
  await closeSheet.getByRole("button", { name: /תאריך הסגירה/ }).click();
  const dateSheet = page.getByRole("dialog", { name: "תאריך הסגירה" });
  await expect(dateSheet.getByText("התשלום האחרון שויך ב־01/10/2026. אי אפשר לבחור יום לפניו.")).toBeVisible();
  await expect(dateSheet.getByRole("button", { name: "חודש קודם" })).toBeDisabled();
  await dateSheet.getByRole("button", { name: "בחירה" }).click();
  await closeSheet.getByRole("button", { name: "סגירת ההלוואה" }).click();
  await expect(toast(page, "הלוואת גישור נסגרה · נפרעה במלואה · נשארה יתרה $210,000 בספרים")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The closed loan leads with how it ended; the status row only reads.
  await expect(page.getByRole("region", { name: "ההלוואה נסגרה" })).toContainText("נסגרה · נפרעה במלואה · 17/10/2026");

  await toast(page, "הלוואת גישור נסגרה").getByRole("button", { name: "ביטול" }).click();
  await expect(toast(page, "ההלוואה חזרה לפעילות")).toBeVisible();
  await expect(page.getByText("יתרה היום")).toBeVisible();
  await expect(page.getByRole("button", { name: "סגירת ההלוואה" })).toBeVisible();

  // Closed for a refinance, the loan moves under נסגרו on the list.
  await page.getByRole("button", { name: "סגירת ההלוואה" }).click();
  await page.getByRole("dialog", { name: /^סגירת הלוואת גישור/ }).getByRole("radio", { name: /מימון מחדש/ }).click();
  await page.getByRole("dialog", { name: /^סגירת הלוואת גישור/ }).getByRole("button", { name: "סגירת ההלוואה" }).click();
  await expect(toast(page, "הלוואת גישור נסגרה · מימון מחדש")).toBeVisible();
  await page.getByRole("button", { name: /^חזרה/ }).first().click();
  await expect(page).toHaveURL(/\/e2e\/loans$/);
  await expect(page.getByRole("button", { name: /^הלוואת גישור, / })).toHaveCount(0);
  // FLOW-1046: פעילות / נסגרו is a segment now, so נסגרו is a radio.
  await page.getByRole("radio", { name: /^נסגרו · 3/ }).click();
  // The closed row's line is when it closed, then its project.
  await expect(page.getByRole("button", { name: /^הלוואת גישור, .*נסגרה 10\/2026 · בית דוגמה 9$/ })).toBeVisible();
});

test("a part's category saves on tap, and undo puts the default back", async ({ page }) => {
  await page.goto(`/e2e/loans/loan-note?reset=1&today=${TODAY}`);
  await page.getByRole("button", { name: /^עמלות/ }).click();
  const sheet = page.getByRole("dialog", { name: "עמלות" });
  await expect(sheet.getByRole("radio", { name: "בלי קבועה" })).toHaveAttribute("aria-checked", "true");
  // Income and hidden categories do not fit a part.
  await expect(sheet.getByRole("radio", { name: "שכירות" })).toHaveCount(0);
  await expect(sheet.getByRole("radio", { name: "ישנה" })).toHaveCount(0);
  await sheet.getByRole("radio", { name: "עלויות סגירה" }).click();
  await expect(toast(page, "עמלות · עלויות סגירה")).toBeVisible();
  // FLOW-142: the paid card's row says whether the part counts in the profit; its sheet shows the category.
  await page.getByRole("button", { name: /^עמלות/ }).click();
  await expect(page.getByRole("dialog", { name: "עמלות" }).getByRole("radio", { name: "עלויות סגירה" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await toast(page, "עמלות · עלויות סגירה").getByRole("button", { name: "ביטול" }).click();
  await page.getByRole("button", { name: /^עמלות/ }).click();
  await expect(page.getByRole("dialog", { name: "עמלות" }).getByRole("radio", { name: "בלי קבועה" })).toHaveAttribute("aria-checked", "true");
});

test("a rate change saves, and undo takes it back", async ({ page }) => {
  await page.goto(`/e2e/loans/loan-bridge?reset=1&today=${TODAY}`);
  await page.getByRole("button", { name: /^ריבית 10\.5%/ }).click();
  const sheet = page.getByRole("dialog", { name: "קביעת ריבית" });
  await expect(sheet.getByRole("radio", { name: /מהיום/ })).toHaveAttribute("aria-checked", "true");
  await sheet.getByLabel("ריבית שנתית").fill("12");
  await sheet.getByRole("button", { name: "שמירת הריבית" }).click();
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
  await expect(confirm.getByText("לוח התשלומים, הצפי ושינויי הריבית שלה יימחקו. 22 התשלומים שכבר שויכו יישארו בתנועות ויחזרו לקטגוריה שלהם.")).toBeVisible();
  await confirm.getByRole("button", { name: "מחיקת ההלוואה" }).click();
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
  // FLOW-1046: each year is a one-line GroupHead: the year, then "count · total".
  const yearHead = (year: string, count: number) =>
    page.locator(".ui-group-head.ui-group-head-line")
      .filter({ has: page.locator(".ui-group-title", { hasText: new RegExp(`^${year}$`) }) })
      .filter({ hasText: new RegExp(`${String(count)} · \\$`) });
  const head2026 = yearHead("2026", 10);
  const head2025 = yearHead("2025", 12);
  await expect(head2026).toBeVisible();
  await expect(head2025).toBeVisible();
  await expect(page.getByRole("button", { name: /^חזרה/ }).first()).toBeVisible();
  // Newest first: 2026 sits above 2025.
  const first2026 = await head2026.boundingBox();
  const first2025 = await head2025.boundingBox();
  expect(first2026 != null && first2025 != null && first2026.y < first2025.y).toBe(true);
  // Scrolled into 2025, the 2026 head has moved up out from under the compact bar, and the 2025 head sits under
  // the bar at --month-sticky-top (the bar, its dock and the 1px hairline).
  // scrollIntoView stops the head just above the bar's scroll padding; scroll on into 2025's rows so it pins.
  await head2025.evaluate((node) => { node.scrollIntoView({ block: "start" }); window.scrollBy(0, 120); });
  await expect(page.locator(".ui-compact-bar")).toBeVisible();
  const stickyTop = () => head2025.evaluate((node) => parseFloat(getComputedStyle(node).top));
  await expect.poll(async () => {
    const box = await head2025.boundingBox();
    return box == null ? Number.NaN : Math.abs(box.y - await stickyTop());
  }).toBeLessThanOrEqual(1);
  expect(await stickyTop()).toBeGreaterThan(0);
  const bar = await page.locator(".ui-compact-bar").boundingBox();
  const sticky = await head2025.boundingBox();
  const pushed = await head2026.boundingBox();
  expect(bar).not.toBeNull();
  expect(sticky).not.toBeNull();
  expect(pushed).not.toBeNull();
  if (bar == null || sticky == null || pushed == null) return;
  expect(sticky.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
  expect(pushed.y + pushed.height).toBeLessThanOrEqual(sticky.y + 1);
  await page.getByRole("button", { name: /^חזרה/ }).first().click();
  await expect(page.getByText("יתרה היום")).toBeVisible();
});
