import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

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

/** Line-clamp keeps the text in the DOM, so a text query cannot see a vertical cut. */
async function bannerTitleClipped(page: Page): Promise<boolean> {
  return page.locator(".ui-banner .ui-row-title").evaluate((node) => {
    if (!(node instanceof HTMLElement) || node.parentElement == null) return true;
    const clone = node.cloneNode(true);
    if (!(clone instanceof HTMLElement)) return true;
    clone.style.setProperty("-webkit-line-clamp", "unset");
    clone.style.setProperty("display", "block");
    clone.style.setProperty("overflow", "visible");
    clone.style.setProperty("position", "absolute");
    clone.style.setProperty("visibility", "hidden");
    clone.style.setProperty("width", `${String(node.clientWidth)}px`);
    node.parentElement.append(clone);
    const clipped = clone.getBoundingClientRect().height > node.getBoundingClientRect().height + 1;
    clone.remove();
    return clipped;
  });
}

test("banner wording fits at 320 and 390 in both themes", async ({ page }) => {
  const cases = [
    ["/reviewer/review?banner=assistant", "4 תנועות שויכו היום"],
    ["/reviewer/review?banner=one", "תנועה אחת שויכה היום בלי להמתין בתור"],
    ["/reviewer/review?banner=one-assistant", "תנועה אחת שויכה היום"],
  ] as const;
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const [route, title] of cases) {
        await page.goto(route);
        await expect(page.getByText("נתוני דוגמה · Example data")).toBeVisible();
        const banner = page.locator(".ui-banner");
        await expect(banner).toContainText(title);
        if (!title.includes("בלי להמתין")) await expect(banner).not.toContainText("בלי להמתין");
        if (width === 320) expect(await bannerTitleClipped(page)).toBe(false);
        await expectNoOverflow(page);
      }
    }
  }
  await page.goto("/reviewer/review?banner=assistant");
  await expect(page.getByText("בלי להמתין בתור")).toHaveCount(0);
});

test("the empty filed list says both sources and does not clip", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto("/reviewer/filed?empty=1");
    await expect(page.getByText("אין תנועות ששויכו היום")).toBeVisible();
    await expect(page.getByText("כש־SUMIT משייך תנועה בלי תור, או כשהעוזר מאשר תנועה היום, היא תופיע כאן.")).toBeVisible();
    await expectNoOverflow(page);
  }
});

test("skip, approve, and undo keep the visit index and grow the total", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/reviewer/review");
      await expect(page.getByText("1 מתוך 3")).toBeVisible();
      await page.getByRole("button", { name: "דלג" }).click();
      await expect(page.getByText("2 מתוך 3")).toBeVisible();
      await page.getByRole("button", { name: "דלג" }).click();
      await expect(page.getByText("3 מתוך 3")).toBeVisible();
      await expect(page.getByRole("heading", { name: "צבעי הכרמל בע״מ" })).toBeVisible();
      await page.getByRole("button", { name: "אישור" }).click();
      await expect(page.getByText("הכל מאושר")).toBeVisible();
      await expect(page.getByText("מתוך")).toHaveCount(0);
      await page.locator(".ui-toast button", { hasText: "ביטול" }).click();
      await expect(page.getByRole("heading", { name: "צבעי הכרמל בע״מ" })).toBeVisible();
      await expect(page.getByText("4 מתוך 4")).toBeVisible();
      await expectNoOverflow(page);
    }
  }
});
