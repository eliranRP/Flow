import { expect, test } from "@playwright/test";
import { HELP_EMAIL } from "../src/config";

test("preview home is the first-run empty state", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?preview=1");
  await expect(page.getByRole("heading", { name: "כאן יופיע הרווח הנקי של העסק" })).toBeVisible();
  await expect(page.getByText("שלום", { exact: true })).toBeVisible();
  await expect(page.getByText("עוד אין נתונים")).toBeVisible();
  await expect(page.getByRole("link", { name: "חיבור SUMIT" })).toBeVisible();
  await expect(page.getByText("מצב תצוגה")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "ניווט ראשי" })).toBeVisible();
  await expect(page.getByText("₪0")).toHaveCount(0);
});

test("preview error and loading states are reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?preview=error");
  await expect(page.getByText("אין חיבור לאינטרנט")).toBeVisible();
  await expect(page.getByRole("button", { name: "ניסיון חוזר" })).toBeVisible();
  await expect(page.locator("header.band")).toHaveCount(0);
  await expect(page.getByText("מצב תצוגה")).toHaveCount(0);
  await page.goto("/?preview=error-server");
  await expect(page.getByText("לא הצלחנו לטעון את הנתונים")).toBeVisible();
  await page.goto("/?preview=loading");
  await expect(page.locator("[aria-busy=true]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "פרויקטים מובילים" })).toBeVisible();
});

test("add is a sheet over Home and transaction detail has no tab bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?preview=1");
  expect(await page.evaluate(() => (history.state as { idx?: number }).idx)).toBe(0);
  await page.getByRole("link", { name: "הוספה" }).click();
  await expect(page.getByRole("dialog", { name: "הוספה" })).toBeVisible();
  const motion = await page.evaluate(() => {
    const drawer = document.querySelector("[data-vaul-drawer]");
    const overlay = document.querySelector("[data-vaul-overlay]");
    const read = (el: Element | null) => {
      if (!el) return null;
      const style = getComputedStyle(el);
      return { duration: style.animationDuration, ease: style.animationTimingFunction, transition: style.transitionDuration };
    };
    return { drawer: read(drawer), overlay: read(overlay) };
  });
  expect(motion.drawer?.duration).toBe("0.28s");
  expect(motion.drawer?.ease).toBe("cubic-bezier(0.2, 0, 0, 1)");
  expect(motion.drawer?.transition).toBe("0.28s");
  expect(motion.overlay?.duration).toBe("0.28s");
  expect(motion.overlay?.ease).toBe("cubic-bezier(0.2, 0, 0, 1)");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await page.evaluate(() => getComputedStyle(document.querySelector("[data-vaul-drawer]")!).animationDuration);
  expect(reduced).toBe("0.001s");
  await expect(page.locator("h1", { hasText: "כאן יופיע הרווח הנקי של העסק" })).toHaveCount(1);
  // Vaul hides the page behind the sheet from assistive tech. The bar is still on screen.
  await expect(page.locator('nav[aria-label="ניווט ראשי"]')).toBeVisible();
  expect(await page.evaluate(() => (history.state as { idx?: number }).idx)).toBe(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "הוספה" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "כאן יופיע הרווח הנקי של העסק" })).toBeVisible();
  await expect(page.getByRole("link", { name: "הוספה" })).toBeFocused();
  expect(await page.evaluate(() => (history.state as { idx?: number }).idx)).toBe(0);
  await page.goto("/projects?preview=1");
  await page.getByRole("link", { name: "הוספה" }).click();
  await expect(page.getByRole("dialog", { name: "הוספה" })).toBeVisible();
  await expect(page.locator("h1", { hasText: "פרויקטים" })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "הוספה" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "פרויקטים" })).toBeVisible();
  await expect(page).toHaveURL(/\/projects\?preview=1/);
  await page.goto("/transactions/1?preview=1");
  await expect(page.getByRole("heading", { name: "פרטי תנועה" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "ניווט ראשי" })).toHaveCount(0);
});

test("help links are at least 44px and sign-in help does not grow the stack", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/help");
  const mail = page.getByRole("link", { name: HELP_EMAIL });
  const back = page.getByRole("link", { name: "חזרה" });
  expect((await mail.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect((await back.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await page.goto("/sign-in?error=server_error");
  const help = page.getByRole("link", { name: "צריך עזרה בכניסה?" });
  const box = await help.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  const stack = await help.evaluate((el) => el.parentElement?.getBoundingClientRect().height ?? 0);
  expect(stack).toBeLessThan(32);
});

test("signed-out home redirects to sign-in", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("button", { name: "המשך עם Google" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "תנאי שימוש" })).toBeVisible();
});
