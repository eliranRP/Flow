/**
 * The CI v2 stamp: the local gate's result for one commit, written as the body of a PR comment.
 * The check that reads it (next step of CI v2) matches the marker's full sha to the PR head.
 *
 * Usage: node scripts/ci-stamp.mjs <40-char sha> <phases file>
 * The phases file has one line per phase: `<name> pass|fail <seconds>`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SHA = /^[0-9a-f]{40}$/;
const LINE = /^([a-z][a-z0-9-]*) (pass|fail) (\d+)$/;

/**
 * @param {string} text
 * @returns {{ name: string, pass: boolean, seconds: number }[]}
 */
export function parsePhases(text) {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const match = LINE.exec(line.trim());
      if (!match) throw new Error(`ci-stamp: bad phase line: ${line}`);
      return { name: match[1], pass: match[2] === "pass", seconds: Number(match[3]) };
    });
}

/**
 * @param {{ sha: string, phases: { name: string, pass: boolean, seconds: number }[] }} input
 * @returns {string}
 */
export function stampBody({ sha, phases }) {
  if (!SHA.test(sha)) throw new Error("ci-stamp: expected a 40-character git sha");
  if (phases.length === 0) throw new Error("ci-stamp: no phases to stamp");
  const pass = phases.every((phase) => phase.pass);
  const rows = phases.map((phase) => `| ${phase.name} | ${phase.pass ? "pass" : "fail"} | ${phase.seconds} |`);
  return [
    `<!-- flow-ci-stamp sha=${sha} result=${pass ? "pass" : "fail"} -->`,
    `**Local CI: ${pass ? "pass" : "fail"}** for \`${sha.slice(0, 7)}\``,
    "",
    "| Phase | Result | Seconds |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "Run with `scripts/local-ci.sh --part ready`. The stamp covers the static, types and tests slices only.",
    "",
  ].join("\n");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    const [sha = "", file = ""] = process.argv.slice(2);
    process.stdout.write(stampBody({ sha, phases: parsePhases(readFileSync(file, "utf8")) }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
