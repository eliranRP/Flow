import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { execute, reportsClip } from "../../scripts/clip-check.mjs";

function staticSite(html: string, entries: Record<string, { type: string; id: string; title: string; name: string; tags?: string[] }> = { a: { type: "story", id: "a", title: "A", name: "A" } }): string {
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
    expect(await execute({ staticDir: dir, widths: [320], themes: ["light"], reportDir: dir })).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a hidden sheet panel is measured once it is visible", async () => {
  const dir = staticSite(`<div id="storybook-root"><div id="mark"></div></div>
    <div class="ui-sheet-panel" style="display:none"><p class="t-hint" style="display:block;width:20px;white-space:nowrap">מילהארוכהמאוד</p></div>
    <script>setTimeout(() => { document.querySelector(".ui-sheet-panel").style.display = "block"; }, 80);</script>`);
  try {
    expect(await execute({ staticDir: dir, widths: [320], themes: ["light"], reportDir: dir })).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a Storybook error display and a story with no text exit 2", async () => {
  const errorDir = staticSite(`<div id="storybook-root"><p class="t-hint">שלום</p></div><p id="error-message">failed</p>
    <script>document.body.classList.add("sb-show-errordisplay");</script>`);
  const emptyDir = staticSite("<div id=\"storybook-root\"><div class=\"box\"></div></div>");
  try {
    expect(await execute({ staticDir: errorDir, widths: [320], themes: ["light"], reportDir: errorDir })).toBe(2);
    expect(await execute({ staticDir: emptyDir, widths: [320], themes: ["light"], reportDir: emptyDir })).toBe(2);
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
      reportDir: fit,
    })).toBe(0);
    expect(lines.join("\n")).toMatch(/1 elements/);
    expect(await execute({ staticDir: title, widths: [320], themes: ["light"], reportDir: title })).toBe(0);
    expect(await execute({ staticDir: hint, widths: [320], themes: ["light"], reportDir: hint })).toBe(1);
  } finally {
    rmSync(fit, { recursive: true, force: true });
    rmSync(title, { recursive: true, force: true });
    rmSync(hint, { recursive: true, force: true });
  }
});

