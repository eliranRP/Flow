#!/usr/bin/env node
/**
 * FLOW-1276: the three times of decision 0271 for Home and every main screen, on the FLOW-804 phone
 * (412x915 mobile, CPU x4, 85 ms latency, 9 Mbps down, 1.5 Mbps up), plus where the time goes.
 *
 * Usage:
 *   node scripts/screen-sweep.mjs <base-url> <session-file> [--project <id>] [--runs 3] [--only a,b] [--json]
 *   FLOW_SWEEP_URL, FLOW_SWEEP_SESSION and FLOW_SWEEP_PROJECT stand in for the arguments;
 *   FLOW_CHROMIUM_PATH picks the browser (as load-report.mjs does); pnpm sweep runs this file.
 *
 * <session-file> is a Supabase session JSON (access_token and refresh_token) that the caller already
 * has, for a test user. The script never mints a session and calls no admin endpoint. It only puts
 * the file's text into the page's localStorage under the app's auth key (sb-<project ref>-auth-token,
 * the ref from VITE_SUPABASE_URL in app/.env.production, or FLOW_SWEEP_SUPABASE_URL), and never
 * prints, logs or writes it. Use a session whose access token has at least 15 minutes left, so no
 * run refreshes (and so spends) the refresh token.
 *
 * Each state of each screen runs in its own fresh browser; every run's values are kept:
 * - first visit: a fresh context with an empty store, Home settled, then an in-app visit
 *   (history.pushState and popstate, as a tap does). navigator.connection.saveData is on, which turns
 *   the background reads off (0271), so only this visit's own reads count. Time until no skeleton.
 * - data shown: a context that has visited the screen (same path and query) and is then reopened, so
 *   its kept data is on the device; Home settles, then the in-app visit. Time until no skeleton.
 * - fresh data shown: the same visit, until every read the visit started in its first 6 s has
 *   answered and the page has stopped changing: the last such response, then the quiet frame (a frame
 *   after which no DOM change follows within 100 ms). It comes from the requests, not from the hint.
 * No skeleton is none of .ui-skeleton-bar, .ui-skel-row, .ui-skel-leaving, [aria-busy=true] and
 * .ui-chart-skel, after the screen's first DOM change. (An updating hint marked aria-busy would
 * delay data shown to fresh data shown.)
 * Cold Home is the app opened at "/" and timed from navigation start, in the same two contexts.
 *
 * The split is of the same visit's 6 s window: main thread (CDP Performance TaskDuration delta, an
 * upper bound as it includes work after the page settles), network busy (the union of the Supabase
 * REST request intervals, started in the window), waves (request starts more than 250 ms apart),
 * requests and KB (encoded bytes received). Results: medians with every run, as a table, or as JSON.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WINDOW_MS = 6000;
const QUIET_MS = 100;
const WAVE_GAP_MS = 250;
const SKELETON = ".ui-skeleton-bar, .ui-skel-row, .ui-skel-leaving, [aria-busy=true], .ui-chart-skel";
const NAV = 'nav[aria-label="ניווט ראשי"]';
const REST = /\/rest\/v1\//;

/** The screens, in report order. `{id}` is the project id; the cold Home visits "/" as a first load. */
const SCREENS = [
  { name: "Home (cold)", key: "home", path: "/", cold: true },
  { name: "Projects", key: "projects", path: "/projects" },
  { name: "Project page", key: "project", path: "/projects/{id}" },
  { name: "Loans", key: "loans", path: "/loans" },
  { name: "Recurring", key: "recurring", path: "/recurring" },
  { name: "Profit, month", key: "profit-month", path: "/profit" },
  { name: "Profit, year", key: "profit-year", path: "/profit?period=year" },
  { name: "Profit, by date", key: "profit-date", path: "/profit?by=date" },
  { name: "Review", key: "review", path: "/review" },
  { name: "Forecast", key: "forecast", path: "/forecast" },
];

