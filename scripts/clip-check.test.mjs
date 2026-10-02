import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isClipped, reportsClip, TEXT_SELECTOR, THEMES, WIDTHS } from "./clip-check.mjs";

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
  assert.match(TEXT_SELECTOR, /\.ui-row-hint/);
  assert.match(TEXT_SELECTOR, /\.ui-row-title/);
  assert.doesNotMatch(TEXT_SELECTOR, /button/);
});

test("pnpm clip-check runs the script", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts["clip-check"], /clip-check\.mjs/);
  assert.equal(pkg.scripts["clip-check"].includes("scripts/clip-check "), false);
});

test("reportsClip uses a real hint and a real title", async () => {
  const require = createRequire(new URL("../app/package.json", import.meta.url));
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 800 } });
    await page.setContent(`<!doctype html><style>
      .ui-row-title, .ui-row-hint, .opt { display: block; width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; }
    </style>
    <p class="ui-row-title" id="title">כותרת ארוכה מאוד שלא נכנסת</p>
    <p class="ui-row-hint" id="hint">רמז ארוך מאוד שלא נכנס בשורה</p>
    <p class="opt" id="opt" data-clip-ok>טקסט ארוך מאוד שלא נכנס בשורה</p>`);
    const samples = await page.evaluate((clipOkSelector) => {
      function read(id) {
        const node = document.getElementById(id);
        if (!(node instanceof HTMLElement)) throw new Error("missing");
        const style = getComputedStyle(node);
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = [...range.getClientRects()];
        const textWidth = Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left));
        return {
          textWidth,
          boxWidth: node.getBoundingClientRect().width,
          textOverflow: style.textOverflow,
          whiteSpace: style.whiteSpace,
          overflow: style.overflow,
          clipOk: node.matches(clipOkSelector),
        };
      }
      return { title: read("title"), hint: read("hint"), opt: read("opt") };
    }, ".ui-row-title, [data-clip-ok]");
    assert.ok(samples.hint.textWidth > samples.hint.boxWidth + 1);
    assert.equal(samples.hint.clipOk, false);
    assert.equal(samples.title.clipOk, true);
    assert.equal(samples.opt.clipOk, true);
    assert.equal(reportsClip(samples.hint), true);
    assert.equal(reportsClip(samples.title), false);
    assert.equal(reportsClip(samples.opt), false);
  } finally {
    await browser.close();
  }
});

function staticSite(html, entries = { a: { type: "story", id: "a", title: "A", name: "A" } }) {
  const dir = mkdtempSync(join(tmpdir(), "clip-check-"));
  writeFileSync(join(dir, "index.json"), JSON.stringify({ entries }));
  writeFileSync(join(dir, "iframe.html"), `<!doctype html><html><body>${html}</body></html>`);
  return dir;
}

test("a missing build and an empty index exit 2", async () => {
  const { execute } = await import("./clip-check.mjs");
  assert.equal(await execute({ staticDir: join(tmpdir(), "clip-check-missing") }), 2);
  const empty = staticSite("<div id=\"storybook-root\"><p class=\"t-hint\">שלום</p></div>", {});
  try {
    assert.equal(await execute({ staticDir: empty }), 2);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("a crash exits 3", async () => {
  const { execute } = await import("./clip-check.mjs");
  const dir = staticSite("<div id=\"storybook-root\"><p class=\"t-hint\">שלום</p></div>");
  try {
    const code = await execute({
      staticDir: dir,
      widths: [320],
      themes: ["light"],
      launch: async () => {
        throw new Error("boom");
      },
    });
    assert.equal(code, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a story that renders late and clips exits 1", async () => {
  const { execute } = await import("./clip-check.mjs");
  const dir = staticSite(`<div id="storybook-root"></div>
    <script>
      setTimeout(() => {
        const node = document.createElement("p");
        node.className = "t-hint";
        node.style.cssText = "display:block;width:20px;white-space:nowrap";
        node.textContent = "מילהארוכהמאוד";
        document.getElementById("storybook-root").appendChild(node);
      }, 80);
    </script>`);
  try {
    const code = await execute({ staticDir: dir, widths: [320], themes: ["light"] });
    assert.equal(code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a hidden sheet panel is measured once it is visible", async () => {
  const { execute } = await import("./clip-check.mjs");
  const dir = staticSite(`<div id="storybook-root"><div id="mark"></div></div>
    <div class="ui-sheet-panel" style="display:none"><p class="t-hint" style="display:block;width:20px;white-space:nowrap">מילהארוכהמאוד</p></div>
    <script>setTimeout(() => { document.querySelector(".ui-sheet-panel").style.display = "block"; }, 80);</script>`);
  try {
    const code = await execute({ staticDir: dir, widths: [320], themes: ["light"] });
    assert.equal(code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a Storybook error display and a story with no text exit 2", async () => {
  const { execute } = await import("./clip-check.mjs");
  const errorDir = staticSite(`<div id="storybook-root"><p class="t-hint">שלום</p></div><p id="error-message">failed</p>
    <script>document.body.classList.add("sb-show-errordisplay");</script>`);
  const emptyDir = staticSite("<div id=\"storybook-root\"><div class=\"box\"></div></div>");
  try {
    assert.equal(await execute({ staticDir: errorDir, widths: [320], themes: ["light"] }), 2);
    assert.equal(await execute({ staticDir: emptyDir, widths: [320], themes: ["light"] }), 2);
  } finally {
    rmSync(errorDir, { recursive: true, force: true });
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test("a fitting story exits 0 and a single-line hint is not exempt", async () => {
  const { execute } = await import("./clip-check.mjs");
  const fit = staticSite("<div id=\"storybook-root\"><p class=\"t-hint\">שלום</p></div>");
  const title = staticSite(`<style>.ui-row-title{display:block;width:20px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}</style>
    <div id="storybook-root"><p class="ui-row-title">כותרתארוכהמאודשלאנכנסת</p></div>`);
  const hint = staticSite(`<style>.ui-row-hint{display:block;width:20px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}</style>
    <div id="storybook-root"><p class="ui-row-hint">רמזארוךמאודשלאנכנס</p></div>`);
  const lines = [];
  try {
    assert.equal(await execute({
      staticDir: fit,
      widths: [320],
      themes: ["light"],
      log: (line) => lines.push(line),
    }), 0);
    assert.match(lines.join("\n"), /1 elements/);
    assert.equal(await execute({ staticDir: title, widths: [320], themes: ["light"] }), 0);
    assert.equal(await execute({ staticDir: hint, widths: [320], themes: ["light"] }), 1);
  } finally {
    rmSync(fit, { recursive: true, force: true });
    rmSync(title, { recursive: true, force: true });
    rmSync(hint, { recursive: true, force: true });
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

test("the storybook directory is a filesystem path", async () => {
  const { storybookStaticDir } = await import("./clip-check.mjs");
  const expected = fileURLToPath(new URL("../app/storybook-static/", import.meta.url));
  assert.equal(storybookStaticDir(), expected);
  assert.equal(storybookStaticDir().includes("%20"), false);
});
