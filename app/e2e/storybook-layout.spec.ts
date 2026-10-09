import { expect, test, type Page } from "@playwright/test";

type StoryEntry = {
  id: string;
  type: string;
  title: string;
  name: string;
  tags?: string[];
};

type StoryIndex = {
  entries: Record<string, StoryEntry>;
};

const widths = [390, 320];

/** A missing edge stays NaN, so a short list does not fail the slack check. */
function edgeDelta(left: readonly number[], right: readonly number[]): number {
  return Math.max(...left.map((value, index) => {
    const other = right[index];
    return other === undefined ? Number.NaN : Math.abs(value - other);
  }));
}

function isStressStory(story: StoryEntry): boolean {
  if (story.type !== "story") return false;
  if (story.name === "Long Hebrew" || story.name === "Large Amount") return true;
  return story.name === "List Of Rows" || story.name === "Home Books Month" || story.name === "Home Loading";
}

async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const root = document.querySelector("#storybook-root");
    if (!(root instanceof HTMLElement)) return ["missing story root"];
    const view = document.documentElement;
    if (view.scrollWidth > view.clientWidth + 1) {
      problems.push(`page overflows by ${String(view.scrollWidth - view.clientWidth)}px`);
    }
    const rootBox = root.getBoundingClientRect();
    if (rootBox.top < -1) problems.push("story starts above the viewport");
    const offenders: string[] = [];
    for (const node of root.querySelectorAll("*")) {
      if (!(node instanceof HTMLElement)) continue;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (style.position === "fixed") continue;
      const box = node.getBoundingClientRect();
      if (box.width < 1 && box.height < 1) continue;
      const pastEnd = box.right - rootBox.right;
      const pastStart = rootBox.left - box.left;
      if (pastEnd > 1 || pastStart > 1) {
        const name = typeof node.className === "string" && node.className ? node.className : node.tagName;
        offenders.push(`${name} +${String(Math.round(Math.max(pastEnd, pastStart)))}px`);
      }
    }
    if (offenders.length > 0) problems.push(`overflow: ${offenders.slice(0, 6).join("; ")}`);

    const word = document.querySelector(".text-wordmark");
    const pill = document.querySelector(".ui-band-period");
    if (word instanceof HTMLElement && pill instanceof HTMLElement) {
      const a = word.getBoundingClientRect();
      const b = pill.getBoundingClientRect();
      const separated = a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5;
      if (!separated) problems.push("period pill overlaps the wordmark");
    }

    const singleLine = document.querySelectorAll(".ui-period-label, .ui-chip-label, .ui-pill-label, .ui-text-link-label, .ui-seg-btn, .ui-seg-label");
    for (const node of singleLine) {
      if (!(node instanceof HTMLElement)) continue;
      const style = getComputedStyle(node);
      if (!style.whiteSpace.includes("nowrap")) problems.push(`${node.className || node.tagName} is not a single line`);
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()];
      if (rects.length > 0) {
        const span = Math.max(...rects.map((rect) => rect.bottom)) - Math.min(...rects.map((rect) => rect.top));
        const line = Number.parseFloat(style.lineHeight) || rects[0]?.height || 0;
        if (line > 0 && span > line * 1.4) problems.push(`${node.className || node.tagName} wraps`);
      }
    }

    const chevron = document.querySelector(".ui-period-chevron");
    if (pill instanceof HTMLElement && chevron instanceof HTMLElement) {
      const host = pill.getBoundingClientRect();
      const box = chevron.getBoundingClientRect();
      if (box.width < 8 || box.left < host.left - 1 || box.right > host.right + 1) problems.push("period chevron is clipped");
    }

    const title = document.querySelector(".ui-budget-title");
    if (title instanceof HTMLElement) {
      const line = Number.parseFloat(getComputedStyle(title).lineHeight);
      if (Number.isFinite(line) && title.getBoundingClientRect().height > line * 2.4) {
        problems.push("budget title is more than 2 lines");
      }
    }
    for (const amount of document.querySelectorAll(".ui-budget-amounts bdi, .ui-num")) {
      if (!(amount instanceof HTMLElement)) continue;
      const style = getComputedStyle(amount);
      const line = Number.parseFloat(style.lineHeight);
      if (style.whiteSpace !== "nowrap") problems.push("an amount can break inside the number");
      if (Number.isFinite(line) && amount.scrollHeight > line * 1.6) problems.push("an amount wraps onto a second line");
    }

    const sheetTitle = document.querySelector(".ui-sheet-head .t-title-2");
    if (sheetTitle instanceof HTMLElement) {
      const line = Number.parseFloat(getComputedStyle(sheetTitle).lineHeight);
      if (Number.isFinite(line) && sheetTitle.getBoundingClientRect().height > line * 2.4) {
        problems.push("sheet title is more than 2 lines");
      }
    }
    const emptyTitle = document.querySelector(".ui-empty-title");
    if (emptyTitle instanceof HTMLElement) {
      const line = Number.parseFloat(getComputedStyle(emptyTitle).lineHeight);
      if (Number.isFinite(line) && emptyTitle.getBoundingClientRect().height > line * 2.4) {
        problems.push("empty title is more than 2 lines");
      }
    }
    const emptyLine = document.querySelector(".ui-empty-line");
    if (emptyLine instanceof HTMLElement) {
      const line = Number.parseFloat(getComputedStyle(emptyLine).lineHeight);
      if (Number.isFinite(line) && emptyLine.getBoundingClientRect().height > line * 3.4) {
        problems.push("empty line is more than 3 lines");
      }
    }

    const bandLabel = document.querySelector(".ui-band-label");
    const band = document.querySelector(".ui-band");
    if (bandLabel instanceof HTMLElement && band instanceof HTMLElement) {
      const labelBox = bandLabel.getBoundingClientRect();
      const bandBox = band.getBoundingClientRect();
      if (labelBox.top < 0 || labelBox.top < bandBox.top - 1 || labelBox.bottom > bandBox.bottom + 1) {
        problems.push("the band label is clipped");
      }
    }
    return problems;
  });
}

