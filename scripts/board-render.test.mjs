import assert from "node:assert/strict";
import test from "node:test";
import {
  contentType,
  frameOf,
  isLightBoard,
  parseArgs,
  pngFileName,
  resolveRequest,
  selectBoards,
} from "./board-render.mjs";

test("parses the project, the runtime and the output folder", () => {
  assert.deepEqual(parseArgs(["--project", "p", "--runtime", "r.js", "--out", "o"]), { project: "p", runtime: "r.js", out: "o" });
});

test("refuses a missing value, a missing option, an unknown option and a positional argument", () => {
  assert.throws(() => parseArgs(["--project", "--runtime", "r", "--out", "o"]), /--project needs a value/);
  assert.throws(() => parseArgs(["--runtime", "r", "--out", "o"]), /--project is required/);
  assert.throws(() => parseArgs(["--project", "p", "--out", "o"]), /--runtime is required/);
  assert.throws(() => parseArgs(["--project", "p", "--runtime", "r"]), /--out is required/);
  assert.throws(() => parseArgs(["--project", "p", "--runtime", "r", "--out", "o", "--width", "1"]), /unknown option --width/);
  assert.throws(() => parseArgs(["--project", "p", "--runtime", "r", "--out", "o", "extra"]), /unexpected argument extra/);
});

test("selects the ready and light artboards, sorted, and drops the other pages", () => {
  const canvas = {
    pages: [{ id: "guide" }, { id: "ready" }, { id: "light" }],
    boards: {
      "A.dc.html": { page: "ready" },
      "ALight.dc.html": { page: "light" },
      "B.dc.html": { page: "explore" },
      "C.dc.html": { page: "guide" },
      "D.dc.html": {},
    },
  };
  assert.deepEqual(
    selectBoards(canvas).map((board) => board.name),
    ["A", "ALight"],
  );
  assert.deepEqual(selectBoards(canvas)[1], { name: "ALight", file: "ALight.dc.html", page: "light" });
});

test("a board with no page takes the canvas's first page", () => {
  const canvas = { pages: [{ id: "ready" }], boards: { "D.dc.html": {} } };
  assert.deepEqual(selectBoards(canvas), [{ name: "D", file: "D.dc.html", page: "ready" }]);
});

test("refuses a canvas with no boards", () => {
  assert.throws(() => selectBoards({ pages: [{ id: "ready" }] }), /canvas.json has no boards/);
});

test("names the PNG and finds the frame and the theme of a board", () => {
  assert.equal(pngFileName("Flow"), "Flow.png");
  assert.equal(pngFileName("FlowLight"), "FlowLight.png");
  assert.equal(frameOf("FlowLight"), "Flow");
  assert.equal(frameOf("Flow"), "Flow");
  // A bare "Light" has nothing before it, so it is a frame of its own.
  assert.equal(frameOf("Light"), "Light");
  assert.equal(isLightBoard({ page: "light" }), true);
  assert.equal(isLightBoard({ page: "ready" }), false);
});

test("serves the runtime at /support.js and project files inside the project only", () => {
  const project = "/work/project";
  const runtime = "/work/dc-runtime.js";
  assert.equal(resolveRequest("/support.js", project, runtime), runtime);
  assert.equal(resolveRequest("/A.dc.html", project, runtime), "/work/project/A.dc.html");
  assert.equal(resolveRequest("/sub/a%20b.css", project, runtime), "/work/project/sub/a b.css");
  assert.equal(resolveRequest("/../etc/passwd", project, runtime), null);
  assert.equal(resolveRequest("/%2e%2e/etc/passwd", project, runtime), null);
  assert.equal(resolveRequest("/", project, runtime), null);
  assert.equal(resolveRequest("/%E0%A4%A", project, runtime), null);
});

test("names the content type by extension", () => {
  assert.equal(contentType("a.html"), "text/html; charset=utf-8");
  assert.equal(contentType("a.js"), "text/javascript");
  assert.equal(contentType("a.json"), "application/json");
  assert.equal(contentType("a.css"), "text/css");
  assert.equal(contentType("a.png"), "image/png");
  assert.equal(contentType("a.svg"), "image/svg+xml");
  assert.equal(contentType("a.woff2"), "font/woff2");
  assert.equal(contentType("a.woff"), "font/woff");
  assert.equal(contentType("a.bin"), "application/octet-stream");
});
