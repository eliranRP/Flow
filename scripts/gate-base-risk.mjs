#!/usr/bin/env node
// FLOW-813 follow-up: may the push gate's "same patch" skip trust an earlier pass?
// The skip marks the branch's own patch against main. When main moves under an unchanged patch, the
// patch is the same but what it runs against is not: #364 rewrote every viewer check while #383 added
// RPCs with the old form, and #383's patch did not change. So the skip holds only while main's
// changes since the fork the mark passed on touch none of the database surface below.
//   node scripts/gate-base-risk.mjs <marked fork> <current fork>
// exits 0 when the skip is safe, 1 (and names the files) when it is not. An empty or unknown
// marked fork, from a mark made before this rule, is not safe.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** What a server branch builds on: migrations, the MCP function, the shared package and the seed. */
export const DATABASE_SURFACE = /^(supabase\/migrations\/|supabase\/functions\/flow-mcp\/|packages\/shared\/|supabase\/seed\.sql$)/;

/** The files main changed under the branch that a pass on the marked fork did not see. */
export function riskyChanges(mainFiles) {
  return mainFiles.filter((path) => DATABASE_SURFACE.test(path));
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function main() {
  const [marked, current] = process.argv.slice(2);
  if (!marked || !current || !/^[0-9a-f]{40}$/.test(marked)) {
    console.log("local-ci: the patch mark has no fork recorded, so it can't show main stayed the same underneath.");
    process.exit(1);
  }
  if (marked === current) process.exit(0);
  let files;
  try {
    git(["merge-base", "--is-ancestor", marked, current]);
    files = git(["diff", "--name-only", marked, current]).split("\n").filter(Boolean);
  } catch {
    console.log(`local-ci: the patch passed on ${marked.slice(0, 7)}, which is not under main now.`);
    process.exit(1);
  }
  const risky = riskyChanges(files);
  if (risky.length === 0) process.exit(0);
  console.log(`local-ci: the patch passed on ${marked.slice(0, 7)}, and main has since changed what it builds on:`);
  for (const path of risky.slice(0, 10)) console.log(`  ${path}`);
  if (risky.length > 10) console.log(`  … and ${risky.length - 10} more`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
