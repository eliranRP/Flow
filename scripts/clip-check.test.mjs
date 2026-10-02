import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isClipped, reportsClip, TEXT_SELECTOR, THEMES, WIDTHS } from "./clip-check.mjs";

test("a text element is clipped only when scrollWidth exceeds clientWidth by more than 1px", () => {
  assert.equal(isClipped(100, 100), false);
  assert.equal(isClipped(101, 100), false);
  assert.equal(isClipped(102, 100), true);
});

test("single-line ellipsis is the designed truncation, and a wrapping line is still a clip", () => {
  assert.equal(reportsClip({
    scrollWidth: 200,
    clientWidth: 100,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    overflow: "hidden",
  }), false);
  assert.equal(reportsClip({
    scrollWidth: 200,
    clientWidth: 100,
    textOverflow: "clip",
    whiteSpace: "normal",
    overflow: "visible",
  }), true);
});

test("the clip check covers 320, 360, and 390 in light and dark", () => {
  assert.deepEqual(WIDTHS, [320, 360, 390]);
  assert.deepEqual(THEMES, ["light", "dark"]);
  assert.match(TEXT_SELECTOR, /\.ui-row-hint/);
  assert.doesNotMatch(TEXT_SELECTOR, /button/);
});

test("pnpm clip-check runs the script", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts["clip-check"], /clip-check/);
});
