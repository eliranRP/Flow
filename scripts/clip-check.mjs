import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

/** Text nodes only. A row button is wider than its label by its padding, so it is not a clip. */
export const TEXT_SELECTOR = ".ui-row-title, .ui-row-hint, .t-hint, .ui-secret-value, .ui-field-label, .t-title-2, .ui-section-title, .ui-btn-label, p";
export const WIDTHS = [320, 360, 390];
export const THEMES = ["light", "dark"];

/** True when the element scrolls more than 1px past its own box. */
export function isClipped(scrollWidth, clientWidth) {
  return scrollWidth - clientWidth > 1;
}

/**
 * Single-line ellipsis is the designed truncation for a row title.
 * A wrapping hint is still reported.
 * @param {{ scrollWidth: number, clientWidth: number, textOverflow?: string, whiteSpace?: string, overflow?: string }} input
 */
export function reportsClip(input) {
  const nowrap = typeof input.whiteSpace === "string" && input.whiteSpace.includes("nowrap");
  const hidden = input.overflow === "hidden" || input.overflow === "clip";
  if (input.textOverflow === "ellipsis" && nowrap && hidden) return false;
  return isClipped(input.scrollWidth, input.clientWidth);
}

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

/**
 * @param {string} rootDir
 * @param {number} port
 */
function serve(rootDir, port) {
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
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  const staticDir = new URL("../app/storybook-static/", import.meta.url);
  let index;
  try {
    index = JSON.parse(await readFile(new URL("index.json", staticDir), "utf8"));
  } catch {
    console.error("Build Storybook first: pnpm build-storybook");
    return 2;
  }
  const stories = Object.values(index.entries ?? {}).filter((entry) => entry && entry.type === "story" && typeof entry.id === "string");
  if (stories.length === 0) {
    console.error("Storybook index has no stories.");
    return 2;
  }
  const require = createRequire(new URL("../app/package.json", import.meta.url));
  const { chromium } = require("playwright");
  const server = await serve(staticDir.pathname, 6194);
  const browser = await chromium.launch();
  const failures = [];
  try {
    const page = await browser.newPage();
    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 844 });
        for (const story of stories) {
          const globals = theme === "dark" ? "&globals=theme:dark" : "";
          await page.goto(`http://127.0.0.1:6194/iframe.html?id=${story.id}&viewMode=story${globals}`, { waitUntil: "domcontentloaded" });
          await page.locator("#storybook-root").waitFor({ state: "attached", timeout: 15_000 });
          await page.waitForTimeout(40);
          const problems = await page.evaluate((selector) => {
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
                const nowrap = style.whiteSpace.includes("nowrap");
                const hidden = style.overflow === "hidden" || style.overflow === "clip";
                if (style.textOverflow === "ellipsis" && nowrap && hidden) continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                const rects = [...range.getClientRects()];
                if (rects.length === 0) continue;
                const textWidth = Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left));
                const boxWidth = node.getBoundingClientRect().width;
                if (textWidth - boxWidth > 1) {
                  const text = node.innerText.trim().replace(/\s+/g, " ").slice(0, 48);
                  found.push(`${node.className || node.tagName} "${text}" +${String(Math.round(textWidth - boxWidth))}px`);
                }
              }
            }
            return found;
          }, TEXT_SELECTOR);
          if (problems.length > 0) failures.push(`${theme} ${String(width)} ${story.id}: ${problems.slice(0, 4).join(" | ")}`);
        }
      }
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => { server.close(resolve); });
  }
  if (failures.length === 0) {
    console.log(`clip-check passed. ${String(stories.length)} stories, ${THEMES.join("/")} at ${WIDTHS.join("/")}.`);
    return 0;
  }
  console.error(failures.slice(0, 40).join("\n"));
  console.error(`clip-check failed. ${String(failures.length)} story views clip text.`);
  return 1;
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invoked) {
  main().then((code) => {
    process.exit(code);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "clip-check failed");
    process.exit(1);
  });
}