test("the Home attention card rows stay inside 320 and 390, light and dark (FLOW-321)", async ({ page }) => {
  test.setTimeout(120_000);
  const cases = [
    ["screens-routes--home-attention-both", ["7 פריטים ממתינים לאישור", "3 חשבוניות לא שולמו"], 2],
    ["screens-routes--home-attention-singular", ["פריט אחד ממתין לאישור", "חשבונית אחת לא שולמה"], 2],
    ["screens-routes--home-attention-review-only", ["7 פריטים ממתינים לאישור"], 0],
    ["screens-routes--home-attention-unpaid-only", ["3 חשבוניות לא שולמו"], 0],
    ["components-banner--rows-long-hebrew", [], 2],
  ] as const;
  const failures: string[] = [];
  for (const theme of ["light", "dark"]) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      for (const [id, names, rowCount] of cases) {
        const globals = theme === "dark" ? "&globals=theme:dark" : "";
        await page.goto(`/iframe.html?id=${id}&viewMode=story${globals}`, { waitUntil: "domcontentloaded" });
        await page.locator("#storybook-root").waitFor({ state: "attached" });
        for (const name of names) await expect(page.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
        const rows = page.locator(".ui-banner-rows a");
        await expect(rows).toHaveCount(rowCount);
        const problems = await layoutProblems(page);
        const clipped = await page.locator(".ui-banner-row .ui-row-title").evaluateAll((nodes) =>
          nodes.filter((node) => node.scrollHeight > node.clientHeight + 1).map((node) => node.textContent));
        // The long-Hebrew story clamps on purpose; real Home titles must fit.
        if (id.startsWith("screens-routes")) problems.push(...clipped.map((title) => `row title clipped: ${title}`));
        if (problems.length > 0) failures.push(`${theme} ${String(width)} ${id}: ${problems.join(" | ")}`);
      }
    }
  }
  expect(failures, failures.join("\n")).toEqual([]);
});

test("the split-by-category stories stay inside 320 and 390, light and dark (FLOW-325)", async ({ page }) => {
  test.setTimeout(180_000);
  const index = (await (await page.request.get("/index.json")).json()) as StoryIndex;
  const stories = Object.values(index.entries).filter(
    (story) => story.type === "story" && story.id.startsWith("screens-line-split--") && !/dark|320/i.test(story.id),
  );
  expect(stories.length).toBeGreaterThanOrEqual(8);
  const failures: string[] = [];
  for (const theme of ["light", "dark"]) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      for (const story of stories) {
        const globals = theme === "dark" ? "&globals=theme:dark" : "";
        await page.goto(`/iframe.html?id=${story.id}&viewMode=story${globals}`, { waitUntil: "domcontentloaded" });
        await page.locator("#storybook-root").waitFor({ state: "attached" });
        await page.waitForTimeout(400);
        const problems = await layoutProblems(page);
        const clipped = await page.locator(".ui-lsplit-name, .ui-lsplit-project, .ui-lsplit-msg").evaluateAll((nodes) =>
          nodes.filter((node) => node instanceof HTMLElement && node.getClientRects().length > 0 && node.getBoundingClientRect().width < 24).map((node) => node.textContent));
        problems.push(...clipped.map((text) => `squeezed: ${text}`));
        if (problems.length > 0) failures.push(`${theme} ${String(width)} ${story.id}: ${problems.join(" | ")}`);
      }
    }
  }
  expect(failures, failures.join("\n")).toEqual([]);
});

test("the closed period picker is only the band and the on-band pill", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/iframe.html?id=components-periodpicker--closed&viewMode=story", { waitUntil: "domcontentloaded" });
  await page.locator(".ui-band-period").waitFor();
  await expect(page.locator("[role=dialog]")).toHaveCount(0);
  await expect(page.locator("[data-vaul-overlay]")).toHaveCount(0);
  await expect(page.locator(".ui-band-label")).toHaveCount(0);
  const paint = await page.locator(".ui-band-period").evaluate((el) => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, color: style.color };
  });
  expect(paint.background).toBe("rgb(255, 255, 255)");
  expect(paint.color).toBe("rgb(29, 23, 40)");
  const clipped = await page.locator(".ui-band").evaluate((el) => el.getBoundingClientRect().top < -1);
  expect(clipped).toBe(false);
});

