/**
 * Rebuild supabase/functions/_shared/connectors/mercury/api.d.ts from the
 * OpenAPI JSON embedded in the Mercury reference pages. GET operations only.
 *
 *   node scripts/mercury-openapi.mjs
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const pages = [
  "https://docs.mercury.com/reference/getaccounts.md",
  "https://docs.mercury.com/reference/listtransactions.md",
  "https://docs.mercury.com/reference/gettransactionbyid.md",
];

const outFile = new URL("../supabase/functions/_shared/connectors/mercury/api.d.ts", import.meta.url);

export function embeddedSpec(markdown) {
  const start = markdown.indexOf("```json");
  const end = markdown.indexOf("```", start + 7);
  if (start < 0 || end < 0) throw new Error("OpenAPI JSON block is missing");
  return JSON.parse(markdown.slice(start + 7, end));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Merge page specs into one GET-only document.
 * Throws when a path is not GET, is duplicated, or a shared schema disagrees.
 * @param {object[]} specs
 */
export function mergeGetSpecs(specs) {
  const merged = {
    openapi: "3.0.0",
    info: { title: "Mercury GET", version: "0" },
    paths: {},
    components: { schemas: {} },
  };
  for (const spec of specs) {
    for (const [path, operations] of Object.entries(spec.paths ?? {})) {
      const get = operations.get;
      if (!get) throw new Error(`${path} has no GET`);
      const extra = Object.keys(operations).filter((method) => method !== "get" && method !== "parameters");
      if (extra.length > 0) throw new Error(`${path} is not GET-only: ${extra.join(", ")}`);
      if (merged.paths[path]) throw new Error(`duplicate path ${path}`);
      merged.paths[path] = { get };
    }
    for (const [name, schema] of Object.entries(spec.components?.schemas ?? {})) {
      const existing = merged.components.schemas[name];
      if (existing && !sameJson(existing, schema)) throw new Error(`schema ${name} differs between pages`);
      merged.components.schemas[name] = schema;
    }
  }
  return merged;
}

function header() {
  return `/**
 * Mercury GET types. Do not edit by hand.
 * Generated from the OpenAPI JSON embedded in:
 * ${pages.join("\n * ")}
 *
 *   node scripts/mercury-openapi.mjs
 *
 * Account numbers, routing numbers, emails, and attachment URLs are in the
 * response schemas. Flow does not store them. See docs/tech/connector-contract.md.
 */
`;
}

async function main() {
  const specs = [];
  for (const page of pages) {
    const response = await fetch(page);
    if (!response.ok) throw new Error(`${page} returned ${response.status}`);
    specs.push(embeddedSpec(await response.text()));
  }
  const merged = mergeGetSpecs(specs);
  mkdirSync(new URL("./", outFile), { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), "mercury-openapi-"));
  const specFile = join(dir, "mercury.json");
  writeFileSync(specFile, JSON.stringify(merged));
  const generated = spawnSync(
    "pnpm",
    ["exec", "openapi-typescript", specFile, "--output", outFile.pathname],
    { encoding: "utf8" },
  );
  rmSync(dir, { recursive: true, force: true });
  if (generated.status !== 0) {
    throw new Error(generated.stderr || generated.stdout || "openapi-typescript failed");
  }
  const body = readFileSync(outFile, "utf8").replace(/^\/\*[\s\S]*?\*\/\n/, "");
  writeFileSync(outFile, `${header()}${body}`);
  console.log(`wrote ${outFile.pathname}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
