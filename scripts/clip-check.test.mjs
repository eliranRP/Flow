import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CLIP_OK_SELECTOR, isClipped, passLine, reportsClip, storySkipsText, storyViewPhrase, THEMES, WIDTHS } from "./clip-check.mjs";

const playwrightSkip = (() => {
  try {
    createRequire(new URL("../app/package.json", import.meta.url)).resolve("playwright");
    return false;
  } catch {
    return "Playwright is not installed";
  }
})();

test("a text element is clipped only when its text is wider than its box by more than 1px", () => {
  assert.equal(isClipped(100, 100), false);
  assert.equal(isClipped(101, 100), false);
  assert.equal(isClipped(102, 100), true);
});

test("a row title ellipsis is designed, and a single-line hint is still a clip", () => {
  const ellipsis = {
    textWidth: 200,
    boxWidth: 80,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    overflow: "hidden",
  };
  assert.equal(reportsClip({ ...ellipsis, clipOk: true }), false);
  assert.equal(reportsClip({ ...ellipsis, clipOk: false }), true);
  assert.equal(reportsClip({
    textWidth: 200,
    boxWidth: 80,
    textOverflow: "clip",
    whiteSpace: "normal",
    overflow: "visible",
    clipOk: false,
  }), true);
});

test("the clip check covers 320, 360, and 390 in light and dark", () => {
  assert.deepEqual(WIDTHS, [320, 360, 390]);
  assert.deepEqual(THEMES, ["light", "dark"]);
  assert.match(CLIP_OK_SELECTOR, /\.ui-row-title/);
  assert.match(CLIP_OK_SELECTOR, /data-clip-ok/);
  assert.doesNotMatch(CLIP_OK_SELECTOR, /ui-row-hint/);
});

test("only the clip-no-text tag skips a story", () => {
  assert.equal(storySkipsText({ tags: ["clip-no-text"] }), true);
  assert.equal(storySkipsText({ tags: ["clip-no-text"], parameters: { clipCheck: { noText: true } } }), true);
  assert.equal(storySkipsText({ parameters: { clipCheck: { noText: true } } }), false);
  assert.equal(storySkipsText({ tags: [] }), false);
  assert.equal(storySkipsText({}), false);
});

test("one view is singular and a pass names skipped stories", () => {
  assert.equal(storyViewPhrase(1), "1 story view");
  assert.equal(storyViewPhrase(2), "2 story views");
  assert.equal(passLine({ stories: 12, skipped: 2, measured: 40, themes: ["light", "dark"], widths: [320, 360, 390] }),
    "clip-check passed. 12 stories, 2 skipped, 40 elements, light/dark at 320/360/390.");
});

test("pnpm clip-check runs the script", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts["clip-check"], /clip-check\.mjs/);
  assert.equal(pkg.scripts["clip-check"].includes("scripts/clip-check "), false);
});

function staticSite(html, entries = { a: { type: "story", id: "a", title: "A", name: "A" } }) {
  const dir = mkdtempSync(join(tmpdir(), "clip-check-"));
  writeFileSync(join(dir, "index.json"), JSON.stringify({ entries }));
  writeFileSync(join(dir, "iframe.html"), `<!doctype html><html><body>${html}</body></html>`);
  return dir;
}

test("a missing build and an empty index exit 2", async () => {
  const { execute } = await import("./clip-check.mjs");
  const reportDir = mkdtempSync(join(tmpdir(), "clip-report-"));
  const empty = staticSite("<div id=\"storybook-root\"><p class=\"t-hint\">שלום</p></div>", {});
  try {
    assert.equal(await execute({ staticDir: join(tmpdir(), "clip-check-missing"), reportDir }), 2);
    const missing = JSON.parse(readFileSync(join(reportDir, "clip-report.json"), "utf8"));
    assert.match(missing.note, /Build Storybook first/);
    assert.equal(readFileSync(join(reportDir, "clip-report.txt"), "utf8").includes("exit 2"), true);
    assert.equal(await execute({ staticDir: empty, reportDir: empty }), 2);
    const emptyReport = JSON.parse(readFileSync(join(empty, "clip-report.json"), "utf8"));
    assert.match(emptyReport.note, /no stories/);
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  }
});

