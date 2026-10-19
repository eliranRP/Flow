/**
 * FLOW-809. A public Storybook build carries sample data only: no hosted project, no key.
 * node scripts/storybook-preview-keys.mjs [dir] exits 1 and names the file when a needle is found.
 * The Jev secret check (check-jev-bundle.mjs) runs on the same build next to this one.
 * Decision 0192: the app's Pages rules (_headers, _redirects) must not ship with it either; the
 * app's X-Frame-Options DENY would blank every story canvas, which the manager loads in an iframe.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {Array<[string, RegExp]>} */
export const keyNeedles = [
  ["the hosted Supabase project", /sxqpnetmtufkzowutduq/],
  ["a JWT (a Supabase anon or service key)", /eyJhbGciOi[A-Za-z0-9_-]{10,}\.eyJ/],
  ["a Supabase API key", /\bsb_(?:publishable|secret)_[A-Za-z0-9_-]{10,}/],
  ["a flow-mcp token", /\bflow_mcp_[A-Za-z0-9_-]{20,}/],
];

const TEXT = /\.(?:js|mjs|cjs|css|html|json|map|txt|svg)$/;

/** Pages rule files at the build's root that belong to the app, not to Storybook. */
export const appPagesRules = ["_headers", "_redirects"];

/**
 * @param {string} dir
 * @returns {string[]} one line per file and needle
 */
export function previewKeyViolations(dir) {
  /** @type {string[]} */
  const problems = [];
  const top = readdirSync(dir);
  for (const name of appPagesRules) {
    if (top.includes(name)) problems.push(`${name}: the app's Pages rules (X-Frame-Options DENY would blank the canvas)`);
  }
  /** @param {string} at */
  const walk = (at) => {
    for (const name of readdirSync(at)) {
      const file = path.join(at, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (TEXT.test(name)) {
        const text = readFileSync(file, "utf8");
        for (const [label, needle] of keyNeedles) {
          if (needle.test(text)) problems.push(`${path.relative(dir, file)}: ${label}`);
        }
      }
    }
  };
  walk(dir);
  return problems;
}

const scriptPath = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === scriptPath;
if (isMain) {
  const dir = process.argv[2] ?? "app/storybook-static";
  const problems = previewKeyViolations(dir);
  if (problems.length > 0) {
    console.error(`storybook-preview-keys: ${dir} must not be published:\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log(`storybook-preview-keys: ${dir} carries no hosted project, key or app Pages rules`);
}
