#!/usr/bin/env node
/**
 * FLOW-826: what Home's first load costs on this branch, against a base (main, by default the fork
 * point), so a change that claims to load faster can show it and one that loads slower is caught.
 *
 * Sizes (deterministic, the gate): the gzip of the JavaScript and CSS index.html loads before Home
 * shows, the raw bytes of that JavaScript (what the phone parses), all JavaScript gzipped, and the
 * number of chunks. Speed (--speed N, a report): Home ready on /?preview=1 at the FLOW-804 phone
 * (CPU x4, 4G), base and branch served side by side and timed alternately, N runs each, median.
 *
 * The base is built once per git tree in a temporary worktree and its numbers are cached, so a
 * second run against the same main costs one build.
 *
 * Usage: node scripts/load-report.mjs [--base <ref>] [--speed <runs>] [--report-only] [--json <file>]
 * FLOW_LOAD_ALLOW=1 reports a growth without failing: a feature that Home needs, said in the PR.
 * Exit codes: 0 no regression, 1 a size grew past its allowance (or speed, with --speed), 2 a build failed.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { entryFiles, gzipBytes, measure } from "./check-bundle-budget.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Growth each size may take before the gate fails (bytes). */
export const allowance = { entryJsGzip: 2048, entryCssGzip: 1024, entryJsRaw: 8192, totalJsGzip: 5120 };
/**
 * Speed fails only when the branch was slower in most paired runs (base and branch timed back to
 * back) and its median is past both a relative and an absolute slowdown. Two identical builds timed
 * on a busy container differed by 20% in their medians, so a median alone would cry wolf.
 */
export const speedAllowance = { ratio: 0.15, ms: 100, slowerShare: 0.8 };

/** @param {string} dist */
export function sizes(dist) {
  const html = readFileSync(path.join(dist, "index.html"), "utf8");
  const files = entryFiles(html);
  const read = (file) => readFileSync(path.join(dist, file));
  const js = files.filter((file) => file.endsWith(".js"));
  const css = files.filter((file) => file.endsWith(".css"));
  const assets = path.join(dist, "assets");
  return {
    entryJsGzip: js.reduce((sum, file) => sum + gzipBytes(read(file)), 0),
    entryCssGzip: css.reduce((sum, file) => sum + gzipBytes(read(file)), 0),
    entryJsRaw: js.reduce((sum, file) => sum + read(file).length, 0),
    totalJsGzip: measure(dist).totalJsGzip,
    chunks: existsSync(assets) ? readdirSync(assets).filter((name) => name.endsWith(".js")).length : 0,
  };
}

/**
 * One row per metric, and the lines that break an allowance.
 * @param {Record<string, number>} base
 * @param {Record<string, number>} head
 */
export function compare(base, head) {
  const rows = [];
  const regressions = [];
  for (const key of Object.keys(head)) {
    if (base[key] == null) continue;
    const delta = head[key] - base[key];
    rows.push({ key, base: base[key], head: head[key], delta });
    if (key in allowance && delta > allowance[/** @type {keyof typeof allowance} */ (key)]) {
      regressions.push(`${key} grew by ${fmt(key, delta)} (allowed ${fmt(key, allowance[/** @type {keyof typeof allowance} */ (key)])}).`);
    }
    if (key === "homeReadyMs" && delta > speedAllowance.ms && delta > base[key] * speedAllowance.ratio
      && (head.slowerShare ?? 1) >= speedAllowance.slowerShare) {
      regressions.push(`homeReadyMs grew by ${String(delta)} ms (${((delta / base[key]) * 100).toFixed(0)}%), slower in ${String(Math.round((head.slowerShare ?? 1) * 100))}% of paired runs.`);
    }
  }
  return { rows, regressions };
}

/** @param {string} key @param {number} value */
function fmt(key, value) {
  if (key === "chunks" || key.endsWith("Ms")) return String(Math.round(value));
  return `${(value / 1024).toFixed(1)} KB`;
}

/** @param {{ key: string, base: number, head: number, delta: number }[]} rows */
export function table(rows) {
  const lines = ["| metric | base | branch | change |", "| --- | ---: | ---: | ---: |"];
  for (const row of rows) {
    const sign = row.delta > 0 ? "+" : row.delta < 0 ? "−" : "";
    lines.push(`| ${row.key} | ${fmt(row.key, row.base)} | ${fmt(row.key, row.head)} | ${sign}${fmt(row.key, Math.abs(row.delta))} |`);
  }
  return lines.join("\n");
}

/** The build the speed tests use: the perf stub backend, so /?preview=1 needs no server. */
function build(checkout, outDir) {
  const out = outDir ? ["--outDir", outDir, "--emptyOutDir"] : [];
  execFileSync("pnpm", ["--filter", "@flow/app", "exec", "vite", "build", ...out, "--logLevel", "error"], {
    cwd: checkout,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, VITE_SUPABASE_URL: "http://127.0.0.1:43199", VITE_SUPABASE_ANON_KEY: "perf-stub-anon-key" },
  });
}