test("a setup failure deletes a stale crash report", async () => {
  const { execute } = await import("./clip-check.mjs");
  const reportDir = mkdtempSync(join(tmpdir(), "clip-report-"));
  writeFileSync(join(reportDir, "clip-report.json"), JSON.stringify({
    exit: 3,
    note: "old crash",
    views: [{ storyId: "ghost", status: "measured", elements: [] }],
  }));
  writeFileSync(join(reportDir, "clip-report.txt"), "exit 3\n");
  try {
    assert.equal(await execute({ staticDir: join(tmpdir(), "clip-check-missing-stale"), reportDir }), 2);
    const report = JSON.parse(readFileSync(join(reportDir, "clip-report.json"), "utf8"));
    assert.equal(report.exit, 2);
    assert.match(report.note, /Build Storybook first/);
    assert.equal(JSON.stringify(report).includes("ghost"), false);
    assert.equal(JSON.stringify(report).includes("old crash"), false);
    assert.equal(readFileSync(join(reportDir, "clip-report.txt"), "utf8").includes("ghost"), false);
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
});

test("a crash exits 3", { skip: playwrightSkip }, async () => {
  const { execute } = await import("./clip-check.mjs");
  const dir = staticSite("<div id=\"storybook-root\"><p class=\"t-hint\">שלום</p></div>");
  try {
    const code = await execute({
      staticDir: dir,
      widths: [320],
      themes: ["light"],
      reportDir: dir,
      launch: async () => {
        throw new Error("boom");
      },
    });
    assert.equal(code, 3);
    const crash = JSON.parse(readFileSync(join(dir, "clip-report.json"), "utf8"));
    assert.equal(crash.exit, 3);
    assert.match(crash.note, /boom/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the preview server binds an ephemeral port", async () => {
  const { listenStatic } = await import("./clip-check.mjs");
  const dir = staticSite("<div id=\"storybook-root\"><p class=\"t-hint\">שלום</p></div>");
  try {
    const first = await listenStatic(dir);
    const second = await listenStatic(dir);
    try {
      assert.notEqual(first.port, 6194);
      assert.notEqual(second.port, 6194);
      assert.notEqual(first.port, second.port);
    } finally {
      await new Promise((resolve) => { first.server.close(resolve); });
      await new Promise((resolve) => { second.server.close(resolve); });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a crash keeps the views measured before it", { skip: playwrightSkip }, async () => {
  const { execute } = await import("./clip-check.mjs");
  const dir = staticSite("<div id=\"storybook-root\"><span>שלום</span></div>", {
    first: { type: "story", id: "first", title: "First", name: "First" },
    second: { type: "story", id: "second", title: "Second", name: "Second" },
  });
  try {
    const code = await execute({
      staticDir: dir,
      widths: [320],
      themes: ["light"],
      reportDir: dir,
      launch: async () => ({
        async newPage() {
          return {
            async setViewportSize() {},
            async goto(url) {
              const id = new URL(url).searchParams.get("id");
              if (id === "second") throw new Error("midway");
            },
            locator() {
              return { waitFor: async () => {}, count: async () => 0, nth: () => ({ waitFor: async () => {} }) };
            },
            async waitForFunction() {},
            async evaluate(fn) {
              const source = Function.prototype.toString.call(fn);
              if (source.includes("fonts")) return undefined;
              if (source.includes("classList.contains")) return false;
              return [{
                textWidth: 40,
                boxWidth: 80,
                textOverflow: "clip",
                whiteSpace: "normal",
                overflow: "visible",
                clipOk: false,
                className: "span",
                label: "span \"שלום\"",
              }];
            },
          };
        },
        async close() {},
      }),
    });
    assert.equal(code, 3);
    const crash = JSON.parse(readFileSync(join(dir, "clip-report.json"), "utf8"));
    assert.equal(crash.exit, 3);
    assert.match(crash.note, /midway/);
    assert.equal(crash.views.length, 1);
    assert.equal(crash.views[0].storyId, "first");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the clip report sits at the repo root", async () => {
  const { clipReportDir } = await import("./clip-check.mjs");
  assert.equal(clipReportDir(), fileURLToPath(new URL("..", import.meta.url)));
});

test("the storybook directory is a filesystem path", async () => {
  const { storybookStaticDir } = await import("./clip-check.mjs");
  const expected = fileURLToPath(new URL("../app/storybook-static/", import.meta.url));
  assert.equal(storybookStaticDir(), expected);
  assert.equal(storybookStaticDir().includes("%20"), false);
});
