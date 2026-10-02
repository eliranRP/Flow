import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { execute, reportsClip } from "../../scripts/clip-check.mjs";

function staticSite(html: string, entries: Record<string, { type: string; id: string; title: string; name: string }> = { a: { type: "story", id: "a", title: "A", name: "A" } }): string {
  const dir = mkdtempSync(join(tmpdir(), "clip-check-"));
  writeFileSync(join(dir, "index.json"), JSON.stringify({ entries }));
  writeFileSync(join(dir, "iframe.html"), `<!doctype html><html><body>${html}</body></html>`);
  return dir;
}

test("reportsClip uses a real hint and a real title", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.setContent(`<!doctype html><style>
    .ui-row-title, .ui-row-hint, .opt { display: block; width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; }
  </style>
  <p class="ui-row-title" id="title">כותרת ארוכה מאוד שלא נכנסת</p>
  <p class="ui-row-hint" id="hint">רמז ארוך מאוד שלא נכנס בשורה</p>
  <p class="opt" id="opt" data-clip-ok>טקסט ארוך מאוד שלא נכנס בשורה</p>`);
  const samples = await page.evaluate((clipOkSelector) => {
    function read(id: string) {
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
  expect(samples.hint.textWidth).toBeGreaterThan(samples.hint.boxWidth + 1);
  expect(samples.hint.clipOk).toBe(false);
  expect(samples.title.clipOk).toBe(true);
  expect(samples.opt.clipOk).toBe(true);
  expect(reportsClip(samples.hint)).toBe(true);
  expect(reportsClip(samples.title)).toBe(false);
  expect(reportsClip(samples.opt)).toBe(false);
});

test("a story that renders late and clips exits 1", async () => {
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
    expect(await execute({ staticDir: dir, widths: [320], themes: ["light"] })).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a hidden sheet panel is measured once it is visible", async () => {
  const dir = staticSite(`<div id="storybook-root"><div id="mark"></div></div>
    <div class="ui-sheet-panel" style="display:none"><p class="t-hint" style="display:block;width:20px;white-space:nowrap">מילהארוכהמאוד</p></div>
    <script>setTimeout(() => { document.querySelector(".ui-sheet-panel").style.display = "block"; }, 80);</script>`);
  try {
    expect(await execute({ staticDir: dir, widths: [320], themes: ["light"] })).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a Storybook error display and a story with no text exit 2", async () => {
  const errorDir = staticSite(`<div id="storybook-root"><p class="t-hint">שלום</p></div><p id="error-message">failed</p>
    <script>document.body.classList.add("sb-show-errordisplay");</script>`);
  const emptyDir = staticSite("<div id=\"storybook-root\"><div class=\"box\"></div></div>");
  try {
    expect(await execute({ staticDir: errorDir, widths: [320], themes: ["light"] })).toBe(2);
    expect(await execute({ staticDir: emptyDir, widths: [320], themes: ["light"] })).toBe(2);
  } finally {
    rmSync(errorDir, { recursive: true, force: true });
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test("a fitting story exits 0 and a single-line hint is not exempt", async () => {
  const fit = staticSite("<div id=\"storybook-root\"><p class=\"t-hint\">שלום</p></div>");
  const title = staticSite(`<style>.ui-row-title{display:block;width:20px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}</style>
    <div id="storybook-root"><p class="ui-row-title">כותרתארוכהמאודשלאנכנסת</p></div>`);
  const hint = staticSite(`<style>.ui-row-hint{display:block;width:20px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}</style>
    <div id="storybook-root"><p class="ui-row-hint">רמזארוךמאודשלאנכנס</p></div>`);
  const lines: string[] = [];
  try {
    expect(await execute({
      staticDir: fit,
      widths: [320],
      themes: ["light"],
      log: (line) => { lines.push(line); },
    })).toBe(0);
    expect(lines.join("\n")).toMatch(/1 elements/);
    expect(await execute({ staticDir: title, widths: [320], themes: ["light"] })).toBe(0);
    expect(await execute({ staticDir: hint, widths: [320], themes: ["light"] })).toBe(1);
  } finally {
    rmSync(fit, { recursive: true, force: true });
    rmSync(title, { recursive: true, force: true });
    rmSync(hint, { recursive: true, force: true });
  }
});
