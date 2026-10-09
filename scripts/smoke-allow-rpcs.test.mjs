// The deploy smoke's write guard (app/e2e/smoke-allow.ts) lets through only the RPCs in readRpcs.
// A screen that starts calling a new read RPC turned main's deploy smoke red twice (#262, #266).
// These tests keep the list in step with the app: every RPC the app calls whose definition in the
// migrations is `stable` or `immutable` is a read and must be listed; nothing volatile may be.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every app source, without tests and stories. */
function appSources(dir = "app/src") {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...appSources(rel));
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/** RPC name -> the files that call it, and the calls whose name is not a string literal. */
function appRpcs() {
  const calls = new Map();
  const dynamic = [];
  for (const file of appSources()) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of text.matchAll(/\.rpc\(\s*("([a-z0-9_]+)"|[^\s)]*)/g)) {
      const name = match[2];
      if (name == null) {
        dynamic.push(`${file}: .rpc(${match[1]}`);
        continue;
      }
      calls.set(name, [...(calls.get(name) ?? []), file]);
    }
  }
  return { calls, dynamic };
}

/**
 * Each public function's volatility as the migrations leave it, read in order: the last
 * `create function` header (before `as`) or `alter function` that names one wins. Postgres
 * defaults to volatile.
 */
export function volatilities(files) {
  const found = new Map();
  for (const text of files) {
    const statements = /(create\s+(?:or\s+replace\s+)?function|alter\s+function)\s+public\.([a-z0-9_]+)\s*\(([\s\S]*?)(?:\bas\s+[$']|;)/gi;
    for (const match of text.matchAll(statements)) {
      const words = match[3].toLowerCase();
      const kind = /\bimmutable\b/.test(words)
        ? "immutable"
        : /\bstable\b/.test(words)
          ? "stable"
          : /\bvolatile\b/.test(words) || match[1].toLowerCase().startsWith("create")
            ? "volatile"
            : null;
      if (kind != null) found.set(match[2], kind);
    }
  }
  return found;
}

function migrationVolatilities() {
  const dir = path.join(root, "supabase/migrations");
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
  return volatilities(files.map((name) => fs.readFileSync(path.join(dir, name), "utf8")));
}

/** readRpcs as written in app/e2e/smoke-allow.ts. */
function readRpcs() {
  const text = fs.readFileSync(path.join(root, "app/e2e/smoke-allow.ts"), "utf8");
  const list = /export const readRpcs = new Set\(\[([\s\S]*?)\]\)/.exec(text);
  assert.ok(list, "readRpcs moved in app/e2e/smoke-allow.ts: update scripts/smoke-allow-rpcs.test.mjs");
  return [...list[1].matchAll(/"([a-z0-9_]+)"/g)].map((match) => match[1]);
}

test("the volatility parser reads headers, the last definition, and alter function", () => {
  const found = volatilities([
    "create or replace function public.a()\n returns jsonb\n language sql\n stable\nas $f$ select 1 $f$;",
    "create function public.b(p uuid) returns void language plpgsql as $$ begin perform 1; end $$;",
    "create function public.c() returns int language sql stable as $$ select 1 $$;",
    "create or replace function public.c() returns int language sql as $$ select 1 $$;",
    "alter function public.b(uuid) stable;",
  ]);
  assert.equal(found.get("a"), "stable");
  assert.equal(found.get("b"), "stable");
  assert.equal(found.get("c"), "volatile");
  const live = migrationVolatilities();
  assert.equal(live.get("list_review"), "stable");
  assert.equal(live.get("approve_review_item"), "volatile");
});

test("every RPC the app calls names it as a string, and exists in the migrations", () => {
  const { calls, dynamic } = appRpcs();
  assert.deepEqual(dynamic, [], "the smoke guard needs each RPC name as a string literal");
  assert.ok(calls.size > 0);
  const live = migrationVolatilities();
  const missing = [...calls.keys()].filter((name) => !live.has(name));
  assert.deepEqual(missing, [], "no public function with this name in supabase/migrations");
});

test("every stable RPC the app calls is in readRpcs, so the deploy smoke lets it through", () => {
  const live = migrationVolatilities();
  const listed = new Set(readRpcs());
  const missing = [...appRpcs().calls.entries()]
    .filter(([name]) => live.get(name) !== "volatile" && !listed.has(name))
    .map(([name, files]) => `${name} (${files.join(", ")})`);
  assert.deepEqual(missing, [], "add these reads to readRpcs in app/e2e/smoke-allow.ts");
});

test("readRpcs holds only stable or immutable functions, so the guard lets no write through", () => {
  const live = migrationVolatilities();
  const writes = readRpcs().filter((name) => live.get(name) == null || live.get(name) === "volatile");
  assert.deepEqual(writes, [], "a volatile (or unknown) function can write: keep it out of readRpcs");
});
