// FLOW-857: the push worker opens only this app's pages, and the dev servers stay on this machine unless asked.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");

/** Loads push-sw.js's sameOrigin as the worker runs it, with this app's origin. */
function loadSameOrigin() {
  const self = { location: { origin: "https://flow.example" }, addEventListener() {} };
  const context = vm.createContext({ self, URL, Promise });
  vm.runInContext(read("app/public/push-sw.js"), context);
  return context.sameOrigin;
}

test("the push worker's link check keeps only this app's paths, on the first pass", () => {
  const sameOrigin = loadSameOrigin();
  assert.equal(sameOrigin("/review"), "/review");
  assert.equal(sameOrigin("/?week=2026-11-16"), "/?week=2026-11-16");
  assert.equal(sameOrigin("https://flow.example/settings/notifications"), "/settings/notifications");
  // A path that normalises to two leading slashes would open another site when used as a link.
  for (const value of ["/.//evil.example", "/..//evil.example/x", "https://flow.example//evil.example", "//evil.example", "/\\evil.example", "https://evil.example/"]) {
    const kept = sameOrigin(value);
    assert.equal(new URL(kept, "https://flow.example").origin, "https://flow.example", `${value} -> ${kept}`);
    assert.equal(kept.startsWith("//"), false, `${value} -> ${kept}`);
  }
  for (const value of [undefined, null, 42, "", "javascript:alert(1)"]) {
    assert.equal(new URL(sameOrigin(value), "https://flow.example").origin, "https://flow.example");
  }
});

test("the dev servers listen on this machine unless FLOW_DEV_HOST says otherwise", () => {
  const scripts = JSON.parse(read("app/package.json")).scripts;
  for (const name of ["dev", "preview", "storybook"]) {
    assert.equal(/--host\s+0\.0\.0\.0/.test(scripts[name]), false, `app/package.json ${name}`);
  }
  const vite = read("app/vite.config.ts");
  assert.match(vite, /host: process\.env\.FLOW_DEV_HOST \|\| "127\.0\.0\.1",/);
  assert.equal(vite.includes('host: "0.0.0.0"'), false);
});
