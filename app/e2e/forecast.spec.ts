import { expect, test } from "@playwright/test";

// FLOW-403 (plan option A): Home's late-bills row opens the list, a row opens Search on that
// supplier; the project's "צפוי" month opens the sheet of who makes it up. Invented data only.
test.use({ viewport: { width: 375, height: 667 } });

test("Home: the late-bills row opens the list at its לא הגיעו section", async ({ page }) => {
  await page.goto("/e2e/cash?preview=1&recurring=1");
  const row = page.getByRole("link", { name: "2 חשבונות לא הגיעו" });
  await expect(row).toBeVisible();
  // A count only: no total on the row.
  await expect(row).not.toContainText("₪");
  await row.click();
  // FLOW-415 (b-2): the קבועים screen, at its לא הגיעו section.
  await expect(page).toHaveURL(/\/e2e\/recurring\?preview=1#late$/);
  await expect(page.getByRole("heading", { name: "קבועים" })).toBeVisible();
  const late = page.locator("section", { has: page.getByRole("heading", { name: "לא הגיעו" }) });
  await expect(late.locator("li")).toHaveCount(2);
  // FLOW-447: the row says how many days late the bill is, counted from its usual day.
  await expect(late.locator("li").first()).toContainText("באיחור");
});

test("קבועים: a charge up 20% or more shows its change as the bad-news hint", async ({ page }) => {
  await page.goto("/e2e/recurring?preview=1");
  await expect(page.getByText("▲ 38%", { exact: true })).toBeVisible();
});

test("קבועים opens from the band's icon, with a dot for late bills, and goes back to Home (FLOW-986)", async ({ page }) => {
  await page.goto("/e2e/cash?preview=1&recurring=1");
  const bar = page.getByRole("navigation", { name: "ניווט ראשי" });
  await expect(bar.getByRole("link", { name: "קבועים" })).toHaveCount(0);
  const icon = page.getByRole("link", { name: "קבועים, 2 לא הגיעו" });
  // The band sits on a fractional offset: 44px can measure 43.99999.
  expect(Math.round((await icon.boundingBox())?.height ?? 0)).toBeGreaterThanOrEqual(44);
  await icon.click();
  await expect(page).toHaveURL(/\/e2e\/recurring\?preview=1$/);
  await expect(page.getByRole("heading", { name: "קבועים" })).toBeVisible();
  await expect(bar.getByRole("link", { name: "בית", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: /חזרה/ }).first().click();
  await expect(page).toHaveURL(/\/e2e\/cash\?preview=1&recurring=1$/);
});

test("קבועים on one project shows only its rows and names it (FLOW-424)", async ({ page }) => {
  await page.goto("/e2e/recurring?preview=1&project=p-birch-lane");
  await expect(page.getByRole("heading", { name: "קבועים" })).toBeVisible();
  await expect(page.locator(".ui-recurring-head").getByText("Birch Lane", { exact: true })).toBeVisible();
  await expect(page.locator(".ui-recurring li")).toHaveCount(4);
  await expect(page.getByText("Juniper Pointe HOA")).toHaveCount(0);
});

test("צפי: opening the small charges shows every one of them, not just the first", async ({ page }) => {
  await page.goto("/e2e/forecast?preview=1&kind=board");
  const group = page.getByRole("button", { name: /חיובים קבועים קטנים/ });
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".ui-forecast-small-list > li")).toHaveCount(11);
  // The rows open inside the group's own li: it must grow to hold them, not clip them under the button.
  const li = page.locator(".ui-forecast-li-group");
  const { client, scroll } = await li.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }));
  expect(scroll).toBeGreaterThan(200);
  expect(client).toBeGreaterThanOrEqual(scroll);
});

test("תזרים צפוי: the title, the month's end, the card's whole sum and the chart in progress (spec-cash2)", async ({ page }) => {
  await page.goto("/e2e/forecast?preview=1&kind=board");
  await expect(page.getByRole("heading", { level: 1, name: "תזרים צפוי" })).toBeVisible();
  await expect(page.locator(".ui-forecast-big")).toHaveText("−$5,741");
  // Today's figure lives in the card: the sum from today to the month's end, top to bottom.
  await expect(page.locator(".ui-forecast-today")).toHaveCount(0);
  const card = page.locator(".ui-forecast-fc .ui-fc-card");
  await expect(card.locator(".ui-fc-start")).toHaveText("תזרים היום−$17,191");
  await expect(card.locator(".ui-fc-col").first()).toContainText("+$19,750");
  await expect(card.locator(".ui-fc-col").nth(1)).toContainText("$8,300");
  await expect(card.locator(".ui-fc-net-strong")).toHaveText("תזרים בסוף אוקטובר−$5,741");
  const chart = page.getByRole("img", { name: /^נכנס ויצא לפי חודש, מאי עד סוף אוקטובר\. אוקטובר עד היום/ });
  await expect(chart).toBeVisible();
  await expect(chart.locator(".ui-fc-now .ui-fc-cap")).toHaveCount(2);
  // FLOW-970: the chart's heading is where the month ends, and the view chips are 44px.
  await expect(page.getByRole("heading", { level: 2, name: /^אוקטובר צפוי להיסגר ב־/ })).toContainText("−$5,741");
  for (const name of ["לפי פריט", "לפי קטגוריה"]) {
    expect((await page.getByRole("radio", { name }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  // The card is not a control: the list is right below it.
  await expect(card.locator("a, button")).toHaveCount(0);
  // A row's page goes back to תזרים צפוי.
  await page.getByRole("button", { name: /^Northgate Co,/ }).click();
  const back = page.getByRole("button", { name: "חזרה לתזרים צפוי" });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/e2e\/forecast\?preview=1&kind=board$/);
});