test("long hebrew and large amount stories stay inside 390 and 320", async ({ page }) => {
  test.setTimeout(180_000);
  const index = (await (await page.request.get("/index.json")).json()) as StoryIndex;
  const stories = Object.values(index.entries).filter(isStressStory);
  expect(stories.length).toBeGreaterThan(15);

  const failures: string[] = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    for (const story of stories) {
      await page.goto(`/iframe.html?id=${story.id}&viewMode=story`, { waitUntil: "domcontentloaded" });
      await page.locator("#storybook-root").waitFor({ state: "attached" });
      await page.waitForTimeout(80);
      const problems = await layoutProblems(page);
      if (problems.length > 0) failures.push(`${String(width)}px ${story.title} / ${story.name}: ${problems.join(" | ")}`);
    }
  }
  expect(failures, failures.join("\n")).toEqual([]);
});

test("the project search stories stay inside 320 and 390, light and dark", async ({ page }) => {
  test.setTimeout(120_000);
  const failures: string[] = [];
  for (const theme of ["light", "dark"]) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      for (const id of ["screens-routes--projects-search", "screens-routes--projects-many-active"]) {
        const globals = theme === "dark" ? "&globals=theme:dark" : "";
        await page.goto(`/iframe.html?id=${id}&viewMode=story${globals}`, { waitUntil: "domcontentloaded" });
        await page.locator("#storybook-root").waitFor({ state: "attached" });
        if (id.endsWith("search")) {
          // The play types תמר: the active and the finished match both show, and the finished one says so.
          await expect(page.getByRole("link", { name: /^בית תמר/ })).toBeVisible();
          await expect(page.getByRole("link", { name: /^מחסן תמר/ })).toContainText("הסתיים");
          await expect(page.getByRole("link", { name: /^בית ארז/ })).toHaveCount(0);
        } else {
          await expect(page.getByRole("link", { name: /^בית כלנית/ })).toBeVisible();
          await expect(page.getByRole("link", { name: /^מחסן תמר/ })).toHaveCount(0);
        }
        const problems = await layoutProblems(page);
        if (problems.length > 0) failures.push(`${theme} ${String(width)} ${id}: ${problems.join(" | ")}`);
      }
    }
  }
  expect(failures, failures.join("\n")).toEqual([]);
});

test("the assistant settings stories stay inside 320, 360, and 390", async ({ page }) => {
  test.setTimeout(180_000);
  const stories = [
    "screens-routes--connections-assistant-empty",
    "screens-routes--connections-assistant-loading",
    "screens-routes--connections-assistant-error",
    "screens-routes--connections-assistant-expired",
    "screens-routes--connections-assistant-no-company",
    "screens-routes--connections-assistant-connected",
    "screens-routes--settings-assistant-scope",
    "screens-routes--settings-assistant-secret",
    "screens-routes--settings-assistant-help",
    "screens-routes--settings-assistant-used",
    "screens-routes--settings-assistant-unused",
  ];
  const failures: string[] = [];
  for (const theme of ["light", "dark"]) {
    for (const width of [320, 360, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const id of stories) {
        const globals = theme === "dark" ? "&globals=theme:dark" : "";
        await page.goto(`/iframe.html?id=${id}&viewMode=story${globals}`, { waitUntil: "domcontentloaded" });
        await page.locator("#storybook-root").waitFor({ state: "attached" });
        if (id.endsWith("scope") || id.endsWith("secret") || id.endsWith("help") || id.endsWith("used") || id.endsWith("unused")) {
          await page.locator(".ui-sheet-panel").last().waitFor({ state: "visible" });
        }
        const problems = await page.evaluate(() => {
          const roots = [document.querySelector("#storybook-root"), ...document.querySelectorAll(".ui-sheet-panel")].filter((node) => node instanceof HTMLElement);
          const problems: string[] = [];
          const seen = new Set<Element>();
          for (const root of roots) {
            for (const node of root.querySelectorAll(".ui-row-title, .ui-row-hint, .t-hint, .ui-field-label, .t-title-2, .ui-section-title, .ui-btn-label, p")) {
              if (!(node instanceof HTMLElement) || seen.has(node)) continue;
              seen.add(node);
              const style = getComputedStyle(node);
              if (style.display === "none" || style.visibility === "hidden") continue;
              if (node.classList.contains("sr-only")) continue;
              if (node.getClientRects().length === 0) continue;
              const box = node.getBoundingClientRect();
              if (box.width <= 1 && box.height <= 1) continue;
              const overflow = node.scrollWidth - node.clientWidth;
              if (overflow > 1) {
                const text = node.innerText.trim().replace(/\s+/g, " ").slice(0, 48);
                problems.push(`${node.className || node.tagName} "${text}" +${String(overflow)}px`);
              }
            }
          }
          return problems;
        });
        if (problems.length > 0) failures.push(`${theme} ${String(width)} ${id}: ${problems.join(" | ")}`);
      }
    }
  }
  expect(failures, failures.join("\n")).toEqual([]);
});

test("sheet titles stay on screen at 320 and 390", async ({ page }) => {
  const cases = [
    ["screens-routes--change-sheet", "שינוי שיוך"],
    ["screens-routes--change-project-picker", "בחירת פרויקט"],
    ["components-periodpicker--range", "טווח מותאם"],
  ] as const;
  const viewports = [
    { width: 320, height: 693 },
    { width: 390, height: 844 },
  ] as const;
  for (const [id, title] of cases) {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(`/iframe.html?id=${id}&viewMode=story`, { waitUntil: "domcontentloaded" });
      const heading = page.getByRole("heading", { name: title });
      await expect(heading).toBeVisible();
      await expect(async () => {
        const box = await heading.boundingBox();
        expect(box, `${title} at ${String(viewport.width)}`).not.toBeNull();
        if (!box) return;
        expect(box.y, `${title} title top at ${String(viewport.width)}`).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height, `${title} title bottom at ${String(viewport.width)}`).toBeLessThanOrEqual(viewport.height);
        const panelTop = await page.locator(".ui-sheet-panel").evaluate((node) => node.getBoundingClientRect().top);
        expect(panelTop, `${title} sheet cap at ${String(viewport.width)}`).toBeGreaterThanOrEqual(55);
      }).toPass();
    }
  }
});

