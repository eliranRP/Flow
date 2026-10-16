#!/usr/bin/env node
/**
 * Step 0b of the redesign sprint: a proof of each board frame against the running app. For each frame in
 * the frame map, it writes one PNG per theme: the board frame, the app screen and a diff, side by side at
 * 390x844 and dpr 2, with a mismatch percentage for the frame. The builder and the reviewer see where the
 * app differs and by how much. A second, text-masked percentage paints every app text box (padded 2px) over
 * both images first, so only layout, colour and spacing count: that number is the redesign gate (under 3%).
 *
 * Usage: node scripts/board-proof.mjs --base http://localhost:4173 --map <map.json> --out <dir> [--boards <dir>] [frame...]
 *
 * The map is JSON: { "<frame>": "<route>" }, where <frame> is the board frame's file name without the theme
 * suffix (Flow, FlowPicker, ...) and <route> is the app path the frame is drawn from (for example "/?preview=1").
 * The light theme's board is "<frame>Light.png", the dark theme's is "<frame>.png", both in --boards
 * (default /mnt/project-files/design/board-png).
 * Output: <out>/<frame>--<theme>.png, and <out>/summary.json with each frame's raw and text-masked mismatch.
 *
 * Render method: see the board renders note in team memory (redesign-approval-proofs). The app shot is
 * taken from a dev-fixture build served at --base; the board PNGs were rendered at the same size.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const THEME_NAMES = ["dark", "light"];
const PROOF_WIDTH = 390;
const PROOF_HEIGHT = 844;
const PROOF_DPR = 2;
/** A channel difference up to this (of 255) counts as the same pixel: anti-aliasing and sub-pixel text. */
const CHANNEL_TOLERANCE = 16;
const DEFAULT_BOARDS = "/mnt/project-files/design/board-png";

/**
 * @param {string[]} argv the arguments after the script name
 * @returns {{ base: string, map: string, out: string, boards: string, frames: string[] }}
 */
export function parseArgs(argv) {
  const options = { base: "", map: "", out: "", boards: DEFAULT_BOARDS, frames: /** @type {string[]} */ ([]) };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base" || arg === "--map" || arg === "--out" || arg === "--boards") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      if (arg === "--base") options.base = value;
      else if (arg === "--map") options.map = value;
      else if (arg === "--out") options.out = value;
      else options.boards = value;
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else {
      // A frame name becomes a file name under --out, so it may not carry a path.
      if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(arg)) throw new Error(`not a frame name: ${arg}`);
      options.frames.push(arg);
    }
  }
  if (options.base === "") throw new Error("--base is required (the running app, for example http://localhost:4173)");
  if (options.map === "") throw new Error("--map is required (the JSON frame map)");
  if (options.out === "") throw new Error("--out is required (the folder for the PNGs)");
  return options;
}

/**
 * @param {unknown} map the parsed JSON
 * @returns {Record<string, string>} frame name → app route; throws on a malformed map
 */
export function readFrameMap(map) {
  if (map === null || typeof map !== "object" || Array.isArray(map)) throw new Error("the frame map must be a JSON object");
  const frames = /** @type {Record<string, string>} */ ({});
  for (const [frame, route] of Object.entries(map)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(frame)) throw new Error(`not a frame name: ${frame}`);
    if (typeof route !== "string" || !route.startsWith("/")) throw new Error(`the route for ${frame} must start with /`);
    frames[frame] = route;
  }
  return frames;
}

/** @returns {string} the board PNG's file name for a frame in one theme */
export function boardFileName(frame, theme) {
  return theme === "light" ? `${frame}Light.png` : `${frame}.png`;
}

/** @returns {string} the proof PNG's file name for a frame in one theme */
export function proofFileName(frame, theme) {
  return `${frame}--${theme}.png`;
}

/**
 * The shots to take, in order: every frame in the map, both themes.
 * @param {Record<string, string>} frames the frame map
 * @param {string[]} only frame names to keep (empty keeps all)
 * @param {string} boards the folder with the board PNGs
 * @param {string} out the output folder
 * @returns {Array<{ frame: string, theme: string, route: string, board: string, file: string }>}
 */
