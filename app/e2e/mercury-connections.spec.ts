import { expect, test } from "@playwright/test";

// FLOW-938: the Mercury page on the dev fixture (invented names and balances). Step 3 after the key, the
// date sheet, the synced accounts list, an account no one answered, and two connections.
test.use({ viewport: { width: 390, height: 844 } });

test("step 3: checking, savings and the card start checked, treasury does not; the button counts them", async ({ page }) => {
  await page.goto("/e2e/connections/mercury?state=pick");
  await expect(page.getByText("3 · אילו חשבונות לסנכרן, ומאיזה תאריך")).toBeVisible();
  const accounts = page.getByRole("group", { name: "חשבונות" }).getByRole("checkbox");
  await expect(accounts).toHaveCount(5);
  await expect(page.getByRole("checkbox", { name: /Treasury/ })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("כסף מושקע, לא תזרים של העסק. בדרך כלל לא מסנכרנים.")).toBeVisible();
  await expect(page.getByRole("button", { name: "סנכרון 4 חשבונות" })).toBeEnabled();
  await page.getByRole("checkbox", { name: /Payroll/ }).click();
  await expect(page.getByRole("button", { name: "סנכרון 3 חשבונות" })).toBeEnabled();
  await page.getByRole("button", { name: "בחירת כולם" }).click();
  await page.getByRole("button", { name: "ניקוי הבחירה" }).click();
  // FLOW-975: never greyed out (decision 0223); with nothing checked the label says what is missing and a tap stays here.
  const none = page.getByRole("button", { name: "בחרו לפחות חשבון אחד" });
  await expect(none).toBeEnabled();
  await none.click();
  await expect(page.getByRole("checkbox", { name: /Payroll/ })).toBeVisible();
});

test("step 3 then the connected page: the synced accounts row says 4 מתוך 5", async ({ page }) => {
  await page.goto("/e2e/connections/mercury?state=pick");
  await page.getByRole("button", { name: "סנכרון 4 חשבונות" }).click();
  await expect(page.getByRole("button", { name: /^חשבונות מסונכרנים: 4 מתוך 5/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ חיבור Mercury נוסף" })).toBeVisible();
});

test("the date sheet: מתאריך shows the day and אישור applies it to the row", async ({ page }) => {
  await page.goto("/e2e/connections/mercury?state=pick&sheet=from");
  const sheet = page.getByRole("dialog", { name: "מאיזה תאריך לייבא" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("radio", { name: /מתאריך/ })).toHaveAttribute("aria-checked", "true");
  await expect(sheet.getByRole("button", { name: /^מתאריך: \d{2}\/\d{2}\/\d{4}$/ })).toBeVisible();
  await sheet.getByRole("button", { name: "אישור" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: /מאיזה תאריך לייבא/ })).toContainText("מתאריך");
});

test("the synced accounts list: an unchecked account says what stays, a checked one brings back the date row", async ({ page }) => {
  await page.goto("/e2e/connections/mercury?edit=1");
  await expect(page.getByText("סמנו את החשבונות שנכנסים ל־Flow.")).toBeVisible();
  await expect(page.getByText("מה שכבר נכנס נשאר. תנועות חדשות לא ייכנסו.")).toBeVisible();
  await expect(page.getByText("נכנס מהיום, ואם תרצו גם 24 חודשים אחורה.")).toBeVisible();
  await expect(page.getByRole("button", { name: /מאיזה תאריך לייבא לחשבון החדש/ })).toContainText("מהיום");
  await page.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByRole("button", { name: /^חשבונות מסונכרנים: 3 מתוך 5/ })).toBeVisible();
});

test("an account no one answered: the tinted card, and כן adds it to the synced accounts", async ({ page }) => {
  await page.goto("/e2e/connections/mercury?state=newaccount");
  await expect(page.getByText(/ב־Mercury נפתח חשבון חדש/)).toBeVisible();
  await page.getByRole("button", { name: "כן, לסנכרן" }).click();
  await expect(page.getByText(/ב־Mercury נפתח חשבון חדש/)).toBeHidden();
  await expect(page.getByRole("button", { name: /^חשבונות מסונכרנים: 4 מתוך 6/ })).toBeVisible();
});

test("two connections open on their list; a row opens one with its way back", async ({ page }) => {
  await page.goto("/e2e/connections/mercury?state=multi");
  await expect(page.getByText("חיבורים ל־Mercury · 2")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ חיבור Mercury נוסף" })).toBeVisible();
  await page.getByRole("link", { name: /Cedar Lane Holdings LLC/ }).click();
  await expect(page).toHaveURL(/slot=2/);
  await expect(page.getByRole("button", { name: "ניתוק החיבור הזה" })).toBeVisible();
  await page.getByRole("button", { name: "כל חיבורי Mercury" }).click();
  await expect(page.getByText("חיבורים ל־Mercury · 2")).toBeVisible();
});

test("ניתוק happens at once with ביטול, and ביטול brings the connection back (FLOW-975)", async ({ page }) => {
  await page.goto("/e2e/connections/mercury?state=multi");
  await page.getByRole("link", { name: /Cedar Lane Holdings LLC/ }).click();
  await page.getByRole("button", { name: "ניתוק החיבור הזה" }).click();
  // No confirm (decision 0223): the page goes back to the one connection left, and the toast offers ביטול.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Mercury נותק. מה שכבר נכנס נשמר")).toBeVisible();
  await expect(page.getByText("חיבורים ל־Mercury · 2")).toHaveCount(0);
  await page.locator(".ui-toast").getByRole("button", { name: "ביטול" }).click();
  await expect(page.getByText("חיבורים ל־Mercury · 2")).toBeVisible();
});

test("the key's הצגה toggle is a 44px target, and a tap on חיבור with no key says what is missing (FLOW-975)", async ({ page }) => {
  await page.goto("/e2e/connections/mercury?state=new");
  const toggle = page.getByRole("button", { name: "הצגה" });
  expect((await toggle.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: "חיבור" }).click();
  await expect(page.getByText("צריך את המפתח המלא, לפחות 8 תווים")).toBeVisible();
});

test("חיבורים says 2 חיבורים on the Mercury row with two connections", async ({ page }) => {
  await page.goto("/e2e/connections?mercury=2");
  await expect(page.getByRole("link", { name: /Mercury/ })).toContainText("2 חיבורים");
});
