import { expect, test } from "@playwright/test";
import { HELP_EMAIL } from "../src/config";

test("preview home is the first-run empty state", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?preview=1");
  await expect(page.getByRole("heading", { name: "חברו את הבנק" })).toBeVisible();
  await expect(page.getByText("שלום", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Flow", { exact: true })).toHaveCount(0);
  await expect(page.getByText("חברו את הבנק")).toBeVisible();
  await expect(page.getByText("עוד אין תנועות. הן יגיעו מהבנק.")).toBeVisible();
  await expect(page.getByRole("link", { name: "חיבור Mercury" })).toHaveAttribute("href", "/settings/connections?preview=1");
  await expect(page.getByText("מצב תצוגה")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "ניווט ראשי" })).toBeVisible();
  // The band reads the month's zero figure, as on the board (FLOW-364).
  await expect(page.getByText("₪0")).toHaveCount(1);
});

test("preview error and loading states are reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?preview=error");
  await expect(page.getByText("אין חיבור לאינטרנט")).toBeVisible();
  await expect(page.getByRole("button", { name: "נסו שוב" })).toBeVisible();
  await expect(page.locator("header.band")).toHaveCount(0);
  await expect(page.getByText("מצב תצוגה")).toHaveCount(0);
  await page.goto("/?preview=error-server");
  await expect(page.getByText("לא הצלחנו לטעון.")).toBeVisible();
  await page.goto("/?preview=loading");
  await expect(page.locator("[aria-busy=true]")).toBeVisible();
  // The loading band stands in for Home's band (FLOW-364).
  await expect(page.locator("[aria-busy=true] .ui-band")).toBeVisible();
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
  expect(motion.drawer?.ease).toBe("cubic-bezier(0.2, 0.8, 0.2, 1)");
  expect(motion.drawer?.transition).toBe("0.28s");
  expect(motion.overlay?.duration).toBe("0.26s");
  expect(motion.overlay?.ease).toBe("linear");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await page.evaluate(() => {
    const drawer = document.querySelector("[data-vaul-drawer]");
    if (!drawer) return null;
    const style = getComputedStyle(drawer);
    return { animation: style.animationDuration, transition: style.transitionDuration };
  });
  if (!reduced) throw new Error("the sheet drawer is missing");
  expect(reduced.animation).toBe("0.001s");
  expect(reduced.transition).toBe("0.001s");
  await expect(page.locator("h2", { hasText: "חברו את הבנק" })).toHaveCount(1);
  // Vaul hides the page behind the sheet from assistive tech. The bar is still on screen.
  await expect(page.locator('nav[aria-label="ניווט ראשי"]')).toBeVisible();
  expect(await page.evaluate(() => (history.state as { idx?: number }).idx)).toBe(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "הוספה" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "חברו את הבנק" })).toBeVisible();
  await expect(page.getByRole("link", { name: "הוספה" })).toBeFocused();
  expect(await page.evaluate(() => (history.state as { idx?: number }).idx)).toBe(0);
  // /projects has no + (FLOW-364): the add is Home's band button only.
  await page.goto("/projects?preview=1");
  await expect(page.getByRole("link", { name: "הוספה" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "פרויקטים" })).toBeVisible();
  await page.goto("/transactions/1?preview=1");
  await expect(page.getByRole("heading", { name: "פרטי תנועה" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "ניווט ראשי" })).toHaveCount(0);
});

test("help links are at least 44px and sign-in help does not grow the stack", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/help");
  const mail = page.getByRole("link", { name: HELP_EMAIL });
  const back = page.getByRole("button", { name: "חזרה" });
  expect((await mail.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  const backBox = await back.boundingBox();
  expect(backBox?.height).toBeGreaterThanOrEqual(44);
  expect(backBox?.width).toBeGreaterThanOrEqual(44);
  await page.goto("/sign-in?error=server_error");
  const help = page.getByRole("link", { name: "צריך עזרה בכניסה?" });
  const box = await help.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  const stack = await help.evaluate((el) => el.parentElement?.getBoundingClientRect().height ?? 0);
  expect(stack).toBeLessThan(32);
});

test("a signed-out deep link to review keeps it for after sign-in; an off-list route does not", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/review");
  await expect(page).toHaveURL(/\/sign-in\?return=%2Freview$/);
  await expect(page.getByRole("heading", { name: "כניסה או הרשמה" })).toBeVisible();
  await page.goto("/install");
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/sign-in?return=%2F%2Fevil.example");
  await expect(page).toHaveURL(/\/sign-in\?return=%2F%2Fevil\.example$/);
  await expect(page.getByRole("heading", { name: "כניסה או הרשמה" })).toBeVisible();
});

test("signed-out home redirects to sign-in", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
  const google = page.getByRole("button", { name: "המשך עם Google" });
  // An empty client disables the button. Local Supabase in CI configures it.
  if (await page.getByText("הגדרת השרת אינה תקינה").count()) {
    await expect(google).toBeDisabled();
  } else {
    await expect(google).toBeEnabled();
  }
  await expect(page.getByRole("link", { name: "תנאי שימוש" })).toBeVisible();
});
