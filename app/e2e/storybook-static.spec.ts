import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type ConsoleMessage, type Page } from "@playwright/test";
import { classifyStorybookRequest, isAllowedStorybookUrl, type StorybookRequestKind } from "./storybook-network";

type StoryEntry = {
  id: string;
  type: string;
  title: string;
  name: string;
  importPath?: string;
};

type StoryIndex = {
  entries: Record<string, StoryEntry>;
};

type StoryLabel = {
  id: string;
  title: string;
  name: string;
};

type BlockedRequest = StoryLabel & {
  url: string;
  kind: Exclude<StorybookRequestKind, "allow"> | "websocket";
};

/**
 * Storybook's own manager logs this Chrome intervention on every page. It is not a story failure.
 * The BigInt crash is an uncaught TypeError and is never ignored.
 */
function isFrameworkNoise(text: string): boolean {
  return /Permissions policy violation: unload is not allowed/i.test(text);
}

function serverPort(baseURL: string | undefined): string {
  const url = new URL(baseURL ?? "http://127.0.0.1:6193");
  if (url.port === "") throw new Error("storybook baseURL needs a port");
  return url.port;
}

/**
 * One guard for the whole test. Playwright does not route requests a service worker makes after it
 * starts, and this project sets serviceWorkers to "block", so a worker cannot skip the allowlist.
 * A script fetch Playwright still attributes to a worker is classified and aborted here.
 */
async function installStorybookGuard(
  context: BrowserContext,
  port: string,
  storyOf: () => StoryLabel,
  blocked: BlockedRequest[],
): Promise<void> {
  const record = (url: string, kind: BlockedRequest["kind"]) => {
    const story = storyOf();
    blocked.push({ id: story.id, title: story.title, name: story.name, url, kind });
  };
  await context.route("**/*", async (route) => {
    const request = route.request();
    const fromWorker = request.serviceWorker() != null || request.resourceType() === "serviceworker";
    const kind = classifyStorybookRequest(request.url(), port, fromWorker);
    if (kind === "allow") {
      await route.continue();
      return;
    }
    record(request.url(), kind);
    await route.abort("blockedbyclient");
  });
  await context.routeWebSocket((url) => !isAllowedStorybookUrl(url.href, port), (ws) => {
    record(ws.url(), "websocket");
    void ws.close({ code: 1008, reason: "blocked" });
  });
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
  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  return () => {
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
  };
}

/**
 * The pre-push gate opens only the stories a change reaches: FLOW_STORY_SCOPE names a file of story
 * files from scripts/storybook-stories.mjs ("all", or unset, opens every story). main opens every
 * story before each deploy.
 */
function scopedStories(all: StoryEntry[]): StoryEntry[] {
  const scopeFile = process.env.FLOW_STORY_SCOPE;
  if (!scopeFile) return all;
  const files = new Set(readFileSync(scopeFile, "utf8").split("\n").map((line) => line.trim()).filter(Boolean));
  if (files.has("all")) return all;
  return all.filter((entry) => entry.importPath !== undefined && files.has(entry.importPath));
}

/**
 * Every story is opened once. The stories are split round-robin into shards so Playwright workers
 * can open them side by side; together the shards cover the whole index.
 */
const STORY_SHARDS = 8;

test.describe("every static story", () => {
  test.describe.configure({ mode: "parallel" });

  for (let shard = 0; shard < STORY_SHARDS; shard += 1) {
    test(`loads in the manager without console or network errors (shard ${String(shard + 1)}/${String(STORY_SHARDS)})`, async ({ page, context }) => {
      await checkStoryShard(page, context, shard);
    });
  }
});

async function checkStoryShard(page: Page, context: BrowserContext, shard: number): Promise<void> {
  test.setTimeout(600_000);
  const port = serverPort(test.info().project.use.baseURL);
  const blocked: BlockedRequest[] = [];
  let story: StoryLabel = { id: "index", title: "index", name: "index" };
  await installStorybookGuard(context, port, () => story, blocked);

  const index = (await (await page.request.get("/index.json")).json()) as StoryIndex;
  const allStories = Object.values(index.entries).filter((entry) => entry.type === "story");
  expect(allStories.length).toBeGreaterThan(50);
  const scoped = scopedStories(allStories);
  const stories = scoped.filter((_, i) => i % STORY_SHARDS === shard);
  if (scoped.length === allStories.length) expect(stories.length).toBeGreaterThan(0);

  const failures: string[] = [];
  // The manager loads once per shard; each next story opens in place through the manager's own
  // router (a popstate on the new ?path=), as a click in the sidebar does, which skips reloading the
  // manager and the preview for every story. A story that shows any problem in place is opened
  // again on a fresh page, and only that result counts: a story can leave module state behind (a
  // client, a flag) that the next one would not see on its own page.
  let fresh = true;
  for (const entry of stories) {
    story = { id: entry.id, title: entry.title, name: entry.name };
    const mark = blocked.length;
    let problems = await checkStory(page, entry.id, fresh);
    if (problems.length > 0 || blocked.length > mark) {
      if (!fresh) {
        // Leave the old document first: its in-flight requests abort on the way out, and that is
        // not this story's doing.
        await page.goto("about:blank");
        blocked.length = mark;
        problems = await checkStory(page, entry.id, true);
      }
    }
    fresh = problems.length > 0 || blocked.length > mark;
    if (problems.length > 0) failures.push(`${entry.title} / ${entry.name}: ${problems.join(" | ")}`);
  }

  for (const hit of blocked) failures.push(`${hit.title} / ${hit.name} [${hit.id}]: ${hit.kind} ${hit.url}`);
  expect(failures, failures.join("\n")).toEqual([]);
}

