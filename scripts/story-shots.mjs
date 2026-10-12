#!/usr/bin/env node
/**
 * FLOW-363: screenshots of Storybook stories for review, in both themes and at the two widths the
 * design is drawn at (320 and 393). Serves a built Storybook (app/storybook-static) the way
 * scripts/clip-check.mjs does, and writes one full-page PNG per story, theme and width.
 *
 * Usage: node scripts/story-shots.mjs --dir app/storybook-static --out <dir> <storyId>...
 * Theme goes in the URL (globals=theme:<t>); the width is set on the page (setViewportSize).
 * File names: <out>/<storyId>--<theme>-<width>.png
 */
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listenStatic } from "./clip-check.mjs";

export const THEME_NAMES = ["dark", "light"];
export const SHOT_WIDTHS = [320, 393];
/** The height the pages are drawn at (the Flow 390/320 viewports are 844 tall). */
export const SHOT_HEIGHT = 844;
/** Used only when Playwright's own browser cannot be launched. */
export const FALLBACK_CHROMIUM = "/opt/pw-browsers/chromium";

/**
 * @param {string[]} argv the arguments after the script name
 * @returns {{ dir: string, out: string, ids: string[] }}
 */
export function parseArgs(argv) {
  const options = { dir: "", out: "", ids: /** @type {string[]} */ ([]) };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dir" || arg === "--out") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      if (arg === "--dir") options.dir = value;
      else options.out = value;
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else {
      // A story id becomes a file name under --out, so it may not carry a path (Storybook ids are kebab case).
      if (!/^[a-z0-9][a-z0-9-]*$/.test(arg)) throw new Error(`not a story id: ${arg}`);
      options.ids.push(arg);
    }
  }
  if (options.dir === "") throw new Error("--dir is required (the built Storybook folder)");
  if (options.out === "") throw new Error("--out is required (the folder for the PNGs)");
  if (options.ids.length === 0) throw new Error("give at least one story id");
  return options;
}

/** @returns {string} the PNG file name for one story, theme and width */
export function shotFileName(storyId, theme, width) {
  return `${storyId}--${theme}-${String(width)}.png`;
}

/** @returns {Array<{ id: string, theme: string, width: number, file: string }>} every shot to take, in order */
export function shotPlan(ids) {
  const plan = [];
  for (const id of ids) {
    for (const theme of THEME_NAMES) {
      for (const width of SHOT_WIDTHS) {
        plan.push({ id, theme, width, file: shotFileName(id, theme, width) });
      }
    }
  }
  return plan;
}

/** @returns {string} the iframe path for a story in one theme (the width is set on the page) */
export function storyPath(storyId, theme) {
  return `/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story&globals=theme:${theme}`;
}

async function launchBrowser() {
  const require = createRequire(new URL("../app/package.json", import.meta.url));
  const { chromium } = require("playwright");
  try {
    return await chromium.launch();
  } catch (error) {
    if (!existsSync(FALLBACK_CHROMIUM)) throw error;
    return chromium.launch({ executablePath: FALLBACK_CHROMIUM });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const staticDir = path.resolve(options.dir);
  const outDir = path.resolve(options.out);
  if (!existsSync(path.join(staticDir, "iframe.html"))) {
    throw new Error(`${staticDir} has no iframe.html: build Storybook first (pnpm build-storybook)`);
  }
  mkdirSync(outDir, { recursive: true });
  const { server, port } = await listenStatic(staticDir);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const written = [];
    for (const shot of shotPlan(options.ids)) {
      await page.setViewportSize({ width: shot.width, height: SHOT_HEIGHT });
      await page.goto(`http://127.0.0.1:${String(port)}${storyPath(shot.id, shot.theme)}`, { waitUntil: "domcontentloaded" });
      await page.locator("#storybook-root").waitFor({ state: "attached", timeout: 30_000 });
      await page.waitForFunction(() => {
        if (document.body.classList.contains("sb-show-errordisplay")) return true;
        const root = document.querySelector("#storybook-root");
        return root instanceof HTMLElement && root.childElementCount > 0;
      }, undefined, { timeout: 30_000 });
      if (await page.evaluate(() => document.body.classList.contains("sb-show-errordisplay"))) {
        throw new Error(`${shot.id}: Storybook could not render the story`);
      }
      await page.evaluate(() => document.fonts.ready);
      // Shoot the settled state: wait for every finite animation (a bar's 480ms grow, a page enter).
      // Loops (spinners, the skeleton pulse) never finish, so they are left out.
      await page.evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => undefined)),
        ),
      );
      const file = path.join(outDir, shot.file);
      await page.screenshot({ path: file, fullPage: true });
      written.push(file);
    }
    for (const file of written) console.log(file);
  } finally {
    await browser.close();
    server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
