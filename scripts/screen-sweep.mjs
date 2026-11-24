#!/usr/bin/env node
/**
 * FLOW-1276: the three times of decision 0271 for Home and every main screen, on the FLOW-804 phone
 * (412x915 mobile, CPU x4, 85 ms latency, 9 Mbps down, 1.5 Mbps up), plus where the time goes.
 *
 * Usage:
 *   node scripts/screen-sweep.mjs <base-url> <session-file> [--project <id>] [--runs 3] [--only a,b] [--json]
 *   --only takes the keys: home, projects, project, loans, recurring, profit-month, profit-year,
 *   profit-date, review, forecast.
 *   FLOW_SWEEP_URL, FLOW_SWEEP_SESSION and FLOW_SWEEP_PROJECT stand in for the arguments;
 *   FLOW_CHROMIUM_PATH picks the browser (as load-report.mjs does); pnpm sweep runs this file.
 *
 * <session-file> is a Supabase session JSON (access_token and refresh_token) that the caller already
 * has, for a test user. The script never mints a session and calls no admin endpoint. It only puts
 * the file's text into the page's localStorage under the app's auth key (sb-<project ref>-auth-token,
 * the ref from VITE_SUPABASE_URL in app/.env.production, or FLOW_SWEEP_SUPABASE_URL), and never
 * prints, logs or writes it. Every context seeds the same token, so a run that outlived it
 * would refresh with one refresh token from many contexts and could sign later runs out. The script
 * estimates its duration (screens x runs x RUN_SECONDS_PER_SCREEN, plus a margin) and exits 2 unless
 * the access token has at least that long left.
 *
 * Each state of each screen runs in its own fresh browser; every run's values are kept:
 * - first visit: a fresh context, the screen's URL loaded directly as the first page load, timed from
 *   navigation start. The fresh context is what guarantees an empty store and no cached reads.
 * - data shown: a context that has visited the screen (same path and query) and is then reopened, so
 *   its kept data is on the device; Home settles, then the in-app visit (history.pushState and
 *   popstate, as a tap does). "Reads before" there is Home's REST reads started before the
 *   tap (printed, and kept in the JSON); a first visit has none, so it has no such value.
 * - fresh data shown: the same visit, until every read the visit started in its first 6 s has
 *   answered, and the page has drawn the answers and gone quiet: the first DOM change after the last
 *   response, then on through changes less than 100 ms apart; if no DOM change follows the last response,
 *   it is that response's time. Taken from the requests, not the hint.
 *   It does not depend on data shown. It is null only when the visit starts no
 *   read, or a read has not answered within the window (printed as a dash). A chart animation that
 *   changes the DOM can extend it.
 * Data shown is the first frame where all three hold: the location is the target (path and query),
 * the screen's own marker of drawn first-view figures is in the DOM (SCREENS[].marker below, listed in
 * docs/qa/perf/README.md), and none of .ui-skeleton-bar, .ui-skel-row, .ui-skel-leaving,
 * [aria-busy=true] and .ui-chart-skel is. It is the first such frame, kept: a skeleton that appears
 * later (a refetch) does not move it; fresh data shown captures later changes. No skeleton alone is not enough: a screen's code can load
 * with the old screen still up (ScreenSuspense shows nothing), and a skeleton shows only after 300 ms.
 * Any busy element in the first view delays data shown, so an updating hint marked aria-busy would
 * make it equal fresh data shown. Cold Home is timed from navigation start with Home's marker.
 * navigator.connection.saveData is set on in first-visit runs: a future switch for the background
 * reads (0271; FLOW-1269 is not built, so the app ignores it today). The fresh context is what keeps a first visit empty.
 *
 * The split is of the same visit's 6 s window: main thread (CDP Performance TaskDuration delta, an
 * upper bound as it includes work after the page settles), network busy (the union of the Supabase
 * REST request intervals, started in the window), waves (request starts more than 250 ms apart),
 * requests and KB (encoded bytes received). Results: medians with every run, as a table, or as JSON.
 *
 * A run whose data shown is not reached within the window says why on its stderr line: whether the
 * marker was drawn, which skeleton selectors were still up, and how many of the window's reads had not
 * answered, with the slowest by its REST path (no query, no headers). A slow backend answer that pushes
 * the last wave past the window reads differently from a marker or selector that never matches.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WINDOW_MS = 6000;
const QUIET_MS = 100;
const WAVE_GAP_MS = 250;
/** A generous estimate of one screen's run (both states, with their waits and browser launches), and a margin, for the token check. */
const RUN_SECONDS_PER_SCREEN = 90;
const MARGIN_SECONDS = 300;
const SKELETON = ".ui-skeleton-bar, .ui-skel-row, .ui-skel-leaving, [aria-busy=true], .ui-chart-skel";
const REST = /\/rest\/v1\//;