test("the install screen pins the action under the icon", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/iframe.html?id=screens-routes--install-iphone&viewMode=story", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("img", { name: "Flow" })).toBeVisible();
  await expect(page.getByRole("button", { name: "סגירה" })).toBeVisible();
  const action = page.getByRole("button", { name: "הבנתי" });
  await expect(action).toBeVisible();
  const box = await action.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.y + box.height).toBeGreaterThan(760);
  expect(box.y + box.height).toBeLessThanOrEqual(844);

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/iframe.html?id=screens-routes--install-iphone&viewMode=story", { waitUntil: "domcontentloaded" });
  const title = page.getByRole("heading", { name: "הוספה למסך הבית" });
  const lines = await title.evaluate((node) => node.getClientRects().length);
  expect(lines).toBe(1);
});

test("the primary action stays above the tab bar on a crowded review card", async ({ page }) => {
  const viewports = [
    { width: 320, height: 693 },
    { width: 390, height: 844 },
  ] as const;
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/iframe.html?id=screens-routes--review-missing-project&viewMode=story", { waitUntil: "domcontentloaded" });
    // With no project the primary action reads בחירת פרויקט (decision 0091).
    const approve = page.getByRole("button", { name: "בחירת פרויקט", exact: true });
    await expect(approve).toBeVisible();
    const approveBox = await approve.boundingBox();
    const tabBox = await page.locator(".ui-tabbar").boundingBox();
    expect(approveBox, `אישור box at ${String(viewport.width)}`).not.toBeNull();
    expect(tabBox, `tab bar at ${String(viewport.width)}`).not.toBeNull();
    if (!approveBox || !tabBox) return;
    expect(approveBox.y, `אישור top at ${String(viewport.width)}`).toBeGreaterThanOrEqual(0);
    expect(approveBox.y + approveBox.height, `אישור bottom at ${String(viewport.width)}×${String(viewport.height)}`).toBeLessThanOrEqual(tabBox.y + 1);
  }
});

test("the primary action stays above the tab bar on a list card with a long supplier, a banner, a split, and a note", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 693 });
  await page.goto("/iframe.html?id=screens-routes--review-fold-stress&viewMode=story", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "חומרי בניין והובלות השרון בע״מ" })).toBeVisible();
  await expect(page.getByText("14 מתוך 15")).toBeVisible();
  await expect(page.getByRole("button", { name: "קטגוריה: לא נבחר" })).toBeVisible();
  await expect(page.getByRole("button", { name: "פרויקט: מפוצל · 2 פרויקטים" })).toBeVisible();
  // With no category the primary action reads בחירת קטגוריה (decision 0091).
  const approve = page.getByRole("button", { name: "בחירת קטגוריה", exact: true });
  await expect(approve).toBeVisible();
  const approveBox = await approve.boundingBox();
  const tabBox = await page.locator(".ui-tabbar").boundingBox();
  expect(approveBox).not.toBeNull();
  expect(tabBox).not.toBeNull();
  if (!approveBox || !tabBox) return;
  expect(approveBox.y + approveBox.height).toBeLessThanOrEqual(tabBox.y + 1);
});

test("change sheet picks a project and a category without a summary save", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/iframe.html?id=screens-routes--change-sheet&viewMode=story", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "פרויקט: בניין מגורים חולון, שינוי" }).click();
  await expect(page.getByRole("heading", { name: "בחירת פרויקט" })).toBeVisible();
  await page.getByRole("radio", { name: "וילה רעננה" }).click();
  await expect(page.getByRole("heading", { name: "שינוי שיוך" })).toBeVisible();
  await expect(page.getByRole("button", { name: "פרויקט: וילה רעננה, שינוי" })).toBeVisible();
  await page.getByRole("button", { name: "קטגוריה: חומרים, שינוי" }).click();
  await expect(page.getByRole("heading", { name: "בחירת קטגוריה" })).toBeVisible();
  await page.getByRole("radio", { name: "הובלה" }).click();
  await expect(page.getByRole("button", { name: "קטגוריה: הובלה, שינוי" })).toBeVisible();
  await expect(page.getByRole("button", { name: "שמירה ואישור" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "שינוי שיוך" })).toBeVisible();
});

test("the whole-period option stays inside the sheet and nothing uses a native title", async ({ page }) => {
  const viewports = [
    { width: 320, height: 693 },
    { width: 390, height: 844 },
  ] as const;
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/iframe.html?id=components-periodpicker--open&viewMode=story", { waitUntil: "domcontentloaded" });
    const option = page.getByRole("radio", { name: "כל התקופה" });
    await expect(option).toBeVisible();
    await expect(async () => {
      const box = await option.boundingBox();
      expect(box, `כל התקופה at ${String(viewport.width)}`).not.toBeNull();
      if (!box) return;
      expect(box.y, `option top at ${String(viewport.width)}`).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, `option bottom at ${String(viewport.width)}`).toBeLessThanOrEqual(viewport.height);
    }).toPass();
    expect(await page.locator("#storybook-root [title]").count()).toBe(0);
  }
});