function parseArgs(argv) {
  const out = { positional: [], runs: 3, project: process.env.FLOW_SWEEP_PROJECT, only: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") out.json = true;
    else if (arg === "--runs") out.runs = Number(argv[++i]);
    else if (arg === "--project") out.project = argv[++i];
    else if (arg === "--only") out.only = (argv[++i] ?? "").split(",");
    else if (arg.startsWith("--")) fail(`Unknown option ${arg}.`);
    else out.positional.push(arg);
  }
  out.base = (out.positional[0] ?? process.env.FLOW_SWEEP_URL ?? "").replace(/\/+$/, "");
  out.sessionFile = out.positional[1] ?? process.env.FLOW_SWEEP_SESSION;
  if (!out.base || !out.sessionFile) fail("Usage: node scripts/screen-sweep.mjs <base-url> <session-file> [--project <id>] [--runs 3] [--only a,b] [--json]");
  if (!Number.isInteger(out.runs) || out.runs < 1) fail("--runs takes a whole number, 1 or more.");
  return out;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const progress = (line) => process.stderr.write(`${line}\n`);

/** The Supabase auth key the app's client uses: sb-<first label of the project host>-auth-token. */
function authKey() {
  let url = process.env.FLOW_SWEEP_SUPABASE_URL;
  if (!url) {
    const env = readFileSync(path.join(root, "app/.env.production"), "utf8");
    url = /^VITE_SUPABASE_URL=(.+)$/m.exec(env)?.[1]?.trim();
  }
  if (!url) fail("No VITE_SUPABASE_URL in app/.env.production (or FLOW_SWEEP_SUPABASE_URL).");
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

/** Reads the session file; returns its text for localStorage. Complains without echoing any of it. */
function readSession(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
    const session = JSON.parse(text);
    if (typeof session.access_token !== "string" || typeof session.refresh_token !== "string") throw new Error("shape");
    const exp = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString("utf8")).exp;
    if (typeof exp === "number" && exp * 1000 - Date.now() < 15 * 60_000) {
      progress("Warning: the session's access token has under 15 minutes left; a run may refresh it.");
    }
    if (typeof session.expires_at !== "number" && typeof exp === "number") session.expires_at = exp;
    return JSON.stringify(session);
  } catch {
    return fail("The session file is not a Supabase session JSON with access_token and refresh_token.");
  }
}

/** Runs in the page from document start: the DOM-change frames, and when no skeleton is left. */
function recorder({ sel, nav, saveData }) {
  const epoch = () => performance.timeOrigin + performance.now();
  const s = { t0: performance.timeOrigin, mut: [], shown: null, saw: true, needNav: true };
  window.__sweep = s;
  window.__sweepBegin = () => Object.assign(s, { t0: epoch(), mut: [], shown: null, saw: false, needNav: false });
  if (saveData) {
    try {
      Object.defineProperty(navigator.connection, "saveData", { get: () => true });
    } catch { /* no connection API: nothing to turn off */ }
  }
  new MutationObserver(() => {
    s.saw = true;
    requestAnimationFrame(() => { s.mut.push(epoch()); });
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const tick = () => {
    const ready = s.saw && (!s.needNav || document.querySelector(nav) !== null);
    if (document.querySelector(sel) !== null || !ready) s.shown = null;
    else if (s.shown === null) s.shown = epoch();
    requestAnimationFrame(tick);
  };
  tick();
}

/** A fresh browser for one visit state: its context, with the session set (once) and the phone profile. */
async function openBrowser(chromium, { key, session }) {
  const browser = await chromium.launch({ executablePath: process.env.FLOW_CHROMIUM_PATH || undefined });
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  // Only when absent: a reopened page keeps the token the app has since refreshed.
  await context.addInitScript(([k, v]) => {
    try { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); } catch { /* storage blocked */ }
  }, [key, session]);
  return { browser, context };
}

/** A page on the phone profile that records its Supabase REST reads, in epoch milliseconds. */
async function openPhone(context, { saveData }) {
  const page = await context.newPage();
  await page.addInitScript(recorder, { sel: SKELETON, nav: NAV, saveData });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Performance.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 85, downloadThroughput: 9_000_000 / 8, uploadThroughput: 1_500_000 / 8 });
  const reads = new Map();
  cdp.on("Network.requestWillBeSent", (e) => {
    if (reads.has(e.requestId) || !REST.test(e.request.url) || e.request.method === "OPTIONS" || e.type === "Preflight") return;
    reads.set(e.requestId, { start: e.wallTime * 1000, stamp: e.timestamp, end: null, bytes: 0 });
  });
  const done = (e, bytes) => {
    const read = reads.get(e.requestId);
    if (read) Object.assign(read, { end: read.start + (e.timestamp - read.stamp) * 1000, bytes });
  };
  cdp.on("Network.loadingFinished", (e) => { done(e, e.encodedDataLength); });
  cdp.on("Network.loadingFailed", (e) => { done(e, 0); });
  const taskMs = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    return (metrics.find((m) => m.name === "TaskDuration")?.value ?? 0) * 1000;
  };
  return { page, reads, taskMs };
}

