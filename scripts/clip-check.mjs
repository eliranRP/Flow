import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Text nodes only. A row button is wider than its label by its padding, so it is not a clip. */
export const TEXT_SELECTOR = ".ui-row-title, .ui-row-hint, .t-hint, .ui-secret-value, .ui-field-label, .t-title-2, .ui-section-title, .ui-btn-label, p";
/** Designed single-line truncation. A hint is not in this list. */
export const CLIP_OK_SELECTOR = ".ui-row-title, [data-clip-ok]";
export const WIDTHS = [320, 360, 390];
export const THEMES = ["light", "dark"];

const types = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** True when the text is more than 1px wider than its box. */
export function isClipped(textWidth, boxWidth) {
  return textWidth - boxWidth > 1;
}

/**
 * `.ui-row-title` and `[data-clip-ok]` may ellipsize. A single-line hint is still a clip.
 * @param {{ textWidth?: number, boxWidth?: number, scrollWidth?: number, clientWidth?: number, textOverflow?: string, whiteSpace?: string, overflow?: string, clipOk?: boolean }} input
 */
export function reportsClip(input) {
  const textWidth = input.textWidth ?? input.scrollWidth ?? 0;
  const boxWidth = input.boxWidth ?? input.clientWidth ?? 0;
  const nowrap = typeof input.whiteSpace === "string" && input.whiteSpace.includes("nowrap");
  const hidden = input.overflow === "hidden" || input.overflow === "clip";
  if (input.clipOk === true && input.textOverflow === "ellipsis" && nowrap && hidden) return false;
  return isClipped(textWidth, boxWidth);
}

export function storybookStaticDir() {
  return fileURLToPath(new URL("../app/storybook-static/", import.meta.url));
}

/**
 * @param {string} rootDir
 * @returns {Promise<{ server: import("node:http").Server, port: number }>}
 */
export function listenStatic(rootDir) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    const file = join(rootDir, rel === "/" ? "index.html" : rel);
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("missing");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address == null || typeof address === "string") {
        reject(new Error("clip-check listen failed"));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

/**
 * @param {{
 *   staticDir?: string,
 *   widths?: number[],
 *   themes?: string[],
 *   launch?: () => Promise<{ newPage: () => Promise<import("playwright").Page>, close: () => Promise<void> }>,
 *   log?: (line: string) => void,
 *   error?: (line: string) => void,
 * }} [options]
 * @returns {Promise<number>}
 */
async function run(options = {}) {
  const log = options.log ?? ((line) => { console.log(line); });
  const error = options.error ?? ((line) => { console.error(line); });
  const staticDir = options.staticDir ?? storybookStaticDir();
  const widths = options.widths ?? WIDTHS;
  const themes = options.themes ?? THEMES;
  let index;
  try {
    index = JSON.parse(await readFile(join(staticDir, "index.json"), "utf8"));
  } catch {
    error("Build Storybook first: pnpm build-storybook");
    return 2;
  }
  const stories = Object.values(index.entries ?? {}).filter((entry) => entry && entry.type === "story" && typeof entry.id === "string");
  if (stories.length === 0) {
    error("Storybook index has no stories.");
    return 2;
  }
  const require = createRequire(new URL("../app/package.json", import.meta.url));
  const { chromium } = require("playwright");
  const { server, port } = await listenStatic(staticDir);
  const launch = options.launch ?? (() => chromium.launch());
  let browser;
  const failures = [];
  const storyErrors = [];
  let measured = 0;
  try {
    browser = await launch();
    const page = await browser.newPage();
    for (const theme of themes) {
      for (const width of widths) {
        await page.setViewportSize({ width, height: 844 });
        for (const story of stories) {
          const globals = theme === "dark" ? "&globals=theme:dark" : "";
          await page.goto(`http://127.0.0.1:${String(port)}/iframe.html?id=${story.id}&viewMode=story${globals}`, { waitUntil: "domcontentloaded" });
          await page.locator("#storybook-root").waitFor({ state: "attached", timeout: 15_000 });
          await page.waitForFunction(() => {
            if (document.body.classList.contains("sb-show-errordisplay")) return true;
            const root = document.querySelector("#storybook-root");
            return root instanceof HTMLElement && root.childElementCount > 0;
          }, undefined, { timeout: 15_000 });
          await page.evaluate(() => document.fonts.ready);
          const errored = await page.evaluate(() => document.body.classList.contains("sb-show-errordisplay"));
          if (errored) {
            storyErrors.push(`${theme} ${String(width)} ${story.id}: storybook error`);
            continue;
          }
          const panels = page.locator(".ui-sheet-panel");
          const panelCount = await panels.count();
          for (let index = 0; index < panelCount; index += 1) {
            await panels.nth(index).waitFor({ state: "visible", timeout: 15_000 });
          }
          const samples = await page.evaluate(({ selector, clipOkSelector }) => {
            const roots = [document.querySelector("#storybook-root"), ...document.querySelectorAll(".ui-sheet-panel")];
            const found = [];
            const seen = new Set();
            for (const root of roots) {
              if (!(root instanceof HTMLElement)) continue;
              for (const node of root.querySelectorAll(selector)) {
                if (!(node instanceof HTMLElement) || seen.has(node)) continue;
                seen.add(node);
                const style = getComputedStyle(node);
                if (style.display === "none" || style.visibility === "hidden") continue;
                if (node.getClientRects().length === 0) continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                const rects = [...range.getClientRects()];
                if (rects.length === 0) continue;
                const textWidth = Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left));
                found.push({
                  textWidth,
                  boxWidth: node.getBoundingClientRect().width,
                  textOverflow: style.textOverflow,
                  whiteSpace: style.whiteSpace,
                  overflow: style.overflow,
                  clipOk: node.matches(clipOkSelector),
                  label: `${node.className || node.tagName} "${node.innerText.trim().replace(/\s+/g, " ").slice(0, 48)}"`,
                });
              }
            }
            return found;
          }, { selector: TEXT_SELECTOR, clipOkSelector: CLIP_OK_SELECTOR });
          measured += samples.length;
          for (const sample of samples) {
            if (!reportsClip(sample)) continue;
            const overflow = Math.round(sample.textWidth - sample.boxWidth);
            failures.push(`${theme} ${String(width)} ${story.id}: ${sample.label} +${String(overflow)}px`);
          }
        }
      }
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => { server.close(resolve); });
  }
  if (failures.length > 0) {
    error(failures.slice(0, 40).join("\n"));
    error(`clip-check failed. ${String(failures.length)} story views clip text.`);
    return 1;
  }
  if (storyErrors.length > 0) {
    error(storyErrors.slice(0, 40).join("\n"));
    error("clip-check failed. Storybook showed an error.");
    return 2;
  }
  if (measured === 0) {
    error("clip-check measured nothing.");
    return 2;
  }
  log(`clip-check passed. ${String(stories.length)} stories, ${String(measured)} elements, ${themes.join("/")} at ${widths.join("/")}.`);
  return 0;
}

/** @param {Parameters<typeof run>[0]} [options] */
export async function execute(options) {
  try {
    return await run(options);
  } catch (error) {
    const write = options?.error ?? ((line) => { console.error(line); });
    write(error instanceof Error ? error.message : "clip-check failed");
    return 3;
  }
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invoked) {
  execute().then((code) => {
    process.exit(code);
  });
}
