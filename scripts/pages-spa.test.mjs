import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("the Pages fallback lists app routes and does not use the rejected splat", () => {
  const vite = readFileSync(path.join(root, "app/vite.config.ts"), "utf8");
  assert.equal(vite.includes("/*  /index.html  200"), false);
  assert.match(vite, /app-shell/);
  const lines = rules(redirects);
  assert.ok(lines.some((line) => line.startsWith("/settings ")));
  assert.equal(lines.some((line) => line.startsWith("/* ")), false);
  for (const line of lines) {
    const [source, destination, status] = line.split(/\s+/);
    assert.equal(destination, "/app-shell");
    assert.equal(status, "200");
    assert.equal(source.startsWith("/assets"), false);
  }
  assert.match(headers, /^\/settings\n {2}Content-Type: text\/html/m);
  assert.equal(headers.includes("\n/*\n"), false);
});

test("a deep link is 200 HTML, and a missing asset stays 404", async () => {
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

  const port = 8791;
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
    assert.match(log, /Ready on/);
    assert.equal(log.includes("invalid redirect"), false);

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

    const nested = await get("/projects/abc/categories/def");
    assert.equal(nested.status, 200);
    assert.match(nested.type, /^text\/html/);

    const asset = await get("/assets/app.js");
    assert.equal(asset.status, 200);
    assert.match(asset.type, /javascript/);
    assert.match(asset.body, /console\.log\("real"\)/);

    const missing = await get("/assets/missing.js");
    assert.equal(missing.status, 404);

    const unknown = await get("/no-such");
    assert.equal(unknown.status, 404);
  } finally {
    stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