test("loading band skeletons stay inside the gutter and do not touch", async ({ page }) => {
  const index = (await (await page.request.get("/index.json")).json()) as StoryIndex;
  const stories = Object.values(index.entries).filter(
    (story) => story.type === "story" && story.name.includes("Loading"),
  );
  expect(stories.length).toBeGreaterThan(2);
  const viewports = [
    { width: 320, height: 693 },
    { width: 390, height: 844 },
  ] as const;
  const failures: string[] = [];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const story of stories) {
      await page.goto(`/iframe.html?id=${story.id}&viewMode=story`, { waitUntil: "domcontentloaded" });
      await page.locator("#storybook-root").waitFor({ state: "attached" });
      const problems = await page.evaluate(() => {
        const band = document.querySelector(".ui-band");
        if (!(band instanceof HTMLElement)) return [];
        const hero = band.querySelector(".ui-band-hero");
        if (!(hero instanceof HTMLElement)) return [`${location.pathname} band has no hero`];
        const heroBox = hero.getBoundingClientRect();
        const style = getComputedStyle(hero);
        const content = {
          left: heroBox.left + (Number.parseFloat(style.paddingLeft) || 0),
          right: heroBox.right - (Number.parseFloat(style.paddingRight) || 0),
          top: heroBox.top + (Number.parseFloat(style.paddingTop) || 0),
          bottom: heroBox.bottom - (Number.parseFloat(style.paddingBottom) || 0),
        };
        const bars = [...band.querySelectorAll(".ui-skeleton-bar, .ui-skeleton-bar-band")]
          .filter((node): node is HTMLElement => node instanceof HTMLElement)
          .map((node) => node.getBoundingClientRect())
          .filter((box) => box.width > 1 && box.height > 1);
        const found: string[] = [];
        bars.forEach((box, index) => {
          if (box.left < content.left - 0.5 || box.right > content.right + 0.5 || box.top < content.top - 0.5 || box.bottom > content.bottom + 0.5) {
            found.push(`bar ${String(index)} is outside the band content`);
          }
          for (let other = index + 1; other < bars.length; other += 1) {
            const next = bars[other];
            if (!next) continue;
            const near = 0.5;
            const hits = box.left < next.right + near && box.right > next.left - near && box.top < next.bottom + near && box.bottom > next.top - near;
            if (hits) found.push(`bar ${String(index)} intersects bar ${String(other)}`);
          }
        });
        const label = band.querySelector(".ui-preview-banner");
        if (label instanceof HTMLElement && bars.length > 0) {
          const range = document.createRange();
          range.selectNodeContents(label);
          const textBox = range.getBoundingClientRect();
          const lowest = Math.max(...bars.map((box) => box.bottom));
          if (textBox.top < lowest + 8) found.push("preview label is jammed against the bars");
        }
        return found;
      });
      for (const problem of problems) failures.push(`${String(viewport.width)} ${story.name}: ${problem}`);
    }
  }
  expect(failures, failures.join("\n")).toEqual([]);
});

