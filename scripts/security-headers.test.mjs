import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { buildCsp, CSP_PLACEHOLDER, fillCsp, inlineScripts, parseHeaders, scriptHash, supabaseOrigin } from "./security-headers.mjs";

const root = new URL("../app/", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");

/** @param {string} csp */
function directives(csp) {
  return new Map(csp.split(";").map((part) => {
    const [name, ...values] = part.trim().split(/\s+/);
    return [name, values];
  }));
}

test("every path gets the security headers, with the CSP report-only", () => {
  const all = parseHeaders(read("public/_headers")).get("/*");
  assert.ok(all, "app/public/_headers has a /* rule");
  assert.equal(all.get("content-security-policy-report-only"), CSP_PLACEHOLDER);
  assert.equal(all.has("content-security-policy"), false, "the enforced CSP waits for the report-only period (0192)");
  assert.equal(all.get("x-frame-options"), "DENY");
  assert.equal(all.get("x-content-type-options"), "nosniff");
  assert.equal(all.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(all.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  const policy = all.get("permissions-policy") ?? "";
  for (const feature of ["camera", "microphone", "geolocation", "payment"]) {
    assert.match(policy, new RegExp(`(^|, )${feature}=\\(\\)`), `${feature} is off`);
  }
});

test("the route rules still type the extensionless shell as HTML", () => {
  const rules = parseHeaders(read("public/_headers"));
  assert.equal(rules.get("/app-shell")?.get("content-type"), "text/html; charset=utf-8");
  assert.equal(rules.get("/sign-in")?.get("content-type"), "text/html; charset=utf-8");
});

test("the CSP allows the inline theme script by hash and the Supabase origin", () => {
  const html = read("index.html");
  const scripts = inlineScripts(html);
  assert.equal(scripts.length, 1, "index.html has one inline script");
  assert.match(scripts[0], /flow\.theme/);
  const csp = directives(buildCsp({ html, supabaseUrl: "https://abc.supabase.co/" }));
  assert.deepEqual(csp.get("script-src"), ["'self'", scriptHash(scripts[0])]);
  assert.deepEqual(csp.get("connect-src"), ["'self'", "https://abc.supabase.co"]);
  assert.deepEqual(csp.get("default-src"), ["'self'"]);
  assert.deepEqual(csp.get("style-src"), ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(csp.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(csp.get("object-src"), ["'none'"]);
  for (const name of ["worker-src", "manifest-src", "base-uri", "form-action", "img-src", "font-src"]) {
    assert.deepEqual(csp.get(name), ["'self'"], name);
  }
});

test("a build with no Supabase URL connects only to itself, and a plain-http URL is refused", () => {
  const csp = directives(buildCsp({ html: "<p></p>", supabaseUrl: "" }));
  assert.deepEqual(csp.get("connect-src"), ["'self'"]);
  assert.deepEqual(csp.get("script-src"), ["'self'"]);
  assert.equal(supabaseOrigin("http://127.0.0.1:54321"), "http://127.0.0.1:54321");
  assert.throws(() => supabaseOrigin("http://abc.supabase.co"), /https/);
});

test("a script with src is not hashed, and the hash is the one browsers compute", () => {
  assert.deepEqual(inlineScripts('<script type="module" src="/a.js"></script><script>x()</script>'), ["x()"]);
  // echo -n 'x()' | openssl dgst -sha256 -binary | base64
  assert.equal(scriptHash("x()"), "'sha256-D6IGS8VMvCoyaR/l0h9tERrBTATY01CoPS7l6xDv0kI='");
});

test("the placeholder is filled exactly once", () => {
  assert.equal(fillCsp(`/*\n  CSP: ${CSP_PLACEHOLDER}\n`, "default-src 'self'"), "/*\n  CSP: default-src 'self'\n");
  assert.throws(() => fillCsp("/*\n", "x"), /exactly once/);
  assert.throws(() => fillCsp(`${CSP_PLACEHOLDER} ${CSP_PLACEHOLDER}`, "x"), /exactly once/);
});

test("a built dist names its own inline scripts", { skip: !existsSync(new URL("dist/_headers", root)) && "no app/dist" }, () => {
  const csp = parseHeaders(read("dist/_headers")).get("/*")?.get("content-security-policy-report-only") ?? "";
  const allowed = directives(csp).get("script-src") ?? [];
  for (const file of ["dist/index.html", "dist/404.html", "dist/app-shell"]) {
    for (const source of inlineScripts(read(file))) assert.ok(allowed.includes(scriptHash(source)), `${file} inline script is allowed`);
  }
});
