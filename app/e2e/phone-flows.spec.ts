import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * FLOW-804: the five flows the owner uses most, on a touch phone at 390 and 320 wide, on the dev
 * fixtures. Each tap must show its result within 2 seconds. These run on the dev server, whose
 * development React is several times slower than the production build, next to other specs in
 * parallel, so this bound only catches a tap that hangs; the speed limits are perf/page-open.spec.ts
 * (0.7 s) and perf/home-speed.spec.ts (2 s), both on the real build at CPU ×4.
 */
const STEP_MS = 2000;

/** Opens a page and lets the idle preload fetch the other screens, as a phone does after launch. */
async function open(page: Page, path: string, ready: Locator): Promise<void> {
  await page.goto(path);
  await expect(ready).toBeVisible();
  await page.waitForLoadState("networkidle");
}

/** One tap and what it must show, timed from the tap. */
async function step(name: string, tap: () => Promise<void>, shows: Locator | (() => Promise<void>)): Promise<void> {
  const start = Date.now();
  await tap();
  if (typeof shows === "function") await shows();
  else await expect(shows, name).toBeVisible({ timeout: 5000 });
  const elapsed = Date.now() - start;
  expect(elapsed, `${name} took ${String(elapsed)} ms`).toBeLessThanOrEqual(STEP_MS);
}

// The dev server compiles a module on its first request. Visit every page once first, so the
// timed taps measure the app and not that compile.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await browser.newPage();
  for (const path of [
    "/e2e/home?preview=1",
    "/projects/p1?preview=1",
    "/e2e/review",
    "/e2e/change?preview=1",
    "/search?preview=1",
    "/transactions/t-step-3?preview=1",
    "/e2e/split",
  ]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  await page.close();
});

for (const width of [390, 320]) {
  test.describe(`phone ${String(width)} wide`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 693 }, hasTouch: true, isMobile: true });

    test("Home, a project page, and back", async ({ page }) => {
      await open(page, "/e2e/home?preview=1", page.getByRole("navigation", { name: "ניווט ראשי" }));
      const project = page.locator(".ui-project-list").getByRole("link").first();
      // The Home fixture links to the preview project page, which has its own sample title.
      await step("open the project", () => project.tap(), page.getByRole("heading", { name: "פרויקט", exact: true }));
      await expect(page).toHaveURL(/\/projects\/p1\?preview=1$/);
      await step("Back to Home", () => page.getByRole("button", { name: "חזרה" }).tap(), project);
    });

    test("Review: אישור, then ביטול on the toast", async ({ page }) => {
      await open(page, "/e2e/review", page.getByText("1 מתוך 2"));
      await step("approve", () => page.getByRole("button", { name: "אישור" }).tap(), page.getByText("2 מתוך 2"));
      await step("undo", () => page.locator(".ui-toast button", { hasText: "ביטול" }).tap(), page.getByText("1 מתוך 2"));
    });

    test("Review: שינוי, pick a category, save", async ({ page }) => {
      await open(page, "/e2e/change?preview=1", page.getByRole("heading", { name: "שינוי שיוך" }));
      await step(
        "open the categories",
        () => page.getByRole("button", { name: /קטגוריה:/ }).tap(),
        page.getByRole("heading", { name: "בחירת קטגוריה" }),
      );
      await step("pick הובלה", () => page.getByRole("radio", { name: "הובלה" }).tap(), page.locator(".ui-toast").getByText("השיוך נשמר"));
      await expect(page.getByRole("button", { name: /קטגוריה: הובלה/ })).toBeVisible();
    });

    test("Search for a supplier and open the line", async ({ page }) => {
      await open(page, "/e2e/home?preview=1", page.getByRole("link", { name: "חיפוש תנועות" }));
      const field = page.getByRole("searchbox", { name: "חיפוש תנועות" });
      await step("open search", () => page.getByRole("link", { name: "חיפוש תנועות" }).tap(), field);
      const row = page.getByRole("link", { name: /^ספק 3(?!\d)/ });
      await step("type the supplier", () => field.fill("ספק 3"), row);
      await step("open the line", () => row.tap(), page.getByText("ספק 3", { exact: true }));
      await expect(page).toHaveURL(/\/transactions\/t-step-3\?preview=1$/);
    });

    test("Split a line between two projects", async ({ page }) => {
      await open(page, "/e2e/split", page.getByRole("heading", { name: "פיצול בין פרויקטים" }));
      const picker = page.getByRole("dialog", { name: "בחירת פרויקט" });
      await step("add a part", () => page.getByRole("button", { name: "הוספת חלק" }).tap(), picker);
      await step(
        "pick a project",
        () => picker.getByRole("radio", { name: "פרגולה בית כהן" }).tap(),
        page.getByRole("radiogroup", { name: "יחידה, פרגולה בית כהן" }),
      );
      const share = page.getByRole("textbox", { name: "אחוז, פרגולה בית כהן" });
      await step(
        "percent",
        () => page.getByRole("radiogroup", { name: "יחידה, פרגולה בית כהן" }).getByRole("radio", { name: "%" }).tap(),
        share,
      );
      await share.fill("50");
      const saved = page.locator("#e2e-split-saved");
      await step("save", () => page.getByRole("button", { name: "סגירה" }).tap(), () => expect(saved).not.toHaveText(""));
    });
  });
}
