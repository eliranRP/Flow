#!/usr/bin/env node
/**
 * Renders the design board's dev-ready artboards to PNGs, so board-proof compares against the current board
 * and never against an old image. It serves the board project (canvas.json and the *.dc.html frames) with the
 * board runtime, opens each artboard in Chromium at 390x844 and dpr 2, and writes <out>/<Frame>.png for the
 * dark artboards and <out>/<Frame>Light.png for the light twins. Only the "ready" and "light" pages are drawn.
 *
 * Usage: node scripts/board-render.mjs --project <dir with canvas.json and *.dc.html> --runtime <dc-runtime.js> --out <dir>
 *
 * The output is local render output: never commit it, and never commit the board HTML either (public repo).
 * Set FLOW_CHROMIUM to an installed Chromium if Playwright has no browser of its own.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The board pages that are drawn. The "explore" page and any other page are not targets. */
export const TARGET_PAGES = ["ready", "light"];
const PROOF_WIDTH = 390;
const PROOF_HEIGHT = 844;
const PROOF_DPR = 2;
const SETTLE_MS = 900;
const RUNTIME_URL = "/support.js";
const LIGHT_SUFFIX = "Light";
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

/**
 * @param {string[]} argv the arguments after the script name
 * @returns {{ project: string, runtime: string, out: string }}
 */
export function parseArgs(argv) {
  const options = { project: "", runtime: "", out: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--project" || arg === "--runtime" || arg === "--out") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      if (arg === "--project") options.project = value;
      else if (arg === "--runtime") options.runtime = value;
      else options.out = value;
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else {
      throw new Error(`unexpected argument ${arg}`);
    }
  }
  if (options.project === "") throw new Error("--project is required (the board project folder)");
  if (options.runtime === "") throw new Error("--runtime is required (the board's dc-runtime.js)");
  if (options.out === "") throw new Error("--out is required (the folder for the PNGs)");
  return options;
}

/**
 * The artboards to draw, sorted by name. The page of an artboard with no page is the canvas's first page.
 * @param {{ pages?: Array<{ id: string }>, boards?: Record<string, { page?: string }> }} canvas the parsed canvas.json
 * @returns {Array<{ name: string, file: string, page: string | undefined }>}
 */
export function selectBoards(canvas) {
  if (!canvas.boards) throw new Error("canvas.json has no boards");
  const firstPage = canvas.pages?.[0]?.id;
  return Object.entries(canvas.boards)
    .map(([file, board]) => ({ name: file.replace(/\.dc\.html$/, ""), file, page: board.page ?? firstPage }))
    .filter((board) => TARGET_PAGES.includes(board.page ?? ""))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** @returns {string} the PNG's file name for an artboard name */
export function pngFileName(name) {
  return `${name}.png`;
}

/**
 * The frame an artboard is a theme of: one trailing "Light" is removed ("FlowLight" is "Flow"). A bare "Light"
 * has nothing before it, so it stays "Light".
 * @param {string} name the artboard name, without .dc.html
 * @returns {string}
 */
export function frameOf(name) {
  return name.length > LIGHT_SUFFIX.length && name.endsWith(LIGHT_SUFFIX) ? name.slice(0, -LIGHT_SUFFIX.length) : name;
}

/** @returns {boolean} whether the artboard is on the light page */
export function isLightBoard(board) {
  return board.page === "light";
}

/**
 * The file that answers a request path, or null. The runtime is served at /support.js; any other path is a file
 * inside the project folder. A path that leaves the folder, or the root path, gets null.
 * @param {string} urlPath the request's path, without a query string
 * @param {string} projectDir the board project folder
 * @param {string} runtimeFile the board runtime's file
 * @returns {string | null}
 */
export function resolveRequest(urlPath, projectDir, runtimeFile) {
  if (urlPath === RUNTIME_URL) return runtimeFile;
  if (urlPath === "/" || urlPath === "") return null;
  let relative;
  try {
    relative = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const root = path.resolve(projectDir);
  const file = path.resolve(root, `.${relative}`);
  return file.startsWith(root + path.sep) ? file : null;
}

/** @returns {string} the Content-Type for a file, by its extension */
export function contentType(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Renders the boards. Playwright loads here, so importing this module needs no browser. */
async function main(argv) {
  const options = parseArgs(argv);
  const projectDir = path.resolve(options.project);
  const runtimeFile = path.resolve(options.runtime);
  const canvas = JSON.parse(readFileSync(path.join(projectDir, "canvas.json"), "utf8"));
  const boards = selectBoards(canvas);
  if (boards.length === 0) throw new Error(`no artboard on the ${TARGET_PAGES.join(" or ")} pages in ${projectDir}`);
  mkdirSync(options.out, { recursive: true });

  const server = createServer((req, res) => {
    const urlPath = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const file = resolveRequest(urlPath, projectDir, runtimeFile);
    if (file === null || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": contentType(file) });
    createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());

  const require = createRequire(path.join(process.cwd(), "app", "package.json"));
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ executablePath: process.env.FLOW_CHROMIUM || undefined });
  const errors = /** @type {string[]} */ ([]);
  let rendered = 0;
  try {
    const page = await browser.newPage({
      viewport: { width: PROOF_WIDTH, height: PROOF_HEIGHT },
      deviceScaleFactor: PROOF_DPR,
    });
    page.on("pageerror", (error) => errors.push(String(error)));
    for (const board of boards) {
      await page.goto(`http://127.0.0.1:${port}/${encodeURIComponent(board.file)}`);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(SETTLE_MS);
      await page.screenshot({ path: path.join(options.out, pngFileName(board.name)) });
      rendered += 1;
    }
  } finally {
    await browser.close();
    server.close();
  }
  const pages = [...new Set(boards.map((board) => board.page))];
  console.log(JSON.stringify({ rendered, pages, errors: errors.slice(0, 5) }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
