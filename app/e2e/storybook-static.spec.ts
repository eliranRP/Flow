import { expect, test, type ConsoleMessage, type Page, type Request } from "@playwright/test";

type StoryEntry = {
  id: string;
  type: string;
  title: string;
  name: string;
};

type StoryIndex = {
  entries: Record<string, StoryEntry>;
};

/**
 * Storybook's own manager logs this Chrome intervention on every page. It is not a story failure.
 * The BigInt crash is an uncaught TypeError and is never ignored.
 */
function isFrameworkNoise(text: string): boolean {
  return /Permissions policy violation: unload is not allowed/i.test(text);
}

function isProductionSupabase(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "supabase.co" || host.endsWith(".supabase.co");
  } catch {
    return false;
  }
}

function recordProblems(page: Page, problems: string[]) {
  const onPageError = (error: Error) => {
    problems.push(`pageerror: ${error.message}`);
  };
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (isFrameworkNoise(text)) return;
    problems.push(`console: ${text}`);
  };
  const onRequest = (request: Request) => {
    if (!isProductionSupabase(request.url())) return;
    problems.push(`request: ${request.url()}`);
  };
  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  page.on("request", onRequest);
  return () => {
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
    page.off("request", onRequest);
  };
}

test("every static story loads in the manager without console errors", async ({ page }) => {
  test.setTimeout(600_000);
  const index = (await (await page.request.get("/index.json")).json()) as StoryIndex;
  const stories = Object.values(index.entries).filter((entry) => entry.type === "story");
  expect(stories.length).toBeGreaterThan(50);

  const failures: string[] = [];
  for (const story of stories) {
    const problems: string[] = [];
    const stop = recordProblems(page, problems);
    try {
      await page.goto(`/?path=/story/${story.id}`, { waitUntil: "domcontentloaded" });
      const root = page.frameLocator("#storybook-preview-iframe").locator("#storybook-root");
      await root.waitFor({ state: "attached", timeout: 20_000 });
      await expect(page.locator("#storybook-explorer-tree, #storybook-preview-iframe").first()).toBeVisible();
      // The manager stringifies args after the preview reports the story.
      await page.waitForTimeout(200);
      const body = (await page.locator("body").innerText()).trim();
      if (!body) problems.push("manager body is blank");
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    } finally {
      stop();
    }
    if (problems.length > 0) failures.push(`${story.title} / ${story.name}: ${problems.join(" | ")}`);
  }

  expect(failures, failures.join("\n")).toEqual([]);
});