test("a row tint is wider than its content by the spacing token on both sides", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const cases: Array<{ id: string; selector: string; hover: boolean; name?: string }> = [
    { id: "components-listrow--hover", selector: ".ui-show-hover .ui-row", hover: false },
    { id: "components-listrow--project", selector: ".ui-row", hover: true },
    { id: "components-radiorow--idle", selector: ".ui-radio-row", hover: true },
    { id: "components-radiorow--selected", selector: ".ui-radio-row", hover: false },
    { id: "components-reviewcard--suggestion", selector: ".ui-review-ai .ui-row", hover: true },
    { id: "screens-routes--settings-business-row", selector: "a.ui-row", name: "קטגוריות", hover: true },
  ];
  const failures: string[] = [];
  for (const item of cases) {
    await page.goto(`/iframe.html?id=${item.id}&viewMode=story`, { waitUntil: "domcontentloaded" });
    const row = page.locator(item.selector).filter(item.name ? { hasText: item.name } : {}).first();
    await expect(row).toBeVisible();
    if (item.hover) await row.hover();
    const problem = await row.evaluate((node) => {
      const content = node.getBoundingClientRect();
      const tint = getComputedStyle(node, "::before");
      const left = Number.parseFloat(tint.left);
      const right = Number.parseFloat(tint.right);
      const token = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--space-3"));
      if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(token)) return "tint insets are not a length";
      const slack = 0.6;
      const pastStart = -left;
      const pastEnd = -right;
      if (Math.abs(pastStart - token) > slack) return `inline start extends ${String(pastStart)}px, token is ${String(token)}px`;
      if (Math.abs(pastEnd - token) > slack) return `inline end extends ${String(pastEnd)}px, token is ${String(token)}px`;
      if (tint.backgroundColor === "rgba(0, 0, 0, 0)") return "tint is transparent";
      const border = Number.parseFloat(getComputedStyle(node).borderTopWidth) + Number.parseFloat(getComputedStyle(node).borderBottomWidth);
      const block = Number.parseFloat(tint.height);
      if (Math.abs(block - (content.height - border)) > 1.5) return "tint block size does not match the row";
      return "";
    });
    if (problem) failures.push(`${item.id}: ${problem}`);
    if (item.hover || item.id === "components-radiorow--selected") {
      const read = () => row.evaluate((node) => {
        const content = node.getBoundingClientRect();
        const tint = getComputedStyle(node, "::before");
        const style = getComputedStyle(node);
        const left = Number.parseFloat(tint.left);
        const right = Number.parseFloat(tint.right);
        const top = Number.parseFloat(tint.top);
        const bottom = Number.parseFloat(tint.bottom);
        return {
          tint: [content.left + left, content.right - right, content.top + top, content.bottom - bottom],
          box: [content.left, content.right, content.top, content.bottom],
          geometry: [style.margin, style.padding, style.borderWidth, style.transform, style.borderRadius],
          color: tint.backgroundColor,
          outline: style.outlineStyle,
        };
      });
      const hovered = await read();
      const spot = await row.boundingBox();
      if (!spot) failures.push(`${item.id}: missing box`);
      else {
        await page.mouse.move(spot.x + spot.width / 2, spot.y + spot.height / 2);
        await page.mouse.down();
        const active = await read();
        await page.mouse.up();
        const slack = 0.6;
        const tintDelta = edgeDelta(active.tint, hovered.tint);
        const boxDelta = edgeDelta(active.box, hovered.box);
        if (tintDelta > slack) failures.push(`${item.id}: hover and active tint boxes differ by ${String(tintDelta)}px`);
        if (boxDelta > slack) failures.push(`${item.id}: the row box moves on press`);
        if (active.geometry.join("|") !== hovered.geometry.join("|")) failures.push(`${item.id}: press changes margin, padding, border, or transform`);
        if (active.color === "rgba(0, 0, 0, 0)") failures.push(`${item.id}: active tint is transparent`);
      }
    }
    if (item.id === "components-listrow--hover") {
      const shifted = await page.locator(".ui-row-title").evaluateAll((nodes) => {
        const edges = nodes.map((node) => Math.round(node.getBoundingClientRect().right));
        return edges.length >= 2 && edges.every((edge) => edge === edges[0]) ? "" : `titles sit at ${edges.join(", ")}`;
      });
      if (shifted) failures.push(`${item.id}: ${shifted}`);
    }
  }
  await page.goto("/iframe.html?id=components-listrow--project&viewMode=story", { waitUntil: "domcontentloaded" });
  const focusRow = page.locator(".ui-row").first();
  await expect(focusRow).toBeVisible();
  let focused = false;
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press("Tab");
    focused = await focusRow.evaluate((node) => node.matches(":focus-visible"));
    if (focused) break;
  }
  if (!focused) failures.push("project row focus is not :focus-visible");
  else {
    const read = () => focusRow.evaluate((node) => {
      const content = node.getBoundingClientRect();
      const tint = getComputedStyle(node, "::before");
      const style = getComputedStyle(node);
      const left = Number.parseFloat(tint.left);
      const right = Number.parseFloat(tint.right);
      const top = Number.parseFloat(tint.top);
      const bottom = Number.parseFloat(tint.bottom);
      return {
        tint: [content.left + left, content.right - right, content.top + top, content.bottom - bottom],
        outline: style.outlineStyle,
        color: tint.backgroundColor,
      };
    });
    const byKeyboard = await read();
    if (byKeyboard.outline !== "none") failures.push("project row focus draws an outline");
    if (byKeyboard.color === "rgba(0, 0, 0, 0)") failures.push("focus tint is transparent");
    await focusRow.hover();
    const byHover = await read();
    const delta = edgeDelta(byKeyboard.tint, byHover.tint);
    if (delta > 0.6) failures.push(`focus tint differs from hover by ${String(delta)}px`);
  }
  expect(failures, failures.join("\n")).toEqual([]);
});

test("pressed buttons and chips keep the hover box", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const cases = [
    ["components-button--primary", ".ui-btn"],
    ["components-button--secondary", ".ui-btn"],
    ["components-button--pill", ".ui-btn"],
    ["components-button--ghost", ".ui-btn"],
    ["components-button--danger", ".ui-btn"],
    ["components-chip--choice-off", ".ui-chip"],
    ["components-chip--suggested", ".ui-chip"],
    ["components-chip--selected", ".ui-chip"],
  ] as const;
  const failures: string[] = [];
  for (const [id, selector] of cases) {
    await page.goto(`/iframe.html?id=${id}&viewMode=story`, { waitUntil: "domcontentloaded" });
    const control = page.locator(selector).first();
    await expect(control).toBeVisible();
    const read = () => control.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        box: [box.left, box.right, box.top, box.bottom],
        geometry: [style.margin, style.padding, style.borderWidth, style.transform, style.borderRadius],
      };
    });
    await control.hover();
    const hovered = await read();
    const spot = await control.boundingBox();
    if (!spot) {
      failures.push(`${id}: missing box`);
      continue;
    }
    await page.mouse.move(spot.x + spot.width / 2, spot.y + spot.height / 2);
    await page.mouse.down();
    const active = await read();
    await page.mouse.up();
    const delta = edgeDelta(active.box, hovered.box);
    if (delta > 0.6) failures.push(`${id}: press moves the box by ${String(delta)}px`);
    if (active.geometry.join("|") !== hovered.geometry.join("|")) failures.push(`${id}: press changes margin, padding, border, radius, or transform`);
  }
  expect(failures, failures.join("\n")).toEqual([]);
});