test("a visually hidden 1px line is not measured, so a fitting story can exit 0", async () => {
  const dir = staticSite(`<style>
    .t-hint { display: block; }
    .sr-only { display: block; position: absolute; width: 1px; height: 1px; overflow: hidden; white-space: nowrap; line-height: 1px; }
  </style>
  <div id="storybook-root">
    <p class="t-hint">שלום</p>
    <p class="sr-only">טוען… מילהארוכהמאודשלאנכנסת</p>
  </div>`);
  const lines: string[] = [];
  try {
    expect(await execute({
      staticDir: dir,
      widths: [320],
      themes: ["light"],
      reportDir: dir,
      log: (line) => { lines.push(line); },
    })).toBe(0);
    expect(lines.join("\n")).toMatch(/1 elements/);
    const report = JSON.parse(readFileSync(join(dir, "clip-report.json"), "utf8")) as {
      views: { storyId: string; width: number; theme: string; elements: { className: string; label: string }[] }[];
    };
    const elements = report.views.flatMap((view) => view.elements);
    expect(elements).toHaveLength(1);
    expect(elements[0]?.className).toBe("t-hint");
    expect(elements.some((element) => element.className === "sr-only")).toBe(false);
    expect(report.views[0]?.storyId).toBe("a");
    expect(report.views[0]?.width).toBe(320);
    expect(report.views[0]?.theme).toBe("light");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a Storybook error is printed and exits 2 even when another story clips", async () => {
  const dir = staticSite(`<div id="storybook-root"><p class="t-hint" style="display:block;width:20px;white-space:nowrap">מילהארוכהמאוד</p></div>
    <script>
      const id = new URLSearchParams(location.search).get("id");
      if (id === "err") document.body.classList.add("sb-show-errordisplay");
    </script>`, {
    clip: { type: "story", id: "clip", title: "Clip", name: "Clip" },
    err: { type: "story", id: "err", title: "Err", name: "Err" },
  });
  const errors: string[] = [];
  try {
    expect(await execute({
      staticDir: dir,
      widths: [320],
      themes: ["light"],
      reportDir: dir,
      error: (line) => { errors.push(line); },
    })).toBe(2);
    const log = errors.join("\n");
    expect(log).toContain("err");
    expect(log).toContain("storybook error");
    expect(log).toMatch(/1 story view/);
    const report = JSON.parse(readFileSync(join(dir, "clip-report.json"), "utf8")) as {
      exit: number;
      storyErrors: string[];
      failures: string[];
    };
    expect(report.exit).toBe(2);
    expect(report.storyErrors.some((line) => line.includes("err"))).toBe(true);
    expect(report.failures.some((line) => line.includes("clip"))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("one story that measures nothing exits 2 even when another story fits", async () => {
  const dir = staticSite(`<div id="storybook-root"><p class="t-hint">שלום</p></div>
    <script>
      const id = new URLSearchParams(location.search).get("id");
      if (id === "empty") {
        const root = document.getElementById("storybook-root");
        if (root) root.innerHTML = "<div class='box'></div>";
      }
    </script>`, {
    fit: { type: "story", id: "fit", title: "Fit", name: "Fit" },
    empty: { type: "story", id: "empty", title: "Empty", name: "Empty" },
  });
  const errors: string[] = [];
  try {
    expect(await execute({
      staticDir: dir,
      widths: [320],
      themes: ["light"],
      reportDir: dir,
      error: (line) => { errors.push(line); },
    })).toBe(2);
    expect(errors.join("\n")).toContain("empty");
    expect(errors.join("\n")).toContain("measured nothing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a bare span and a tab label are measured, and a no-text story is skipped", async () => {
  const dir = staticSite(`<div id="storybook-root">
      <span style="display:block;width:20px;white-space:nowrap">מילהארוכהמאוד</span>
      <span class="ui-tab-label" style="display:block;width:20px;white-space:nowrap">מילהארוכהמאוד</span>
    </div>
    <script>
      const id = new URLSearchParams(location.search).get("id");
      if (id === "quiet") {
        const root = document.getElementById("storybook-root");
        if (root) root.innerHTML = "<div class='box'></div>";
      }
    </script>`, {
    text: { type: "story", id: "text", title: "Text", name: "Text", tags: [] },
    quiet: { type: "story", id: "quiet", title: "Quiet", name: "Quiet", tags: ["clip-no-text"] },
  });
  const errors: string[] = [];
  try {
    expect(await execute({
      staticDir: dir,
      widths: [320],
      themes: ["light"],
      reportDir: dir,
      error: (line) => { errors.push(line); },
    })).toBe(1);
    expect(errors.join("\n")).toMatch(/1 story view that clips|1 story view clips/);
    const report = JSON.parse(readFileSync(join(dir, "clip-report.json"), "utf8")) as {
      skipped: string[];
      zeroMeasured: string[];
      views: { storyId: string; status: string; elements: { className: string }[] }[];
    };
    const measured = report.views.find((view) => view.storyId === "text");
    expect(measured?.elements.map((element) => element.className).sort()).toEqual(["", "ui-tab-label"]);
    expect(report.skipped).toContain("quiet");
    expect(report.views.find((view) => view.storyId === "quiet")?.status).toBe("skipped");
    expect(report.zeroMeasured).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an inline bdi is measured on the block that clips", async () => {
  const dir = staticSite(`<style>
      .ui-row-hint, .mixed, .t-display { display: block; width: 80px; overflow: hidden; white-space: nowrap; }
      bdi { display: inline; white-space: nowrap; }
    </style>
    <div id="storybook-root"></div>
    <script>
      const id = new URLSearchParams(location.search).get("id");
      const root = document.getElementById("storybook-root");
      if (id === "email") root.innerHTML = '<p class="ui-row-hint"><bdi dir="ltr">owner@example.com</bdi></p>';
      if (id === "mixed") root.innerHTML = '<p class="mixed">מספר <bdi dir="ltr">123456789012345</bdi></p>';
      if (id === "amount") root.innerHTML = '<p class="t-display"><bdi class="ui-num">₪12,345,678.90</bdi></p>';
    </script>`, {
    email: { type: "story", id: "email", title: "Email", name: "Email" },
    mixed: { type: "story", id: "mixed", title: "Mixed", name: "Mixed" },
    amount: { type: "story", id: "amount", title: "Amount", name: "Amount" },
  });
  try {
    expect(await execute({ staticDir: dir, widths: [320], themes: ["light"], reportDir: dir })).toBe(1);
    const report = JSON.parse(readFileSync(join(dir, "clip-report.json"), "utf8")) as {
      failures: string[];
      views: { storyId: string; elements: { className: string }[] }[];
    };
    expect(report.failures.some((line) => line.includes("email"))).toBe(true);
    expect(report.failures.some((line) => line.includes("mixed"))).toBe(true);
    expect(report.failures.some((line) => line.includes("amount"))).toBe(true);
    expect(report.views.find((view) => view.storyId === "email")?.elements.map((element) => element.className)).toEqual(["ui-row-hint"]);
    expect(report.views.find((view) => view.storyId === "mixed")?.elements.map((element) => element.className)).toEqual(["mixed"]);
    expect(report.views.find((view) => view.storyId === "amount")?.elements.map((element) => element.className)).toEqual(["t-display"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a passing run mentions skipped stories", async () => {
  const dir = staticSite(`<div id="storybook-root"><p class="t-hint">שלום</p></div>
    <script>
      const id = new URLSearchParams(location.search).get("id");
      if (id === "quiet") {
        const root = document.getElementById("storybook-root");
        if (root) root.innerHTML = "<div class='box'></div>";
      }
    </script>`, {
    fit: { type: "story", id: "fit", title: "Fit", name: "Fit" },
    quiet: { type: "story", id: "quiet", title: "Quiet", name: "Quiet", tags: ["clip-no-text"] },
  });
  const lines: string[] = [];
  try {
    expect(await execute({
      staticDir: dir,
      widths: [320],
      themes: ["light"],
      reportDir: dir,
      log: (line) => { lines.push(line); },
    })).toBe(0);
    expect(lines.join("\n")).toContain("2 stories, 1 skipped,");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a story that never renders exits 2", async () => {
  const dir = staticSite(`<div id="storybook-root"></div>`);
  try {
    expect(await execute({
      staticDir: dir,
      widths: [320],
      themes: ["light"],
      reportDir: dir,
      readyTimeout: 400,
    })).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
