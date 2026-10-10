import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { appScripts } from "./app-scripts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const scriptRef = /scripts\/[\w.-]+\.(?:mjs|sh)\b/g;
const skipDirs = new Set(["node_modules", "dist", "storybook-static", "test-results", "playwright-report", ".vite"]);

/** Every code and config file under app/, repo-relative. */
function appFiles(folder = "app") {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
    const rel = `${folder}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) out.push(...appFiles(rel));
    } else if (/\.([cm]?[jt]s|tsx|json)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/** The scripts a file names by path ("../scripts/x.mjs", "node scripts/x.mjs"). */
const named = (text) => [...text.matchAll(scriptRef)].map(([match]) => match);
/** A code file's text without its comments, which may name a script that reads the app. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

/** A script and every script it imports by relative path, all the way down. */
function withImports(scripts) {
  const seen = new Set();
  const queue = [...scripts];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !fs.existsSync(path.join(root, file))) continue;
    seen.add(file);
    for (const [, spec] of read(file).matchAll(/(?:from\s*|import\(\s*)["'](\.[^"']+)["']/g)) {
      queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)));
    }
  }
  return [...seen].sort();
}

/** The body of a bash function in local-ci.sh. */
function shellFunction(text, name) {
  const start = text.indexOf(`\n${name}() {\n`);
  assert.ok(start >= 0, `local-ci.sh has no ${name}()`);
  return text.slice(start, text.indexOf("\n}\n", start));
}

test("every script the app's configs, tests, specs and stories name is an app input", () => {
  const reached = withImports(appFiles().flatMap((file) => named(file.endsWith(".json") ? read(file) : code(read(file)))));
  assert.ok(reached.includes("scripts/hosted-env.mjs"), "the scan finds vite.config.ts's import");
  assert.deepEqual(reached.filter((file) => !appScripts.includes(file)), []);
});

test("the scripts the gate's build part and its bundle checks run are app inputs", () => {
  const pkg = JSON.parse(read("package.json"));
  const commands = [pkg.scripts["check:bundle"], pkg.scripts["check:reviewer-bundle"]].join("\n");
  const reached = withImports([...named(commands), ...named(shellFunction(read("scripts/local-ci.sh"), "build_part"))]);
  assert.ok(reached.includes("scripts/stamp-build.mjs"));
  assert.deepEqual(reached.filter((file) => !appScripts.includes(file)), []);
});

test("the scripts that pick which app tests, stories and specs run are app inputs, with their imports", () => {
  const scope = ["scripts/app-scripts.mjs", "scripts/gate-scope.mjs", "scripts/storybook-stories.mjs", "scripts/e2e-specs.mjs"];
  assert.deepEqual(withImports(scope).filter((file) => !appScripts.includes(file)), []);
});

test("every listed script exists, once, and no script test is an app input", () => {
  for (const file of appScripts) assert.ok(fs.existsSync(path.join(root, file)), file);
  assert.equal(new Set(appScripts).size, appScripts.length);
  assert.deepEqual(appScripts.filter((file) => /\.test\.mjs$/.test(file)), []);
});

test("the CLI prints the list, and local-ci.sh hashes it in place of the whole scripts folder", () => {
  const printed = execFileSync("node", [path.join(root, "scripts/app-scripts.mjs")], { encoding: "utf8" });
  assert.deepEqual(printed.trim().split("\n"), appScripts);
  const local = read("scripts/local-ci.sh");
  assert.ok(local.includes("mapfile -t app_scripts < <(node scripts/app-scripts.mjs)"));
  assert.match(local, /\napp_inputs=\(app packages design supabase\/functions\/_shared supabase\/migrations "\$\{app_scripts\[@\]\}"\n/);
  // The typecheck still covers every script (tsc -p scripts/tsconfig.json).
  assert.ok(local.includes('typecheck_key="typecheck-$(inputs_hash "${app_inputs[@]}" scripts)"'));
});