/**
 * The screens, in report order. `{id}` is the project id. `marker` is a selector that matches only
 * once the screen's first-view figures are drawn (the hero amount, or the empty state a screen draws
 * when it has nothing): existing classes, scoped by the screen's own root.
 */
const SCREENS = [
  { name: "Home (cold)", key: "home", path: "/", cold: true, marker: ".ui-band-body .ui-num" },
  { name: "Projects", key: "projects", path: "/projects", marker: ".ui-projects-page .ui-project-profits .ui-num" },
  { name: "Project page", key: "project", path: "/projects/{id}", marker: ".ui-project-cash .ui-project-profits .ui-num" },
  { name: "Loans", key: "loans", path: "/loans", marker: ".ui-loans-band-figure .ui-num, .ui-loans-screen .ui-empty-state" },
  { name: "Recurring", key: "recurring", path: "/recurring", marker: ".ui-recurring-sum-figure, .ui-recurring-body .ui-empty-state" },
  { name: "Profit, month", key: "profit-month", path: "/profit", marker: ".ui-cp-figure .ui-num" },
  { name: "Profit, year", key: "profit-year", path: "/profit?period=year", marker: ".ui-cp-figure .ui-num" },
  { name: "Profit, by date", key: "profit-date", path: "/profit?by=date", marker: ".ui-cp-figure .ui-num" },
  { name: "Review", key: "review", path: "/review", marker: ".ui-review-motion, .ui-review-queue .ui-empty-state" },
  { name: "Forecast", key: "forecast", path: "/forecast", marker: ".ui-forecast-section-total, .ui-forecast-empty" },
];
const KEYS = SCREENS.map((screen) => screen.key).join(", ");
const USAGE = `Usage: node scripts/screen-sweep.mjs <base-url> <session-file> [--project <id>] [--runs 3] [--only a,b] [--json]\n--only keys: ${KEYS}`;

function parseArgs(argv) {
  const out = { positional: [], runs: 3, project: process.env.FLOW_SWEEP_PROJECT, only: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") out.json = true;
    else if (arg === "--runs") out.runs = Number(argv[++i]);
    else if (arg === "--project") out.project = argv[++i];
    else if (arg === "--only") out.only = (argv[++i] ?? "").split(",").map((key) => key.trim());
    else if (arg.startsWith("--")) fail(`Unknown option ${arg}.\n${USAGE}`);
    else out.positional.push(arg);
  }
  out.base = (out.positional[0] ?? process.env.FLOW_SWEEP_URL ?? "").replace(/\/+$/, "");
  out.sessionFile = out.positional[1] ?? process.env.FLOW_SWEEP_SESSION;
  if (!out.base || !out.sessionFile) fail(USAGE);
  if (!Number.isInteger(out.runs) || out.runs < 1) fail(`--runs takes a whole number, 1 or more.\n${USAGE}`);
  if (out.only?.some((key) => key === "")) fail(`--only takes a comma-separated list of keys, none empty.\n${USAGE}`);
  const unknown = (out.only ?? []).filter((key) => !SCREENS.some((screen) => screen.key === key));
  if (unknown.length > 0) fail(`Unknown --only key: ${unknown.join(", ")}.\n${USAGE}`);
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
    let env = "";
    try {
      env = readFileSync(path.join(root, "app/.env.production"), "utf8");
    } catch {
      // Falls through to the message below.
    }
    url = /^VITE_SUPABASE_URL=(.+)$/m.exec(env)?.[1]?.trim();
  }
  if (!url) fail("No VITE_SUPABASE_URL in app/.env.production (or FLOW_SWEEP_SUPABASE_URL).");
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