test("a segmented control is hit 4px outside its drawn box", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/iframe.html?id=components-segmentedcontrol--expenses&viewMode=story", { waitUntil: "domcontentloaded" });
  const control = page.locator(".ui-seg-btn").first();
  await expect(control).toBeVisible();
  const hit = await control.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const above = document.elementFromPoint(box.left + box.width / 2, box.top - 4);
    return above === el || (above instanceof Node && el.contains(above));
  });
  expect(hit).toBe(true);
});

test("the categories hidden link wraps on the end side and does not truncate", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/iframe.html?id=screens-routes--categories-hidden-collapsed&viewMode=story", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /מוסתרות/ })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("עבודה")).toHaveCount(0);
  await expect(page.getByText("סוג")).toHaveCount(0);
  const track = await page.locator(".ui-seg").evaluate((node) => getComputedStyle(node).borderRadius);
  expect(track).toBe("12px");

  await page.goto("/iframe.html?id=screens-routes--categories-none-hidden&viewMode=story", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "קטגוריה חדשה" })).toBeVisible();
  await expect(page.getByRole("button", { name: /מוסתרות/ })).toHaveCount(0);

  await page.goto("/iframe.html?id=screens-routes--categories-long-hebrew&viewMode=story", { waitUntil: "domcontentloaded" });
  const foot = page.locator(".ui-cat-foot");
  const hidden = foot.getByRole("button", { name: /מוסתרות/ });
  await expect(hidden).toBeVisible();
  const placed = await foot.evaluate((node) => {
    const buttons = [...node.querySelectorAll("button")];
    const end = buttons.find((button) => button.classList.contains("ui-cat-foot-end"));
    const start = buttons.find((button) => !button.classList.contains("ui-cat-foot-end"));
    if (!(end instanceof HTMLElement) || !(start instanceof HTMLElement)) return null;
    const label = end.querySelector(".ui-text-link-label");
    if (!(label instanceof HTMLElement)) return null;
    const style = getComputedStyle(label);
    const footBox = node.getBoundingClientRect();
    const pad = Number.parseFloat(getComputedStyle(node).paddingLeft);
    const endBox = end.getBoundingClientRect();
    return {
      ellipsis: style.textOverflow === "ellipsis" || style.whiteSpace === "nowrap",
      fits: label.scrollWidth <= label.clientWidth + 1,
      onEnd: Math.abs(endBox.x - (footBox.x + pad)) < 2,
      inside: endBox.x >= footBox.x - 1 && endBox.right <= footBox.right + 1,
    };
  });
  expect(placed).toEqual({ ellipsis: false, fits: true, onEnd: true, inside: true });

  await hidden.locator(".ui-text-link-label").evaluate((node) => {
    node.textContent = "מוסתרות ארוכות מאוד שאי אפשר לקטוע באמצע השורה";
  });
  const wrapped = await foot.evaluate((node) => {
    const buttons = [...node.querySelectorAll("button")];
    const end = buttons.find((button) => button.classList.contains("ui-cat-foot-end"));
    const start = buttons.find((button) => !button.classList.contains("ui-cat-foot-end"));
    if (!(end instanceof HTMLElement) || !(start instanceof HTMLElement)) return null;
    const label = end.querySelector(".ui-text-link-label");
    if (!(label instanceof HTMLElement)) return null;
    const footBox = node.getBoundingClientRect();
    const pad = Number.parseFloat(getComputedStyle(node).paddingLeft);
    const endBox = end.getBoundingClientRect();
    const startBox = start.getBoundingClientRect();
    return {
      ownLine: endBox.y >= startBox.y + startBox.height - 1,
      onEnd: Math.abs(endBox.x - (footBox.x + pad)) < 2,
      fits: label.scrollWidth <= label.clientWidth + 1,
      ellipsis: getComputedStyle(label).textOverflow === "ellipsis",
    };
  });
  expect(wrapped).toEqual({ ownLine: true, onEnd: true, fits: true, ellipsis: false });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/iframe.html?id=screens-routes--categories-hidden-expanded&viewMode=story", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("עבודה")).toBeVisible();
  const turn = page.locator(".ui-cat-foot .ui-chevron-turn");
  await expect(turn).toHaveAttribute("data-open", "true");
  await expect(page.getByRole("button", { name: /מוסתרות/ })).toHaveAttribute("aria-expanded", "true");
  const motion = await turn.evaluate((node) => {
    const style = getComputedStyle(node);
    return { duration: style.transitionDuration, transform: style.transform };
  });
  expect(motion.duration === "0s" || motion.duration === "0ms").toBe(true);
  expect(motion.transform).not.toBe("none");
});