/** Waits for Home's navigation to show, then for the network to go quiet, as a user's moment on Home. */
async function settleHome(page) {
  await page.locator(NAV).waitFor({ timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
}

/** Opens the app at "/" and, for a first load, times it; otherwise settles Home. */
async function openHome(phone, base, { timed }) {
  const before = await phone.taskMs();
  await phone.page.goto(`${base}/`, { waitUntil: "commit" });
  if (!timed) {
    await settleHome(phone.page);
    return null;
  }
  await phone.page.locator(NAV).waitFor({ timeout: 30_000 });
  const now = await phone.page.evaluate(() => performance.now());
  await phone.page.waitForTimeout(Math.max(0, WINDOW_MS - now));
  return collect(phone, before);
}

/** An in-app visit from Home, watched for the 6 s window. */
async function visit(phone, to) {
  const before = await phone.taskMs();
  await phone.page.evaluate((target) => {
    window.__sweepBegin();
    history.pushState({}, "", target);
    dispatchEvent(new PopStateEvent("popstate"));
  }, to);
  await phone.page.waitForTimeout(WINDOW_MS);
  return collect(phone, before);
}

/** The window's times and split, in ms from its start; null where it never happened. */
async function collect(phone, taskBefore) {
  const s = await phone.page.evaluate(() => window.__sweep);
  const task = (await phone.taskMs()) - taskBefore;
  const end = s.t0 + WINDOW_MS;
  const reads = [...phone.reads.values()].filter((r) => r.start >= s.t0 && r.start <= end).sort((a, b) => a.start - b.start);
  const shown = s.shown === null ? null : s.shown - s.t0;
  const pending = reads.some((r) => r.end === null);
  let fresh = null;
  if (shown !== null && !pending) {
    // The last answer, then on through DOM changes that follow one another within QUIET_MS.
    let at = Math.max(0, ...reads.map((r) => (r.end ?? 0) - s.t0));
    for (const m of s.mut.map((t) => t - s.t0).sort((a, b) => a - b)) {
      if (m > at && m <= at + QUIET_MS) at = m;
    }
    fresh = Math.max(at, shown);
  }
  let busy = 0;
  let open = null;
  for (const r of reads) {
    const stop = Math.min(r.end ?? end, end);
    if (open === null || r.start > open[1]) {
      if (open !== null) busy += open[1] - open[0];
      open = [r.start, stop];
    } else open[1] = Math.max(open[1], stop);
  }
  if (open !== null) busy += open[1] - open[0];
  const waves = reads.filter((r, i) => i === 0 || r.start - reads[i - 1].start > WAVE_GAP_MS).length;
  const kb = reads.reduce((sum, r) => sum + r.bytes, 0) / 1024;
  return { shown, fresh, task, busy, waves, requests: reads.length, kb };
}

/** First visit: an empty store, background reads off. */
async function firstVisit(chromium, ctx, screen, to) {
  const { browser, context } = await openBrowser(chromium, ctx.auth);
  try {
    const phone = await openPhone(context, { saveData: true });
    if (screen.cold) return await openHome(phone, ctx.base, { timed: true });
    await openHome(phone, ctx.base, { timed: false });
    return await visit(phone, to);
  } finally {
    await browser.close();
  }
}

/** Repeat visit: the screen was visited and the app closed, so its kept data is on the device. */
async function repeatVisit(chromium, ctx, screen, to) {
  const { browser, context } = await openBrowser(chromium, ctx.auth);
  try {
    const first = await openPhone(context, { saveData: false });
    await openHome(first, ctx.base, { timed: false });
    if (!screen.cold) {
      await visit(first, to);
      await first.page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    }
    await first.page.waitForTimeout(1500); // let the kept writes flush
    await first.page.close();
    const phone = await openPhone(context, { saveData: false });
    if (screen.cold) return await openHome(phone, ctx.base, { timed: true });
    await openHome(phone, ctx.base, { timed: false });
    return await visit(phone, to);
  } finally {
    await browser.close();
  }
}

function median(values) {
  const v = values.filter((x) => x !== null).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** { median, runs } of one measure over the runs. */
function summarise(rows, key) {
  const runs = rows.map((r) => (r[key] === null ? null : Math.round(r[key] * 10) / 10));
  const m = median(runs);
  return { median: m === null ? null : Math.round(m * 10) / 10, runs };
}

const MEASURES = ["shown", "fresh", "task", "busy", "waves", "requests", "kb"];

function cell(stat, unit) {
  const f = (x) => (x === null ? "n/a" : unit === "kb" ? x.toFixed(1) : Math.round(x).toLocaleString("en-US"));
  return `${f(stat.median)} (${stat.runs.map(f).join(" / ")})`;
}

function printTables(result) {
  const lines = [
    `Screen sweep on the FLOW-804 phone, ${String(result.runs)} runs each; median (every run), ms.`,
    "",
    "| Screen | Data shown | Fresh data shown | First visit |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const s of result.screens) {
    lines.push(`| ${s.name} | ${cell(s.repeat.shown)} | ${cell(s.repeat.fresh)} | ${cell(s.first.shown)} |`);
  }
  lines.push("", "Where the time goes (the 6 s window of the visit; KB is encoded bytes):", "",
    "| Screen | Visit | Main thread ms | Network busy ms | Waves | Requests | KB |", "| --- | --- | ---: | ---: | ---: | ---: | ---: |");
  for (const s of result.screens) {
    for (const [label, state] of [["repeat", s.repeat], ["first", s.first]]) {
      lines.push(`| ${s.name} | ${label} | ${cell(state.task)} | ${cell(state.busy)} | ${cell(state.waves)} | ${cell(state.requests)} | ${cell(state.kb, "kb")} |`);
    }
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ctx = { base: args.base, auth: { key: authKey(), session: readSession(args.sessionFile) } };
  const require = createRequire(path.join(root, "app/package.json"));
  const { chromium } = require("playwright");
  const screens = [];
  for (const screen of SCREENS) {
    if (args.only && !args.only.includes(screen.key)) continue;
    if (screen.path.includes("{id}") && !args.project) {
      progress(`${screen.name}: skipped, no project id (--project).`);
      continue;
    }
    const to = screen.path.replace("{id}", encodeURIComponent(args.project ?? ""));
    const first = [];
    const repeat = [];
    for (let run = 1; run <= args.runs; run += 1) {
      progress(`${screen.name}: run ${String(run)}/${String(args.runs)}`);
      first.push(await firstVisit(chromium, ctx, screen, to));
      repeat.push(await repeatVisit(chromium, ctx, screen, to));
    }
    const stats = (rows) => Object.fromEntries(MEASURES.map((k) => [k, summarise(rows, k)]));
    screens.push({ name: screen.name, key: screen.key, path: to, first: stats(first), repeat: stats(repeat) });
  }
  const result = { profile: "FLOW-804: CPU 4x, 85 ms latency, 9/1.5 Mbps, 412x915 mobile", runs: args.runs, windowMs: WINDOW_MS, screens };
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else printTables(result);
}

main().catch((error) => {
  // The message only: nothing here holds the session text.
  process.stderr.write(`Sweep failed: ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}\n`);
  process.exit(1);
});