/** Reads the session file; returns its text for localStorage. Complains without echoing any of it. */
function readSession(file, requiredMs) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return fail("Cannot read the session file.");
  }
  let session;
  let exp;
  try {
    session = JSON.parse(text);
    if (typeof session.access_token !== "string" || typeof session.refresh_token !== "string") throw new Error("shape");
    exp = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString("utf8")).exp;
  } catch {
    return fail("The session file is not a Supabase session JSON with access_token and refresh_token.");
  }
  if (typeof exp === "number") {
    const left = exp * 1000 - Date.now();
    if (left <= 0) fail("The session's access token has expired; sign in again and save a new session file.");
    if (left < requiredMs) fail(`The session's access token has ${String(Math.floor(left / 60_000))} minutes left; this sweep needs about ${String(Math.ceil(requiredMs / 60_000))}. Use a fresher session, or fewer screens or runs.`);
    if (typeof session.expires_at !== "number") session.expires_at = exp;
  }
  return JSON.stringify(session);
}

/**
 * Runs in the page from document start: the DOM-change frames, and when the screen's figures are
 * drawn. `s.target` and `s.marker` are what "drawn" means; __sweepBegin sets them for an in-app visit.
 */
function recorder({ target, marker, sel, saveData }) {
  const epoch = () => performance.timeOrigin + performance.now();
  const s = { t0: performance.timeOrigin, mut: [], shown: null, target, marker, at: null };
  window.__sweep = s;
  window.__sweepBegin = (to, mark) => Object.assign(s, { t0: epoch(), mut: [], shown: null, target: to, marker: mark, at: null });
  if (saveData) {
    try {
      Object.defineProperty(navigator.connection, "saveData", { get: () => true });
    } catch { /* no connection API: nothing to turn off */ }
  }
  new MutationObserver(() => {
    requestAnimationFrame(() => { s.mut.push(epoch()); });
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const tick = () => {
    const route = location.pathname + location.search;
    const drawn = s.marker !== null && document.querySelector(s.marker) !== null;
    const ready = route === s.target && drawn && document.querySelector(sel) === null;
    if (ready && s.shown === null) {
      s.shown = epoch();
      s.at = { route, marker: true };
    }
    requestAnimationFrame(tick);
  };
  tick();
}

/** Runs `use(context)` in a fresh browser on the phone profile, with the session set; always closes it. */
async function withBrowser(chromium, auth, use) {
  const browser = await chromium.launch({ executablePath: process.env.FLOW_CHROMIUM_PATH || undefined });
  try {
    const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
    // Only when absent: a reopened page keeps the token the app has since refreshed.
    await context.addInitScript(([k, v]) => {
      try { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); } catch { /* storage blocked */ }
    }, [auth.key, auth.session]);
    return await use(context);
  } finally {
    await browser.close();
  }
}

/** A page on the phone profile that records its Supabase REST reads, in epoch milliseconds. */
async function openPhone(context, { target = "/", marker = null, saveData = false } = {}) {
  const page = await context.newPage();
  await page.addInitScript(recorder, { target, marker, sel: SKELETON, saveData });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Performance.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 85, downloadThroughput: 9_000_000 / 8, uploadThroughput: 1_500_000 / 8 });
  const reads = new Map();
  cdp.on("Network.requestWillBeSent", (e) => {
    if (reads.has(e.requestId) || !REST.test(e.request.url) || e.request.method === "OPTIONS") return;
    reads.set(e.requestId, { start: e.wallTime * 1000, stamp: e.timestamp, end: null, bytes: 0, name: new URL(e.request.url).pathname.replace(/^.*\/rest\/v1\//, "") });
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

/** Loads Home untimed and waits for the network to go quiet, as a user's moment on Home. */
async function settleHome(phone, base) {
  await phone.page.goto(`${base}/`, { waitUntil: "commit" });
  await phone.page.locator('nav[aria-label="ניווט ראשי"]').waitFor({ timeout: 30_000 });
  await phone.page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  await phone.page.waitForTimeout(1500);
}

/** Loads `to` as a page load, timed from navigation start, watched for the 6 s window. */
async function loadTimed(phone, base, to) {
  const before = await phone.taskMs();
  await phone.page.goto(`${base}${to}`, { waitUntil: "commit" });
  await phone.page.waitForFunction(() => document.body !== null, undefined, { timeout: 30_000 });
  const now = await phone.page.evaluate(() => performance.now());
  await phone.page.waitForTimeout(Math.max(0, WINDOW_MS - now));
  return collect(phone, before, null);
}

/** An in-app visit from Home, watched for the 6 s window. */
async function visit(phone, to, marker) {
  const before = await phone.taskMs();
  const readsBefore = phone.reads.size;
  await phone.page.evaluate(([target, mark]) => {
    window.__sweepBegin(target, mark);
    history.pushState({}, "", target);
    dispatchEvent(new PopStateEvent("popstate"));
  }, [to, marker]);
  await phone.page.waitForTimeout(WINDOW_MS);
  return collect(phone, before, readsBefore);
}

/** The window's times and split, in ms from its start; null where it never happened. */
async function collect(phone, taskBefore, readsBefore) {
  const s = await phone.page.evaluate(() => window.__sweep);
  const task = (await phone.taskMs()) - taskBefore;
  const end = s.t0 + WINDOW_MS;
  const reads = [...phone.reads.values()].filter((r) => r.start >= s.t0 && r.start <= end).sort((a, b) => a.start - b.start);
  const shown = s.shown === null ? null : s.shown - s.t0;
  let fresh = null;
  if (reads.length > 0 && reads.every((r) => r.end !== null)) {
    // The last response, the first DOM change after it (the answer drawn, however late), then on
    // through changes less than QUIET_MS apart.
    const last = Math.max(...reads.map((r) => r.end)) - s.t0;
    const after = s.mut.map((t) => t - s.t0).filter((m) => m > last).sort((a, b) => a - b);
    let at = after.length > 0 ? after[0] : last;
    for (const m of after) {
      if (m < at + QUIET_MS) at = m;
      else break;
    }
    fresh = at;
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
  const page = await phone.page.evaluate(([marker, sel]) => ({
    route: location.pathname + location.search,
    drawn: marker !== null && document.querySelector(marker) !== null,
    skeletons: sel.split(",").map((x) => x.trim()).filter((x) => document.querySelector(x) !== null),
  }), [s.marker, SKELETON]);
  const stuck = shown === null ? notReached(page, reads, s.t0 + WINDOW_MS) : null;
  return { shown, fresh, task, busy, waves, requests: reads.length, kb, readsBefore, route: s.at?.route ?? page.route, marker: shown !== null, stuck };
}

/**
 * Why data shown was not reached, from the page at the window's end and the window's reads: whether the
 * marker was drawn, the skeleton selectors still matching, and the reads not answered by `end` (epoch
 * ms) with the slowest one's REST path and time (answered or not, measured up to `end`).
 */
export function notReached({ drawn, skeletons }, reads, end) {
  const open = reads.filter((r) => r.end === null || r.end > end).length;
  let slowest = null;
  for (const r of reads) {
    const ms = Math.min(r.end ?? end, end) - r.start;
    if (slowest === null || ms > slowest.ms) slowest = { name: r.name, ms };
  }
  return { drawn, skeletons, open, slowest };
}

/** The reason as words for the run's line. */
export function describeStuck({ drawn, skeletons, open, slowest }) {
  const parts = [drawn ? "marker drawn" : "marker not drawn", skeletons.length > 0 ? `skeleton up (${skeletons.join(", ")})` : "no skeleton", `${String(open)} reads unanswered at the window's end`];
  if (slowest !== null) parts.push(`slowest ${slowest.name} ${Math.round(slowest.ms).toLocaleString("en-US")} ms`);
  return parts.join(", ");
}

/** First visit: a fresh context, the screen's URL loaded directly, nothing read or kept before it. */
function firstVisit(chromium, ctx, screen, to) {
  return withBrowser(chromium, ctx.auth, async (context) => {
    const phone = await openPhone(context, { target: to, marker: screen.marker, saveData: true });
    return loadTimed(phone, ctx.base, to);
  });
}

/** Repeat visit: the screen was visited and the app closed, so its kept data is on the device. */
function repeatVisit(chromium, ctx, screen, to) {
  return withBrowser(chromium, ctx.auth, async (context) => {
    const first = await openPhone(context);
    await settleHome(first, ctx.base);
    if (!screen.cold) {
      await visit(first, to, screen.marker);
      await first.page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    }
    await first.page.waitForTimeout(1500); // let the kept writes flush
    await first.page.close();
    if (screen.cold) return loadTimed(await openPhone(context, { target: to, marker: screen.marker }), ctx.base, to);
    const phone = await openPhone(context);
    await settleHome(phone, ctx.base);
    return visit(phone, to, screen.marker);
  });
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

const MEASURES = ["shown", "fresh", "task", "busy", "waves", "requests", "kb", "readsBefore"];

function cell(stat, unit) {
  const f = (x) => (x === null ? "—" : unit === "kb" ? x.toFixed(1) : Math.round(x).toLocaleString("en-US"));
  return `${f(stat.median)} (${stat.runs.map(f).join(" / ")})`;
}

function printTables(result) {
  const lines = [
    `Screen sweep on the FLOW-804 phone, ${String(result.runs)} runs each; median (every run), ms. A dash is no value.`,
    "",
    "| Screen | Data shown | Fresh data shown | First visit |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const s of result.screens) {
    lines.push(`| ${s.name} | ${cell(s.repeat.shown)} | ${cell(s.repeat.fresh)} | ${cell(s.first.shown)} |`);
  }
  lines.push("", "Where the time goes (the 6 s window of the visit; KB is encoded bytes; reads before: REST reads started before the tap; none for a first visit):", "",
    "| Screen | Visit | Main thread ms | Network busy ms | Waves | Requests | KB | Reads before |", "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const s of result.screens) {
    for (const [label, state] of [["repeat", s.repeat], ["first", s.first]]) {
      lines.push(`| ${s.name} | ${label} | ${cell(state.task)} | ${cell(state.busy)} | ${cell(state.waves)} | ${cell(state.requests)} | ${cell(state.kb, "kb")} | ${cell(state.readsBefore)} |`);
    }
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

/** One line per run on stderr: the evidence that data shown was taken on the right route and marker. */
function logRun(label, row) {
  const f = (x) => (x === null ? "—" : String(Math.round(x)));
  progress(`  ${label}: shown ${f(row.shown)} ms, fresh ${f(row.fresh)} ms, route ${row.route}, data shown ${row.marker ? "reached (route and marker matched)" : `not reached within ${String(WINDOW_MS)} ms: ${describeStuck(row.stuck)}`}, reads before ${row.readsBefore === null ? "—" : String(row.readsBefore)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const planned = SCREENS.filter((screen) => (!args.only || args.only.includes(screen.key)) && (args.project || !screen.path.includes("{id}")));
  const requiredMs = (planned.length * args.runs * RUN_SECONDS_PER_SCREEN + MARGIN_SECONDS) * 1000;
  const ctx = { base: args.base, auth: { key: authKey(), session: readSession(args.sessionFile, requiredMs) } };
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
      logRun("first visit", first[first.length - 1]);
      repeat.push(await repeatVisit(chromium, ctx, screen, to));
      logRun("repeat visit", repeat[repeat.length - 1]);
    }
    const stats = (rows) => Object.fromEntries(MEASURES.map((k) => [k, summarise(rows, k)]));
    screens.push({ name: screen.name, key: screen.key, path: to, marker: screen.marker, first: stats(first), repeat: stats(repeat) });
  }
  const result = { profile: "FLOW-804: CPU 4x, 85 ms latency, 9/1.5 Mbps, 412x915 mobile", runs: args.runs, windowMs: WINDOW_MS, screens };
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else printTables(result);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // The message only: nothing here holds the session text.
    process.stderr.write(`Sweep failed: ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}\n`);
    process.exit(1);
  });
}
