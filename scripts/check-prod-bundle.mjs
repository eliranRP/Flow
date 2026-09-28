/**
 * The production module graph and the built client must not import fixture
 * files or the golden answer key. Unit tests and Storybook may.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "app/src/main.tsx");
const importMarkers = ["demo-data", "expected-pnl", "fixtures/"];
const distMarkers = [
  "demo-data",
  "expected-pnl",
  "שיפוץ דירה + לובי בבניין ברחוב הרצל 12, רמת גן. הלקוח העיקרי יזמות הגליל; ד.ל. נכסים (חברת הניהול) הזמינה תוספות בלובי.",
];
const seen = new Set();
const bad = [];

function resolveImport(fromFile, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const text = readFileSync(file, "utf8");
  const specs = [
    ...text.matchAll(/from\s+["']([^"']+)["']/g),
    ...text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]);
  for (const spec of specs) {
    if (spec.endsWith(".json") || importMarkers.some((marker) => spec.includes(marker))) {
      bad.push(`${path.relative(root, file)} imports ${spec}`);
    }
    const next = resolveImport(file, spec);
    if (next) walk(next);
  }
}

walk(entry);

function scanDir(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      scanDir(full);
      continue;
    }
    if (!/\.(js|css|html|webmanifest)$/.test(name)) continue;
    const body = readFileSync(full, "utf8");
    for (const marker of distMarkers) {
      if (body.includes(marker)) bad.push(`${path.relative(root, full)} contains ${marker}`);
    }
  }
}

const dist = path.join(root, "app/dist");
if (!existsSync(dist)) {
  bad.push("app/dist is missing. Run pnpm build before this check.");
}
if (existsSync(dist)) scanDir(dist);

if (bad.length > 0) {
  console.error(bad.join("\n"));
  process.exit(1);
}

console.log(`production graph: ${String(seen.size)} files, dist has no fixture markers`);
