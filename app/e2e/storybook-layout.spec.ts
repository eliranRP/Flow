import { expect, test, type Page } from "@playwright/test";

type StoryEntry = {
  id: string;
  type: string;
  title: string;
  name: string;
};

type StoryIndex = {
  entries: Record<string, StoryEntry>;
};

const widths = [390, 320];

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

    const singleLine = document.querySelectorAll(".ui-period-label, .ui-chip-label, .ui-pill-label, .ui-btn-label, .ui-text-link-label, .ui-seg-btn, .ui-seg-label");
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
      if (Number.isFinite(line) && sheetTitle.getBoundingClientRect().height > line * 1.4) {
        problems.push("sheet title is more than 1 line");
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
