#!/usr/bin/env node
// Merge-cycle report: how long each merged PR took from its last push to merge, against the owner's targets
// (2026-10-09): a small PR merges within 5 minutes, a medium one within 10, a large one within 20.
// The clock starts at the head commit's committer date (the last push, which is when the gate started), because
// lanes open a draft PR when they claim a task and flip it to ready seconds before merging, so neither created_at
// nor ready_for_review measures the push-to-merge cycle. It falls back to created_at when the commit cannot be read.
// Usage: node scripts/merge-cycle.mjs [--since <ISO time>] [--repo owner/name] [--json]
//   --since defaults to 3 hours ago. GITHUB_TOKEN raises the API rate limit when set; reads go through curl, so the proxy settings apply.
// The lane manager runs it every hour and posts the table; a miss names its cause in the post.
import { execFile as execFileCallback } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

/** Lines changed (additions + deletions) and files, to a size class and its target in minutes. */
export function sizeOf(lines, files) {
  if (lines <= 80 && files <= 4) return { size: "S", target: 5 };
  if (lines <= 400) return { size: "M", target: 10 };
  return { size: "L", target: 20 };
}

/** One report row from a merged pull request (the GitHub REST shape); `pushedAt` is its head commit's date. */
export function rowOf(pr, pushedAt) {
  const lines = (pr.additions ?? 0) + (pr.deletions ?? 0);
  const files = pr.changed_files ?? 0;
  const { size, target } = sizeOf(lines, files);
  const from = pushedAt ? "push" : "open";
  const start = Date.parse(pushedAt ?? pr.created_at);
  const merged = Date.parse(pr.merged_at);
  const minutes = Math.round((merged - start) / 60000);
  return {
    number: pr.number,
    title: pr.title,
    size,
    lines,
    files,
    from,
    minutes,
    target,
    met: minutes <= target,
    mergedAt: pr.merged_at,
  };
}

/** Rows merged at or after `since`, oldest merge first, with a per-size summary. */
export function summarize(rows) {
  const bySize = {};
  for (const row of rows) {
    const bucket = (bySize[row.size] ??= { merged: 0, met: 0, minutes: [] });
    bucket.merged += 1;
    if (row.met) bucket.met += 1;
    bucket.minutes.push(row.minutes);
  }
  for (const bucket of Object.values(bySize)) {
    const sorted = [...bucket.minutes].sort((a, b) => a - b);
    bucket.median = sorted.length
      ? sorted[Math.floor((sorted.length - 1) / 2)]
      : 0;
    delete bucket.minutes;
  }
  return {
    merged: rows.length,
    met: rows.filter((row) => row.met).length,
    bySize,
  };
}

/** The report as text: one line per PR, then the summary table. */
export function format(rows) {
  const lines = rows.map(
    (row) =>
      `#${row.number} ${row.size} ${String(row.lines).padStart(5)} lines ${String(row.files).padStart(3)} files ` +
      `${String(row.minutes).padStart(4)} min (target ${row.target}) ${row.met ? "OK  " : "MISS"} ${row.title}`,
  );
  const summary = summarize(rows);
  lines.push("");
  lines.push("size | merged | met | median min (lower middle)");
  for (const size of ["S", "M", "L"]) {
    const bucket = summary.bySize[size];
    if (bucket)
      lines.push(
        `${size}    | ${bucket.merged} | ${bucket.met} | ${bucket.median}`,
      );
  }
  lines.push(`met target: ${summary.met}/${summary.merged}`);
  return lines.join("\n");
}

/** One GitHub API read through curl, which honours HTTPS_PROXY and the proxy CA bundle (node's fetch does not). */
async function github(url, token) {
  const args = [
    "-sS",
    "-f",
    "-H",
    "User-Agent: flow-merge-cycle",
    "-H",
    "Accept: application/vnd.github+json",
  ];
  if (token) args.push("-H", `Authorization: Bearer ${token}`);
  const { stdout } = await execFile("curl", [...args, url], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

/** The head commit's committer date (the last push), or undefined when the commit cannot be read any more. */
async function pushedAtOf(repo, pr, token, get) {
  if (!pr.head?.sha) return undefined;
  try {
    const commit = await get(
      `https://api.github.com/repos/${repo}/commits/${pr.head.sha}`,
      token,
    );
    return commit.commit?.committer?.date;
  } catch {
    return undefined;
  }
}

/** Merged PRs since `since`, with their line and file counts and last push (two requests per PR). */
export async function fetchRows({ repo, since, token, get = github }) {
  const sinceMs = Date.parse(since);
  const rows = [];
  for (let page = 1; page <= 5; page += 1) {
    const list = await get(
      `https://api.github.com/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50&page=${page}`,
      token,
    );
    if (!list.length) break;
    for (const pr of list) {
      if (!pr.merged_at || Date.parse(pr.merged_at) < sinceMs) continue;
      const detail = await get(pr.url, token);
      rows.push(rowOf(detail, await pushedAtOf(repo, detail, token, get)));
    }
    // Every in-window merge has updated_at >= merged_at >= since, so once a page's last
    // PR was updated before the cutoff, no later page can hold one.
    if (Date.parse(list[list.length - 1].updated_at) < sinceMs) break;
  }
  return rows.sort((a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt));
}

function parseArgs(argv) {
  const args = {
    repo: "eliranRP/Flow",
    since: new Date(Date.now() - 3 * 3600_000).toISOString(),
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--since") args.since = argv[++i];
    else if (argv[i] === "--repo") args.repo = argv[++i];
    else if (argv[i] === "--json") args.json = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (Number.isNaN(Date.parse(args.since)))
    throw new Error(`--since needs an ISO time, got ${args.since}`);
  return args;
}

if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file://").href
) {
  const args = parseArgs(process.argv.slice(2));
  const rows = await fetchRows({
    repo: args.repo,
    since: args.since,
    token: process.env.GITHUB_TOKEN,
  });
  console.log(
    args.json
      ? JSON.stringify(
          { since: args.since, rows, summary: summarize(rows) },
          null,
          2,
        )
      : format(rows),
  );
}
