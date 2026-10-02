import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, rm, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Designed single-line truncation. A hint is not in this list. */
export const CLIP_OK_SELECTOR = ".ui-row-title, [data-clip-ok]";
/**
 * Storybook tag for a story that has no text to measure.
 * The index does not include parameters, so `parameters.clipCheck.noText` is not a skip.
 */
export const CLIP_NO_TEXT_TAG = "clip-no-text";
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

/** The repo root. Reports are written here, not in the process working directory. */
export function clipReportDir() {
  return fileURLToPath(new URL("..", import.meta.url));
}

/**
 * @param {{ tags?: string[] }} entry
 */
export function storySkipsText(entry) {
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  return tags.includes(CLIP_NO_TEXT_TAG);
}

/** "1 story view" or "2 story views". */
export function storyViewPhrase(count) {
  return `${String(count)} ${count === 1 ? "story view" : "story views"}`;
}

/**
 * @param {{ stories: number, skipped: number, measured: number, themes: string[], widths: number[] }} input
 */
export function passLine(input) {
  return `clip-check passed. ${String(input.stories)} stories, ${String(input.skipped)} skipped, ${String(input.measured)} elements, ${input.themes.join("/")} at ${input.widths.join("/")}.`;
}

async function removeReport(dir) {
  await rm(join(dir, "clip-report.json"), { force: true });
  await rm(join(dir, "clip-report.txt"), { force: true });
}

function isTimeout(error) {
  return error instanceof Error && (error.name === "TimeoutError" || error.message.includes("Timeout"));
}

function reportText(report) {
  const lines = [];
  for (const view of report.views) {
    lines.push(`story ${view.storyId} ${view.theme} ${String(view.width)} ${view.status}`);
    for (const element of view.elements) {
      const mark = element.clipped ? `CLIP +${String(element.overflow)}` : "ok";
      lines.push(`  ${element.className} ${element.label} text ${String(element.textWidth)} box ${String(element.boxWidth)} ${mark}`);
    }
  }
  if (report.storyErrors.length > 0) {
    lines.push("errors:");
    lines.push(...report.storyErrors);
  }
  if (report.didNotRender.length > 0) {
    lines.push("did not render:");
    lines.push(...report.didNotRender);
  }
  if (report.zeroMeasured.length > 0) {
    lines.push("measured nothing:");
    lines.push(...report.zeroMeasured);
  }
  if ((report.skipped ?? []).length > 0) {
    lines.push("skipped:");
    lines.push(...report.skipped);
  }
  if (report.note) lines.push(report.note);
  lines.push(`exit ${String(report.exit)}`);
  return `${lines.join("\n")}\n`;
}

function clippedViewCount(report) {
  const views = new Set();
  for (const view of report.views ?? []) {
    if (!view.elements?.some((element) => element.clipped)) continue;
    views.add(`${view.theme}\0${String(view.width)}\0${view.storyId}`);
  }
  return views.size;
}

function finalizeReport(report) {
  const skipped = [...new Set((report.views ?? []).filter((view) => view.status === "skipped").map((view) => view.storyId))];
  return { ...report, skipped };
}

async function writeClipReport(dir, report) {
  const jsonPath = join(dir, "clip-report.json");
  const txtPath = join(dir, "clip-report.txt");
  const body = { ...finalizeReport(report), jsonPath, txtPath };
  await writeFile(jsonPath, `${JSON.stringify(body, null, 2)}\n`);
  await writeFile(txtPath, reportText(body));
  return { jsonPath, txtPath };
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
 *   reportDir?: string,
 *   readyTimeout?: number,
 * }} [options]
 * @returns {Promise<number>}
 */