export function proofPlan(frames, only, boards, out) {
  const names = Object.keys(frames).sort();
  const picked = only.length === 0 ? names : names.filter((name) => only.includes(name));
  const unknown = only.filter((name) => !(name in frames));
  if (unknown.length > 0) throw new Error(`not in the frame map: ${unknown.join(", ")}`);
  const plan = [];
  for (const frame of picked) {
    for (const theme of THEME_NAMES) {
      plan.push({
        frame,
        theme,
        route: frames[frame],
        board: path.join(boards, boardFileName(frame, theme)),
        file: path.join(out, proofFileName(frame, theme)),
      });
    }
  }
  return plan;
}

/**
 * The share of pixels that differ, from two RGBA buffers of the same size. A pixel differs when any of its
 * colour channels is more than the tolerance apart. Alpha is ignored: the proofs are opaque.
 * Pure, so the browser can run it as a function (see proofInBrowser).
 * @param {ArrayLike<number>} a RGBA values
 * @param {ArrayLike<number>} b RGBA values, the same length as a
 * @param {number} tolerance the largest allowed channel difference
 * @returns {number} the mismatch as a percentage, to one decimal place
 */
export function mismatchPercent(a, b, tolerance) {
  if (a.length !== b.length) throw new Error("the two images differ in size");
  const pixels = a.length / 4;
  if (pixels === 0) return 0;
  let differing = 0;
  for (let index = 0; index < a.length; index += 4) {
    const differs =
      Math.abs(a[index] - b[index]) > tolerance ||
      Math.abs(a[index + 1] - b[index + 1]) > tolerance ||
      Math.abs(a[index + 2] - b[index + 2]) > tolerance;
    if (differs) differing += 1;
  }
  return Math.round((differing / pixels) * 1000) / 10;
}

/**
 * Runs in the page: draws the board and the app shot to canvases of the same size, makes the diff,
 * and returns the three panels side by side as a PNG data URL with the mismatch.
 * @param {{ boardUrl: string, appUrl: string, width: number, height: number, tolerance: number, mismatchSource: string, textRects: Array<{ x: number, y: number, w: number, h: number }>, scale: number }} input
 */
async function proofInBrowser(input) {
  const mismatch = new Function(`return (${input.mismatchSource});`)();
  const load = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`could not load ${src.slice(0, 60)}`));
      img.src = src;
    });
  const [board, app] = await Promise.all([load(input.boardUrl), load(input.appUrl)]);
  const w = input.width;
  const h = input.height;
  const canvas = (cw, ch) => Object.assign(document.createElement("canvas"), { width: cw, height: ch });
  const draw = (img) => {
    const c = canvas(w, h);
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    return c;
  };
  const boardCanvas = draw(board);
  const appCanvas = draw(app);
  const boardData = boardCanvas.getContext("2d").getImageData(0, 0, w, h).data;
  const appData = appCanvas.getContext("2d").getImageData(0, 0, w, h).data;
  const masked = (img) => {
    const c = draw(img);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#000";
    for (const rect of input.textRects) ctx.fillRect(rect.x * input.scale, rect.y * input.scale, rect.w * input.scale, rect.h * input.scale);
    return ctx.getImageData(0, 0, w, h).data;
  };
  const diffData = new Uint8ClampedArray(boardData.length);
  for (let index = 0; index < boardData.length; index += 4) {
    const differs =
      Math.abs(boardData[index] - appData[index]) > input.tolerance ||
      Math.abs(boardData[index + 1] - appData[index + 1]) > input.tolerance ||
      Math.abs(boardData[index + 2] - appData[index + 2]) > input.tolerance;
    diffData[index] = differs ? 255 : boardData[index] * 0.25;
    diffData[index + 1] = differs ? 40 : boardData[index + 1] * 0.25;
    diffData[index + 2] = differs ? 40 : boardData[index + 2] * 0.25;
    diffData[index + 3] = 255;
  }
  const diffCanvas = canvas(w, h);
  diffCanvas.getContext("2d").putImageData(new ImageData(diffData, w, h), 0, 0);
  const gap = 12;
  const out = canvas(w * 3 + gap * 2, h);
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(boardCanvas, 0, 0);
  ctx.drawImage(appCanvas, w + gap, 0);
  ctx.drawImage(diffCanvas, (w + gap) * 2, 0);
  return {
    png: out.toDataURL("image/png"),
    mismatch: mismatch(boardData, appData, input.tolerance),
    masked: mismatch(masked(board), masked(app), input.tolerance),
    masks: input.textRects.length,
  };
}

