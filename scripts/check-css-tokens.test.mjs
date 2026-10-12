import assert from "node:assert/strict";
import test from "node:test";
import { compareCounts, countRules, findViolations } from "./check-css-tokens.mjs";

const rulesOf = (css) => findViolations(css).map((violation) => violation.rule);

test("a raw hex colour in a declaration fails the colour rule", () => {
  assert.deepEqual(rulesOf(".a { color: #1D1728; }"), ["color"]);
  assert.deepEqual(rulesOf(".a { background: rgba(0, 0, 0, 0.5); }"), ["color"]);
});

test("a raw font-size in px fails the font-size rule", () => {
  assert.deepEqual(rulesOf(".a { font-size: 14px; }"), ["font-size"]);
});

test("a raw transition duration fails the duration rule", () => {
  assert.deepEqual(rulesOf(".a { transition: opacity 200ms; }"), ["duration"]);
});

test("token values pass every rule", () => {
  const css = [
    ".a {",
    "  color: var(--color-text);",
    "  background: transparent;",
    "  font-size: var(--type-body-size);",
    "  line-height: var(--type-body-line);",
    "  font-weight: var(--type-body-weight);",
    "  transition: opacity var(--motion-press) var(--ease-standard);",
    "  border-radius: var(--radius-card);",
    "  padding: var(--space-3) var(--space-side) 0;",
    "  margin-inline: 1px;",
    "}",
  ].join("\n");
  assert.deepEqual(findViolations(css), []);
});

test("a numeric font-weight and a raw cubic-bezier fail", () => {
  assert.deepEqual(rulesOf(".a { font-weight: 600; }"), ["font-weight"]);
  assert.deepEqual(rulesOf(".a { transition: none cubic-bezier(0.2, 0, 0, 1); }"), ["easing"]);
});

test("a raw radius or spacing value fails its rule, and 0 and 50% pass", () => {
  assert.deepEqual(rulesOf(".a { border-radius: 14px; }"), ["radius"]);
  assert.deepEqual(rulesOf(".a { border-radius: 50%; }"), []);
  assert.deepEqual(rulesOf(".a { padding-inline: 16px; }"), ["spacing"]);
  assert.deepEqual(rulesOf(".a { inset-inline: -1px 0; }"), []);
});

test("comments are ignored", () => {
  assert.deepEqual(findViolations("/* color: #fff; font-size: 14px; */ .a { color: var(--color-text); }"), []);
  assert.deepEqual(rulesOf(".a { /* was 14px */ color: var(--color-text); }"), []);
});

test("a custom property definition is a token, not a raw value", () => {
  assert.deepEqual(findViolations(":root { --my-token: #1D1728; --my-size: 14px; }"), []);
});

test("violations carry the line they are on", () => {
  const [violation] = findViolations(".a {\n  color: var(--color-text);\n  font-size: 14px;\n}");
  assert.equal(violation.line, 3);
  assert.equal(violation.value, "14px");
});

test("countRules counts each rule once per violation", () => {
  assert.deepEqual(countRules(findViolations(".a { color: #fff; color: #000; font-size: 9px; }")), {
    color: 2,
    "font-size": 1,
  });
});

test("a count above the baseline fails and names the file and rule", () => {
  const result = compareCounts({ "app/src/a.css": { color: 3 } }, { "app/src/a.css": { color: 2 } });
  assert.deepEqual(result.above, [{ file: "app/src/a.css", rule: "color", count: 3, baseline: 2 }]);
  assert.deepEqual(result.below, []);
});

test("a count below the baseline asks to lower the baseline", () => {
  const result = compareCounts({ "app/src/a.css": { color: 1 } }, { "app/src/a.css": { color: 2 } });
  assert.deepEqual(result.above, []);
  assert.deepEqual(result.below, [{ file: "app/src/a.css", rule: "color", count: 1, baseline: 2 }]);
});

test("a file or rule missing from the baseline counts as 0", () => {
  const result = compareCounts({ "app/src/new.css": { radius: 1 } }, {});
  assert.deepEqual(result.above, [{ file: "app/src/new.css", rule: "radius", count: 1, baseline: 0 }]);
});