test("split stays calm and pins the summary", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/iframe.html?id=screens-routes--split-income-disabled&viewMode=story", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("אופן הפיצול")).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.locator(".ui-chip-scope")).toHaveCount(0);
  const income = page.getByRole("radio", { name: /לפי הכנסות/ });
  await expect(income).toBeDisabled();
  await expect(page.getByRole("button", { name: "שמירה" })).toHaveCount(0);
  const summary = page.locator(".ui-split-cta");
  const summaryBox = await summary.boundingBox();
  expect(summaryBox).not.toBeNull();
  if (summaryBox) {
    expect(summaryBox.y + summaryBox.height).toBeGreaterThan(800);
    expect(summaryBox.y + summaryBox.height).toBeLessThanOrEqual(844);
  }

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/iframe.html?id=screens-routes--split-default-320&viewMode=story", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".ui-split-summary")).toBeVisible();
  expect(await layoutProblems(page)).toEqual([]);
  const titles = await page.locator(".ui-split-card .ui-row-title").evaluateAll((nodes) => nodes.map((node) => {
    const style = getComputedStyle(node);
    return {
      lines: node.getClientRects().length,
      clipped: style.textOverflow === "ellipsis" && node.scrollWidth > node.clientWidth + 1,
    };
  }));
  expect(titles.length).toBeGreaterThan(0);
  for (const title of titles) {
    expect(title.lines).toBe(1);
    expect(title.clipped).toBe(false);
  }
});

/** The route stories are checked in quarters, so workers or shards share the work and each part stays well under its 120 s (about 1 s a story). */
const FOCUS_PARTS = 4;

for (let part = 0; part < FOCUS_PARTS; part += 1) {
  test(`a title focused on open draws no ring (part ${String(part + 1)}/${String(FOCUS_PARTS)})`, async ({ page }) => {
    await checkFocusTitles(page, part);
  });
}

test("tab from a focused title reaches a control that draws a ring", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/iframe.html?id=screens-routes--install-iphone&viewMode=story", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "הוספה למסך הבית" })).toBeFocused();
  await page.keyboard.press("Tab");
  const control = await page.evaluate(() => {
    const node = document.activeElement;
    if (!(node instanceof HTMLElement)) return { title: true, outline: "none" };
    const style = getComputedStyle(node);
    return { title: node.classList.contains("ui-focus-title"), outline: style.outlineStyle };
  });
  expect(control.title).toBe(false);
  expect(control.outline).not.toBe("none");
});

async function checkFocusTitles(page: Page, part: number): Promise<void> {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const index = (await (await page.request.get("/index.json")).json()) as StoryIndex;
  // A play function clicks on purpose (a skip, a menu), so focus has moved on by the time it ends.
  const allStories = Object.values(index.entries).filter(
    (story) =>
      story.type === "story" && story.id.startsWith("screens-routes--") && !story.tags?.includes("play-fn"),
  );
  expect(allStories.length).toBeGreaterThan(10);
  const stories = allStories.filter((_, i) => i % FOCUS_PARTS === part);
  const failures: string[] = [];
  for (const story of stories) {
    await page.goto(`/iframe.html?id=${story.id}&viewMode=story`, { waitUntil: "domcontentloaded" });
    await page.locator("#storybook-root").waitFor();
    await page.waitForFunction(() => {
      const titles = document.querySelectorAll(".ui-focus-title");
      if (titles.length === 0) return true;
      const focused = document.activeElement;
      return focused instanceof HTMLElement && focused.classList.contains("ui-focus-title");
    });
    const problem = await page.evaluate(() => {
      const titles = [...document.querySelectorAll<HTMLElement>(".ui-focus-title")];
      if (titles.length === 0) return "";
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement) || !focused.classList.contains("ui-focus-title")) {
        return "title is not focused";
      }
      for (const title of titles) {
        const style = getComputedStyle(title);
        if (style.outlineStyle !== "none") {
          return `outline ${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`;
        }
        if (title.tabIndex !== -1) return "title is in the tab order";
      }
      return "";
    });
    if (problem) failures.push(`${story.id}: ${problem}`);
    const sheetProblem = await page.evaluate(() => {
      const panels = document.querySelectorAll<HTMLElement>(".ui-sheet-panel");
      const panel = panels[panels.length - 1];
      if (!panel) return "";
      panel.focus();
      const style = getComputedStyle(panel);
      if (style.outlineStyle !== "none") {
        return `sheet outline ${style.outlineWidth} ${style.outlineStyle}`;
      }
      const control = panel.querySelector<HTMLElement>("button:not([disabled]), a[href], input:not([disabled])");
      if (!control) return "sheet has no control";
      control.focus();
      if (getComputedStyle(control).outlineStyle === "none") return "a control inside the sheet draws no ring";
      return "";
    });
    if (sheetProblem) failures.push(`${story.id}: ${sheetProblem}`);
  }
  expect(failures).toEqual([]);
}

test("hebrew counts keep their reading order around the numbers", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/iframe.html?id=components-bidicounts--reading-order&viewMode=story", { waitUntil: "domcontentloaded" });
  const order = await page.locator("[data-bidi='projects']").evaluate((node) => {
    const parts: Array<{ text: string; x: number }> = [];
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim() ?? "";
      if (text === "" || text === "·") continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      parts.push({ text, x: range.getBoundingClientRect().x });
    }
    return parts.sort((left, right) => right.x - left.x).map((part) => part.text);
  });
  expect(order.slice(0, 3)).toEqual(["עוד", "2", "שהסתיימו"]);
  const used = await page.locator(".ui-row-hint").evaluate((node) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let word: DOMRect | null = null;
    let number: DOMRect | null = null;
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim() ?? "";
      if (text === "") continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      const box = range.getBoundingClientRect();
      if (text.startsWith("נוצלו")) word = box;
      if (text.includes("%")) number = box;
    }
    if (!word || !number) return [];
    return [word.right > number.right, number.left < word.left];
  });
  expect(used).toEqual([true, true]);
});
