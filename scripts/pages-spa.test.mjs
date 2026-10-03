import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const redirects = readFileSync(path.join(root, "app/public/_redirects"), "utf8");
const headers = readFileSync(path.join(root, "app/public/_headers"), "utf8");

function rules(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function indexOfRouteOpen(source, from) {
  let i = from;
  while (i < source.length) {
    const found = source.indexOf("<Route", i);
    if (found < 0) return -1;
    const next = source[found + "<Route".length];
    if (next === " " || next === "\n" || next === "\t" || next === ">" || next === "/") return found;
    i = found + "<Route".length;
  }
  return -1;
}

function readJsxTag(source, start) {
  let i = start;
  let quote = null;
  let brace = 0;
  while (i < source.length) {
    const char = source[i];
    if (quote) {
      if (char === quote) quote = null;
      i += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      i += 1;
      continue;
    }
    if (char === "{") {
      brace += 1;
      i += 1;
      continue;
    }
    if (char === "}") {
      brace -= 1;
      i += 1;
      continue;
    }
    if (char === ">" && brace === 0) {
      const raw = source.slice(start, i + 1);
      return { raw, selfClosing: /\/\s*>$/.test(raw), end: i + 1 };
    }
    i += 1;
  }
  throw new Error("unclosed Route tag");
}

function joinRoute(parent, child) {
  if (child.startsWith("/")) return child;
  if (parent === "" || parent === "/") return `/${child}`;
  return `${parent.replace(/\/$/, "")}/${child.replace(/^\//, "")}`;
}

function pathAttribute(tag) {
  const match = tag.match(/\bpath\s*=\s*("[^"]*"|'[^']*'|\{[\s\S]*?\})/);
  if (!match) return null;
  return { raw: match[0].replace(/\s+/g, " "), value: match[1] };
}

/** Route tags in source. A path that is not a double-quoted literal is recorded in `bad`. */
function walkRoutes(source) {
  const routes = [];
  const bad = [];
  const stack = [""];
  let i = 0;
  while (i < source.length) {
    const nextOpen = indexOfRouteOpen(source, i);
    const nextClose = source.indexOf("</Route>", i);
    if (nextOpen < 0 && nextClose < 0) break;
    if (nextClose >= 0 && (nextOpen < 0 || nextClose < nextOpen)) {
      if (stack.length > 1) stack.pop();
      i = nextClose + "</Route>".length;
      continue;
    }
    const tag = readJsxTag(source, nextOpen);
    const attr = pathAttribute(tag.raw);
    let full = stack[stack.length - 1];
    if (attr) {
      if (!attr.value.startsWith('"')) bad.push(attr.raw);
      else {
        full = joinRoute(stack[stack.length - 1], attr.value.slice(1, -1));
        if (full !== "/") routes.push(full);
      }
    }
    if (!tag.selfClosing) stack.push(full);
    i = tag.end;
  }
  return { routes: [...new Set(routes)].sort(), bad };
}

/** Production routes from App.tsx. `/` is index.html. Dev and reviewer routes are not shipped. */
function productionRoutes(source) {
  const shipped = source.replace(/\{import\.meta\.env\.DEV \? \([\s\S]*?\) : null\}/, "");
  return walkRoutes(shipped).routes;
}

function nonLiteralRoutePaths(source) {
  return walkRoutes(source).bad;
}

function redirectLines(text) {
  return rules(text).map((line) => {
    const [source, destination, status] = line.split(/\s+/);
    return { source, destination, status };
  });
}

function redirectDrift(appSource, redirectText) {
  const routes = productionRoutes(appSource);
  const lines = redirectLines(redirectText);
  const serve = lines.filter((line) => line.status === "200");
  const slash = lines.filter((line) => line.status === "301");
  const other = lines.filter((line) => line.status !== "200" && line.status !== "301");
  const missing = routes.filter(
    (route) => !serve.some((line) => line.source === route && line.destination === "/app-shell"),
  );
  const stale = serve
    .filter((line) => !routes.includes(line.source) || line.destination !== "/app-shell")
    .map((line) => line.source);
  const missingSlash = routes.filter(
    (route) => !slash.some((line) => line.source === `${route}/` && line.destination === route),
  );
  const staleSlash = slash
    .filter((line) => line.destination !== line.source.slice(0, -1) || !routes.includes(line.destination))
    .map((line) => line.source);
  return {
    missing,
    stale,
    missingSlash,
    staleSlash,
    other: other.map((line) => line.source),
    badPaths: nonLiteralRoutePaths(appSource),
  };
}

function headerRules(text) {
  return text
    .split("\n")
    .filter((line) => line.startsWith("/"))
    .map((line) => line.trim());
}

function headerCovers(route, blocks) {
  if (blocks.includes(route)) return true;
  return blocks.some((block) => block.endsWith("/*") && route.startsWith(block.slice(0, -1)));
}

test("the Pages fallback lists app routes and does not use the rejected splat", () => {
  const vite = readFileSync(path.join(root, "app/vite.config.ts"), "utf8");
  assert.equal(vite.includes("/*  /index.html  200"), false);
  assert.match(vite, /app-shell/);
  const lines = rules(redirects);
  assert.ok(lines.some((line) => line.startsWith("/settings ")));
  assert.equal(lines.some((line) => line.startsWith("/* ")), false);
  for (const line of lines) {
    const [source, destination, status] = line.split(/\s+/);
    assert.equal(source.startsWith("/assets"), false);
    if (source.endsWith("/")) {
      assert.equal(status, "301");
      assert.equal(destination, source.slice(0, -1));
    } else {
      assert.equal(destination, "/app-shell");
      assert.equal(status, "200");
    }
  }
  assert.match(headers, /^\/settings\n {2}Content-Type: text\/html/m);
  assert.match(headers, /^\/app-shell\n {2}Content-Type: text\/html/m);
  assert.equal(headers.includes("\n/*\n"), false);
});

test("nested relative routes resolve, and a path that is not a double-quoted literal fails", () => {
  const nested = `<Route path="projects"><Route path=":projectId"><Route path="categories/:categoryId" /></Route></Route><Route path="/absolute" />`;
  assert.deepEqual(productionRoutes(nested), [
    "/absolute",
    "/projects",
    "/projects/:projectId",
    "/projects/:projectId/categories/:categoryId",
  ]);
  const bad = `<Route path={'/settings'} /><Route path={\`/add\`} /><Route path='/help' />`;
  assert.deepEqual(nonLiteralRoutePaths(bad), ["path={'/settings'}", "path={`/add`}", "path='/help'"]);
});

test("every production route is listed in _redirects, and a stale entry fails", () => {
  const app = readFileSync(path.join(root, "app/src/App.tsx"), "utf8");
  const drift = redirectDrift(app, redirects);
  assert.deepEqual(drift.badPaths, []);
  assert.deepEqual(drift.missing, []);
  assert.deepEqual(drift.stale, []);
  assert.deepEqual(drift.missingSlash, []);
  assert.deepEqual(drift.staleSlash, []);
  assert.deepEqual(drift.other, []);
  const routes = productionRoutes(app);
  assert.ok(routes.includes("/settings"));
  assert.ok(routes.includes("/projects/:projectId/categories/:categoryId"));
  assert.equal(routes.includes("/e2e/home"), false);
  assert.equal(routes.includes("/reviewer/*"), false);
  assert.equal(routes.includes("/"), false);

  const stale = redirectDrift(app, `${redirects}\n/gone /app-shell 200\n`);
  assert.deepEqual(stale.stale, ["/gone"]);
});

test("every production route is covered by _headers", () => {
  const routes = productionRoutes(readFileSync(path.join(root, "app/src/App.tsx"), "utf8"));
  const blocks = headerRules(headers);
  const missingHeader = routes.filter((route) => !headerCovers(route, blocks));
  assert.deepEqual(missingHeader, []);
});

test("a deep link is 200 HTML, a trailing slash redirects once, and a missing asset stays 404", { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "flow-pages-"));
  const shell = "<html><head><title>Flow</title></head><body>APP</body></html>\n";
  writeFileSync(path.join(dir, "index.html"), shell);
  writeFileSync(path.join(dir, "404.html"), shell);
  writeFileSync(path.join(dir, "app-shell"), shell);
  const assetDir = path.join(dir, "assets");
  mkdirSync(assetDir);
  writeFileSync(path.join(assetDir, "app.js"), "console.log(\"real\")\n");
  writeFileSync(path.join(dir, "_redirects"), redirects);
  writeFileSync(path.join(dir, "_headers"), headers);

  const port = await freePort();
  const child = spawn(
    "pnpm",
    ["exec", "wrangler", "pages", "dev", dir, "--port", String(port), "--ip", "127.0.0.1", "--persist-to", path.join(dir, "wrangler-state")],
    { cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk;
  });
  child.stderr.on("data", (chunk) => {
    log += chunk;
  });
  const stop = () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  };
  try {
    const ready = Date.now() + 20000;
    while (!log.includes("Ready on") && Date.now() < ready) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!log.includes("Ready on") || log.includes("invalid redirect")) {
      throw new Error(`wrangler did not serve the redirects\n${log}`);
    }

    const get = async (urlPath) => {
      const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, { redirect: "manual" });
      return {
        status: response.status,
        type: response.headers.get("content-type") ?? "",
        location: response.headers.get("location"),
        body: await response.text(),
      };
    };

    const settings = await get("/settings?preview=1");
    assert.equal(settings.status, 200);
    assert.equal(settings.location, null);
    assert.match(settings.type, /^text\/html/);
    assert.match(settings.body, /APP/);

    const slashed = await get("/settings/?preview=1");
    assert.equal(slashed.status, 301);
    assert.match(slashed.location ?? "", /\/settings\?preview=1$/);
    assert.equal((slashed.location ?? "").endsWith("/settings/?preview=1"), false);
    const followed = await get("/settings?preview=1");
    assert.equal(followed.status, 200);
    assert.equal(followed.location, null);

    const nestedSlash = await get("/projects/abc/categories/def/");
    assert.equal(nestedSlash.status, 301);
    assert.match(nestedSlash.location ?? "", /\/projects\/abc\/categories\/def$/);

    const nested = await get("/projects/abc/categories/def");
    assert.equal(nested.status, 200);
    assert.match(nested.type, /^text\/html/);

    const shellFile = await get("/app-shell");
    assert.equal(shellFile.status, 200);
    assert.match(shellFile.type, /^text\/html/);

    const asset = await get("/assets/app.js");
    assert.equal(asset.status, 200);
    assert.match(asset.type, /javascript/);
    assert.match(asset.body, /console\.log\("real"\)/);

    const missing = await get("/assets/missing.js");
    assert.equal(missing.status, 404);

    const unknown = await get("/no-such");
    assert.equal(unknown.status, 404);
  } catch (error) {
    console.error(log);
    throw error;
  } finally {
    stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
