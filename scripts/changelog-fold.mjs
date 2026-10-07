#!/usr/bin/env node
// Changelog fragments: each PR adds docs/changelog.d/YYYY-MM-DD-<id>.md instead of editing
// docs/changelog.md, so parallel PRs never conflict on the changelog.
//   node scripts/changelog-fold.mjs           move every fragment into docs/changelog.md, under its date
//   node scripts/changelog-fold.mjs --check   only validate the fragments
// --dir and --file point at other paths (used by the tests).
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const NAME = /^(\d{4}-\d{2}-\d{2})-[a-z0-9][a-z0-9-]*\.md$/;

/** @param {string} dir */
export function readFragments(dir) {
  /** @type {string[]} */
  const problems = [];
  /** @type {{ name: string, date: string, text: string }[]} */
  const fragments = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === "README.md") continue;
    const match = NAME.exec(name);
    if (!match) {
      problems.push(`${name}: name it YYYY-MM-DD-<id>.md, lowercase`);
      continue;
    }
    const text = readFileSync(join(dir, name), "utf8").trim();
    if (!text) problems.push(`${name}: empty`);
    else if (/^#/m.test(text)) problems.push(`${name}: no headings; the date heading comes from the name`);
    fragments.push({ name, date: match[1], text });
  }
  return { fragments, problems };
}

/**
 * @param {string} changelog
 * @param {{ date: string, text: string }[]} fragments
 */
export function fold(changelog, fragments) {
  const [head, ...rest] = changelog.split(/^(?=## \d{4}-\d{2}-\d{2}\s*$)/m);
  // Older history repeats some dates, so sections keep their order and a fragment joins the first
  // section with its date, or a new section placed before the first older date.
  const sections = rest.map((section) => ({ date: section.slice(3, 13), text: section.trimEnd() }));
  for (const { date, text } of fragments) {
    const same = sections.find((section) => section.date === date);
    if (same) {
      same.text += `\n\n${text}`;
      continue;
    }
    const older = sections.findIndex((section) => section.date < date);
    sections.splice(older < 0 ? sections.length : older, 0, { date, text: `## ${date}\n\n${text}` });
  }
  return `${head.trimEnd()}\n\n${sections.map((section) => section.text).join("\n\n")}\n`;
}

/** @param {string[]} argv */
function main(argv) {
  const value = (/** @type {string} */ flag, /** @type {string} */ fallback) => {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : fallback;
  };
  const root = new URL("..", import.meta.url).pathname;
  const dir = value("--dir", join(root, "docs/changelog.d"));
  const file = value("--file", join(root, "docs/changelog.md"));
  const { fragments, problems } = readFragments(dir);
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  if (argv.includes("--check")) {
    console.log(`changelog: ${fragments.length} fragments ok.`);
    return;
  }
  writeFileSync(file, fold(readFileSync(file, "utf8"), fragments));
  for (const { name } of fragments) rmSync(join(dir, name));
  console.log(`changelog: folded ${fragments.length} fragments.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