/** Opens one story and returns what went wrong: console errors, a page error, a failed render. */
async function checkStory(page: Page, id: string, fresh: boolean): Promise<string[]> {
  const problems: string[] = [];
  const stop = recordProblems(page, problems);
  try {
    await openStory(page, id, fresh);
    // The manager stringifies args after the preview reports the story.
    await page.waitForTimeout(fresh ? 200 : 100);
    const body = (await page.locator("body").innerText()).trim();
    if (!body) problems.push("manager body is blank");
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  } finally {
    stop();
  }
  return problems;
}

/** The phases after which Storybook 8's preview is done with a story. */
const DONE_PHASES = new Set(["completed", "finished", "played", "errored", "aborted"]);

/**
 * A fresh open waits until the story has rendered, not for its play: a play that drives a sheet can
 * fail in the manager's desktop frame though it passes in the Storybook test run, which owns plays.
 */
const RENDERED_PHASES = new Set([...DONE_PHASES, "playing"]);

/**
 * Opens one story in the manager. A fresh open loads the story's URL; in place, the manager's router
 * moves to it. Either way the wait is for the preview to finish rendering it. An errored or aborted
 * render throws, so the story fails.
 */
async function openStory(page: Page, id: string, fresh: boolean): Promise<void> {
  if (fresh) {
    await page.goto(`/?path=/story/${id}`, { waitUntil: "domcontentloaded" });
  } else {
    await page.evaluate((next) => {
      window.history.pushState({}, "", `/?path=/story/${next}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, id);
  }
  const root = page.frameLocator("#storybook-preview-iframe").locator("#storybook-root");
  await root.waitFor({ state: "attached", timeout: 20_000 });
  await expect(page.locator("#storybook-explorer-tree, #storybook-preview-iframe").first()).toBeVisible();
  // Fresh or in place, wait for the preview to render this story (in place the root is already
  // there from the story before). A request a story sends once it has rendered, such as a query a
  // sample forgot to fill, then lands on this story and fails it, also on the fresh retry; the root
  // alone is there before the story renders, so the old wait let such a request through.
  const phase = await page.waitForFunction(({ want, done }) => {
    const frame = document.querySelector<HTMLIFrameElement>("#storybook-preview-iframe");
    const preview = (frame?.contentWindow as { __STORYBOOK_PREVIEW__?: { currentRender?: { id?: string; phase?: string } } } | null)
      ?.__STORYBOOK_PREVIEW__;
    const render = preview?.currentRender;
    return render?.id === want && render.phase !== undefined && done.includes(render.phase) ? render.phase : false;
  }, { want: id, done: [...(fresh ? RENDERED_PHASES : DONE_PHASES)] }, { timeout: 20_000 });
  const reached = (await phase.jsonValue()) as string;
  if (reached === "errored" || reached === "aborted") throw new Error(`the story ${reached}`);
}

test("the network guard aborts a fetch and a websocket outside storybook", async ({ page, context }) => {
  const port = serverPort(test.info().project.use.baseURL);
  const blocked: BlockedRequest[] = [];
  let story: StoryLabel = {
    id: "screens-routes--settings-empty",
    title: "Screens/Routes",
    name: "Settings empty",
  };
  await installStorybookGuard(context, port, () => story, blocked);
  expect(test.info().project.use.serviceWorkers).toBe("block");
  await page.goto("/");

  const fetchUrl = "https://fake.supabase.co/functions/v1/flow-mcp/status";
  const socketUrl = "wss://fake.supabase.co/realtime/v1/websocket";
  const outcome = await page.evaluate(async ({ fetchUrl: nextFetch, socketUrl: nextSocket }) => {
    const fetchResult = await fetch(nextFetch).then(() => "reached" as const, () => "aborted" as const);
    const socketResult = await new Promise<"open" | "aborted">((resolve) => {
      const ws = new WebSocket(nextSocket);
      ws.addEventListener("open", () => { resolve("open"); });
      ws.addEventListener("error", () => { resolve("aborted"); });
      ws.addEventListener("close", () => { resolve("aborted"); });
    });
    return { fetchResult, socketResult };
  }, { fetchUrl, socketUrl });

  story = {
    id: "screens-routes--assistant-connected",
    title: "Screens/Routes",
    name: "Assistant connected",
  };

  expect(outcome.fetchResult).toBe("aborted");
  expect(outcome.socketResult).toBe("aborted");
  expect(blocked.some((hit) => hit.kind === "request" && hit.url === fetchUrl && hit.id === "screens-routes--settings-empty")).toBe(true);
  expect(blocked.some((hit) => hit.kind === "websocket" && hit.url === socketUrl && hit.id === "screens-routes--settings-empty")).toBe(true);
  expect(blocked.some((hit) => hit.id === "screens-routes--assistant-connected")).toBe(false);
});