async function run(options = {}) {
  const log = options.log ?? ((line) => { console.log(line); });
  const error = options.error ?? ((line) => { console.error(line); });
  const staticDir = options.staticDir ?? storybookStaticDir();
  const reportDir = options.reportDir ?? clipReportDir();
  const readyTimeout = options.readyTimeout ?? 15_000;
  const widths = options.widths ?? WIDTHS;
  const themes = options.themes ?? THEMES;
  const report = {
    exit: 2,
    stories: [],
    views: [],
    storyErrors: [],
    didNotRender: [],
    zeroMeasured: [],
    failures: [],
    measured: 0,
    note: "",
  };
  const finish = async (code) => {
    report.exit = code;
    const paths = await writeClipReport(reportDir, report);
    log(`clip report ${paths.txtPath}`);
    return code;
  };
  let index;
  try {
    index = JSON.parse(await readFile(join(staticDir, "index.json"), "utf8"));
  } catch {
    error("Build Storybook first: pnpm build-storybook");
    report.note = "Build Storybook first: pnpm build-storybook";
    await removeReport(reportDir);
    return finish(2);
  }
  const stories = Object.values(index.entries ?? {}).filter((entry) => entry && entry.type === "story" && typeof entry.id === "string");
  report.stories = stories.map((entry) => entry.id);
  if (stories.length === 0) {
    error("Storybook index has no stories.");
    report.note = "Storybook index has no stories.";
    await removeReport(reportDir);
    return finish(2);
  }
  const require = createRequire(new URL("../app/package.json", import.meta.url));
  const { chromium } = require("playwright");
  const { server, port } = await listenStatic(staticDir);
  const launch = options.launch ?? (() => chromium.launch());
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage();
    for (const theme of themes) {
      for (const width of widths) {
        await page.setViewportSize({ width, height: 844 });
        for (const story of stories) {
          if (storySkipsText(story)) {
            report.views.push({ theme, width, storyId: story.id, status: "skipped", elements: [] });
            continue;
          }
          const globals = theme === "dark" ? "&globals=theme:dark" : "";
          await page.goto(`http://127.0.0.1:${String(port)}/iframe.html?id=${story.id}&viewMode=story${globals}`, { waitUntil: "domcontentloaded" });
          let rendered = false;
          try {
            await page.locator("#storybook-root").waitFor({ state: "attached", timeout: readyTimeout });
            await page.waitForFunction(() => {
              if (document.body.classList.contains("sb-show-errordisplay")) return true;
              const root = document.querySelector("#storybook-root");
              return root instanceof HTMLElement && root.childElementCount > 0;
            }, undefined, { timeout: readyTimeout });
            rendered = true;
          } catch (waitError) {
            if (!isTimeout(waitError)) throw waitError;
          }
          if (!rendered) {
            report.didNotRender.push(`${theme} ${String(width)} ${story.id}: story did not render`);
            report.views.push({ theme, width, storyId: story.id, status: "did-not-render", elements: [] });
            continue;
          }
          await page.evaluate(() => document.fonts.ready);
          const errored = await page.evaluate(() => document.body.classList.contains("sb-show-errordisplay"));
          if (errored) {
            report.storyErrors.push(`${theme} ${String(width)} ${story.id}: storybook error`);
            report.views.push({ theme, width, storyId: story.id, status: "storybook-error", elements: [] });
            continue;
          }
          const panels = page.locator(".ui-sheet-panel");
          const panelCount = await panels.count();
          for (let index = 0; index < panelCount; index += 1) {
            await panels.nth(index).waitFor({ state: "visible", timeout: 15_000 });
          }
          const samples = await page.evaluate((clipOkSelector) => {
            const roots = [document.querySelector("#storybook-root"), ...document.querySelectorAll(".ui-sheet-panel")];
            const found = [];
            const seen = new Set();
            function clippingContainer(textNode, root) {
              let node = textNode.parentElement;
              while (node instanceof HTMLElement && root.contains(node)) {
                const display = getComputedStyle(node).display;
                if (display !== "inline" && display !== "contents") return node;
                node = node.parentElement;
              }
              return null;
            }
            function measure(node) {
              if (!(node instanceof HTMLElement) || seen.has(node)) return;
              seen.add(node);
              const style = getComputedStyle(node);
              if (style.display === "none" || style.visibility === "hidden") return;
              const box = node.getBoundingClientRect();
              if (box.width <= 1 && box.height <= 1) return;
              if (node.getClientRects().length === 0) return;
              const range = document.createRange();
              range.selectNodeContents(node);
              let min = Infinity;
              let max = -Infinity;
              for (const rect of range.getClientRects()) {
                min = Math.min(min, rect.left);
                max = Math.max(max, rect.right);
              }
              if (!Number.isFinite(min) || !Number.isFinite(max)) return;
              found.push({
                textWidth: max - min,
                boxWidth: box.width,
                textOverflow: style.textOverflow,
                whiteSpace: style.whiteSpace,
                overflow: style.overflow,
                clipOk: node.matches(clipOkSelector),
                className: typeof node.className === "string" ? node.className : node.tagName,
                label: `${node.className || node.tagName} "${node.innerText.trim().replace(/\s+/g, " ").slice(0, 48)}"`,
              });
            }
            for (const root of roots) {
              if (!(root instanceof HTMLElement)) continue;
              const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
              let text = walker.nextNode();
              while (text) {
                if ((text.textContent ?? "").trim() !== "") {
                  const box = clippingContainer(text, root);
                  if (box) measure(box);
                }
                text = walker.nextNode();
              }
            }
            return found;
          }, CLIP_OK_SELECTOR);
          const elements = samples.map((sample) => {
            const overflow = Math.round(sample.textWidth - sample.boxWidth);
            const clipped = reportsClip(sample);
            if (clipped) report.failures.push(`${theme} ${String(width)} ${story.id}: ${sample.label} +${String(overflow)}px`);
            return {
              className: sample.className,
              label: sample.label,
              textWidth: sample.textWidth,
              boxWidth: sample.boxWidth,
              clipOk: sample.clipOk,
              clipped,
              overflow,
            };
          });
          report.measured += elements.length;
          if (elements.length === 0) {
            report.zeroMeasured.push(`${theme} ${String(width)} ${story.id}: measured nothing`);
          }
          report.views.push({
            theme,
            width,
            storyId: story.id,
            status: elements.length === 0 ? "measured-nothing" : "measured",
            elements,
          });
        }
      }
    }
  } catch (crash) {
    report.exit = 3;
    report.note = crash instanceof Error ? crash.message : "clip-check failed";
    try {
      await writeClipReport(reportDir, report);
    } catch {
      error("clip-check could not write the report");
    }
    throw crash;
  } finally {
    await browser?.close();
    await new Promise((resolve) => { server.close(resolve); });
  }
  const clipViews = clippedViewCount(report);
  if (report.storyErrors.length > 0 || report.didNotRender.length > 0 || report.zeroMeasured.length > 0) {
    if (report.storyErrors.length > 0) {
      error(report.storyErrors.join("\n"));
      error("clip-check failed. Storybook showed an error.");
    }
    if (report.didNotRender.length > 0) {
      error(report.didNotRender.join("\n"));
      error("clip-check failed. A story did not render.");
    }
    if (report.zeroMeasured.length > 0) {
      error(report.zeroMeasured.join("\n"));
      error("clip-check measured nothing.");
    }
    error(`clip-check found ${storyViewPhrase(clipViews)} that ${clipViews === 1 ? "clips" : "clip"}.`);
    return finish(2);
  }
  if (report.failures.length > 0) {
    error(report.failures.slice(0, 40).join("\n"));
    if (report.failures.length > 40) error(`stdout shows 40 of ${String(report.failures.length)} clips.`);
    error(`clip-check failed. ${storyViewPhrase(clipViews)} ${clipViews === 1 ? "clips" : "clip"} text.`);
    return finish(1);
  }
  const skipped = new Set(report.views.filter((view) => view.status === "skipped").map((view) => view.storyId)).size;
  log(passLine({
    stories: stories.length,
    skipped,
    measured: report.measured,
    themes,
    widths,
  }));
  return finish(0);
}

/** @param {Parameters<typeof run>[0]} [options] */
export async function execute(options) {
  try {
    return await run(options);
  } catch (error) {
    const write = options?.error ?? ((line) => { console.error(line); });
    const message = error instanceof Error ? error.message : "clip-check failed";
    write(message);
    const dir = options?.reportDir ?? clipReportDir();
    try {
      const existing = JSON.parse(await readFile(join(dir, "clip-report.json"), "utf8"));
      if (existing?.exit === 3 && existing.note === message) return 3;
    } catch {
      // This run has not written a report yet.
    }
    await removeReport(dir);
    try {
      await writeClipReport(dir, {
        exit: 3,
        stories: [],
        views: [],
        storyErrors: [],
        didNotRender: [],
        zeroMeasured: [],
        failures: [],
        measured: 0,
        note: message,
      });
    } catch {
      write("clip-check could not write the report");
    }
    return 3;
  }
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invoked) {
  execute().then((code) => {
    process.exit(code);
  });
}
