/**
 * FLOW-809. The sticky pull request comment for a Storybook preview: the link, the head commit,
 * and the stories this pull request changed, so a design re-review opens only those.
 *
 * node scripts/storybook-preview-comment.mjs <index.json> <changed-files.txt> <preview-url> <sha>
 * prints the comment's markdown. changed-files.txt is `git diff --name-only base...head`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Finds the comment again on the next push, so the PR keeps one. */
export const MARKER = "<!-- flow-storybook-preview -->";

/** The most story links one comment lists; the rest are counted. */
const MAX_LINKS = 40;

/** Paths whose change can move any story: shared styles and Storybook's own setup. */
const SHARED = [/^app\/src\/ui\/css\//, /^app\/\.storybook\//, /^app\/src\/ui\/tokens/, /^app\/index\.html$/];

/**
 * @typedef {{ id: string, title: string, name: string, importPath: string, type?: string }} IndexEntry
 */

/**
 * The repo path of a story file, from its index importPath ("./src/x.stories.tsx").
 * @param {string} importPath
 */
function storyFile(importPath) {
  return path.posix.join("app", importPath.replace(/^\.\//, ""));
}

/**
 * Stories a change touches: a changed stories file, or a stories file next to a changed module of
 * the same name (loan-list.tsx → loan-list.stories.tsx).
 * @param {IndexEntry[]} entries
 * @param {string[]} changed repo-relative paths
 * @returns {IndexEntry[]}
 */
export function changedStories(entries, changed) {
  const touched = new Set();
  for (const file of changed) {
    touched.add(file);
    const match = /^(.*)\.(tsx?|css)$/.exec(file);
    if (match && !file.includes(".stories.")) {
      touched.add(`${match[1]}.stories.tsx`);
      touched.add(`${match[1]}.stories.ts`);
    }
  }
  return entries.filter((entry) => entry.type !== "docs" && touched.has(storyFile(entry.importPath)));
}

/**
 * @param {string[]} changed
 * @returns {boolean}
 */
export function sharedChanged(changed) {
  return changed.some((file) => SHARED.some((pattern) => pattern.test(file)));
}

/**
 * @param {{ entries: IndexEntry[], changed: string[], url: string, sha: string }} input
 * @returns {string}
 */
export function previewComment({ entries, changed, url, sha }) {
  const base = url.replace(/\/+$/, "");
  const stories = changedStories(entries, changed);
  const lines = [
    MARKER,
    `**Storybook preview** for ${sha.slice(0, 7)}: ${base}/`,
    "",
    "Sample data only. The link follows the newest push.",
  ];
  if (sharedChanged(changed)) {
    lines.push("", "Shared styles or the Storybook setup changed, so any story can look different.");
  }
  if (stories.length === 0) {
    lines.push("", "No stories file changed, and none sits next to a changed module. Stories that use a changed shared module are not listed.");
  } else {
    lines.push("", `Stories this pull request changed (${String(stories.length)}):`, "");
    for (const story of stories.slice(0, MAX_LINKS)) {
      lines.push(`- [${story.title} / ${story.name}](${base}/?path=/story/${story.id})`);
    }
    if (stories.length > MAX_LINKS) lines.push(`- and ${String(stories.length - MAX_LINKS)} more`);
  }
  return `${lines.join("\n")}\n`;
}

const scriptPath = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === scriptPath;
if (isMain) {
  const [indexPath, changedPath, url, sha] = process.argv.slice(2);
  if (!indexPath || !changedPath || !url || !sha) {
    console.error("usage: storybook-preview-comment.mjs <index.json> <changed-files.txt> <preview-url> <sha>");
    process.exit(2);
  }
  /** @type {{ entries: Record<string, IndexEntry> }} */
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  const changed = readFileSync(changedPath, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  process.stdout.write(previewComment({ entries: Object.values(index.entries), changed, url, sha }));
}