function cacheDir() {
  const dir = process.env.FLOW_LOCAL_CI_CACHE ?? path.join(git(["rev-parse", "--git-common-dir"]), "flow-local-ci-cache");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** @param {string[]} args */
function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** Builds `ref` in a throwaway worktree; returns its dist (kept for --speed) and a cleanup. */
function buildBase(ref, work) {
  const checkout = path.join(work, "base");
  git(["worktree", "add", "--detach", "--force", checkout, ref]);
  execFileSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline", "--silent"], { cwd: checkout, stdio: ["ignore", "ignore", "inherit"] });
  // Its own app/dist: a base older than FLOW-826 copies its 404 page from there whatever --outDir says.
  build(checkout);
  const dist = path.join(checkout, "app/dist");
  return { dist, cleanup: () => git(["worktree", "remove", "--force", checkout]) };
}

/** @param {string} dist @param {number} port */
function serve(dist, port) {
  const child = spawn(process.execPath, [path.join(root, "scripts/serve-dist.mjs"), dist, String(port)], { stdio: "ignore" });
  return child;
}

/** Home ready on /?preview=1 at the FLOW-804 phone, alternating base and branch. */
async function speed(dists, runs) {
  const require = createRequire(path.join(root, "app/package.json"));
  const { chromium } = require("playwright");
  const servers = dists.map((dist, i) => serve(dist, 43150 + i));
  await new Promise((resolve) => setTimeout(resolve, 500));
  const executablePath = process.env.FLOW_CHROMIUM_PATH || undefined;
  const browser = await chromium.launch({ executablePath });
  const times = dists.map(() => /** @type {number[]} */ ([]));
  try {
    for (let run = 0; run < runs; run += 1) {
      for (let i = 0; i < dists.length; i += 1) {
        const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await cdp.send("Network.enable");
        await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 85, downloadThroughput: 9_000_000 / 8, uploadThroughput: 1_500_000 / 8 });
        const start = Date.now();
        await page.goto(`http://127.0.0.1:${String(43150 + i)}/?preview=1`, { waitUntil: "commit" });
        await page.getByRole("navigation", { name: "ניווט ראשי" }).waitFor({ state: "visible", timeout: 30_000 });
        times[i].push(Date.now() - start);
        await context.close();
      }
    }
  } finally {
    await browser.close();
    for (const server of servers) server.kill();
  }
  const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] ?? 0;
  const slower = times[1].filter((ms, run) => ms > (times[0][run] ?? 0)).length;
  return { medians: times.map(median), slowerShare: slower / runs };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const runs = Number(opt("--speed") ?? 0);
  const ref = opt("--base") ?? git(["merge-base", "HEAD", "origin/main"]);
  const work = mkdtempSync(path.join(os.tmpdir(), "flow-load-"));
  try {
    const headDist = path.join(work, "head-dist");
    build(root, headDist);
    const head = sizes(headDist);
    const tree = git(["rev-parse", `${ref}^{tree}`]);
    const cached = path.join(cacheDir(), `load-base-${tree}.json`);
    let base = existsSync(cached) && !runs ? JSON.parse(readFileSync(cached, "utf8")) : null;
    let baseBuild = null;
    if (!base) {
      baseBuild = buildBase(ref, work);
      base = sizes(baseBuild.dist);
      writeFileSync(cached, JSON.stringify(base));
    }
    if (runs > 0 && baseBuild) {
      const { medians, slowerShare } = await speed([baseBuild.dist, headDist], runs);
      [base.homeReadyMs, head.homeReadyMs] = medians;
      head.slowerShare = slowerShare;
    }
    baseBuild?.cleanup();
    const { rows, regressions } = compare(base, head);
    console.log(`Load report: ${git(["rev-parse", "--short", "HEAD"])} against ${ref.slice(0, 12)}${runs ? `, speed median of ${String(runs)}` : ""}\n`);
    console.log(table(rows));
    if (head.slowerShare != null) console.log(`\nThe branch was slower in ${String(Math.round(head.slowerShare * runs))} of ${String(runs)} paired runs.`);
    if (opt("--json")) writeFileSync(opt("--json"), JSON.stringify({ base, head, regressions }, null, 2));
    if (regressions.length > 0) {
      console.error(`\nload-report: ${regressions.join(" ")}`);
      console.error("Keep the new code out of Home's first load (a lazy import), or say in the PR why Home needs it.");
      if (!args.includes("--report-only") && !process.env.FLOW_LOAD_ALLOW) process.exitCode = 1;
    }
  } catch (error) {
    console.error(`load-report: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