/**
 * Runs in the page: the box of every text node on the app screen, in CSS px, each padded by 2px.
 * @returns {Array<{ x: number, y: number, w: number, h: number }>}
 */
function collectTextRects() {
  const rects = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node != null; node = walker.nextNode()) {
    if (node.textContent == null || node.textContent.trim() === "") continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const box of range.getClientRects()) {
      if (box.width < 1 || box.height < 1) continue;
      rects.push({ x: box.left - 2, y: box.top - 2, w: box.width + 4, h: box.height + 4 });
    }
  }
  return rects;
}

/** Takes the proofs for the planned shots and writes the PNGs and the summary. */
async function main(argv) {
  const options = parseArgs(argv);
  const frames = readFrameMap(JSON.parse(readFileSync(options.map, "utf8")));
  const plan = proofPlan(frames, options.frames, options.boards, options.out);
  mkdirSync(options.out, { recursive: true });
  const require = createRequire(path.join(process.cwd(), "app", "package.json"));
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ executablePath: process.env.FLOW_CHROMIUM || undefined });
  const summary = /** @type {Record<string, Record<string, number>>} */ ({});
  try {
    for (const shot of plan) {
      // A frame drawn in one theme only (no board PNG for this theme, but one for the other) gets one
      // shot, not a crash. A frame with no board in any theme is a wrong --boards folder or a typo.
      if (!existsSync(shot.board)) {
        const drawnElsewhere = plan.some((other) => other.frame === shot.frame && existsSync(other.board));
        if (!drawnElsewhere) throw new Error(`no board PNG for ${shot.frame} in any theme: ${shot.board}`);
        console.warn(`skipped ${shot.frame} ${shot.theme}: drawn in one theme only`);
        continue;
      }
      const context = await browser.newContext({
        viewport: { width: PROOF_WIDTH, height: PROOF_HEIGHT },
        deviceScaleFactor: PROOF_DPR,
        colorScheme: shot.theme,
      });
      const page = await context.newPage();
      await page.goto(new URL(shot.route, options.base).toString(), { waitUntil: "networkidle" });
      const appPng = await page.screenshot({ fullPage: false });
      const textRects = await page.evaluate(collectTextRects);
      await context.close();
      const boardUrl = `data:image/png;base64,${readFileSync(shot.board).toString("base64")}`;
      const appUrl = `data:image/png;base64,${appPng.toString("base64")}`;
      const proofPage = await browser.newPage();
      const result = await proofPage.evaluate(proofInBrowser, {
        boardUrl,
        appUrl,
        width: PROOF_WIDTH * PROOF_DPR,
        height: PROOF_HEIGHT * PROOF_DPR,
        tolerance: CHANNEL_TOLERANCE,
        mismatchSource: mismatchPercent.toString(),
        textRects,
        scale: PROOF_DPR,
      });
      await proofPage.close();
      writeFileSync(shot.file, Buffer.from(result.png.split(",")[1], "base64"));
      summary[shot.frame] = {
        ...summary[shot.frame],
        [shot.theme]: result.mismatch,
        [`${shot.theme}Masked`]: result.masked,
        [`${shot.theme}Masks`]: result.masks,
      };
      console.log(`${shot.frame} ${shot.theme}: ${result.mismatch}% mismatch, ${result.masked}% text-masked (${result.masks} boxes)`);
    }
  } finally {
    await browser.close();
  }
  // An empty run is a failed run: nothing was compared, so there is no number to gate on.
  if (Object.keys(summary).length === 0) throw new Error("no frame was compared; check the map and the --boards folder");
  writeFileSync(path.join(options.out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
