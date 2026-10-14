import assert from "node:assert/strict";
import test from "node:test";
import { compareCounts, countRules, findViolations, stripTokenBlocks } from "./check-css-tokens.mjs";

const rulesOf = (css) => findViolations(css).map((violation) => violation.rule);

test("a raw hex colour in a declaration fails the colour rule", () => {
  assert.deepEqual(rulesOf(".a { color: #1D1728; }"), ["color"]);
  assert.deepEqual(rulesOf(".a { background: rgba(0, 0, 0, 0.5); }"), ["color"]);
  assert.deepEqual(rulesOf(".a { border-color: hsl(270 50% 40%); }"), ["color"]);
});

test("a named colour fails; transparent, currentColor and a token name do not", () => {
  assert.deepEqual(rulesOf(".a { color: white; }"), ["color"]);
  assert.deepEqual(rulesOf(".a { border: 1px solid Red; }"), ["color"]);
  assert.deepEqual(rulesOf(".a { color: currentColor; background: transparent; outline-color: inherit; }"), []);
  assert.deepEqual(rulesOf(".a { color: var(--color-on-band); fill: var(--white); animation-name: red; }"), []);
});

test("a raw line-height and a raw *-duration fail", () => {
  assert.deepEqual(rulesOf(".a { line-height: 1.4; }"), ["line-height"]);
  assert.deepEqual(rulesOf(".a { animation-duration: 300ms; }"), ["duration"]);
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

test("zero lengths and zero durations are not raw values; .5s and 1.5px are", () => {
  assert.deepEqual(rulesOf(".a { padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom, 0px)); }"), []);
  assert.deepEqual(rulesOf(".a { transition: visibility 0s linear var(--motion-fast); }"), []);
  assert.deepEqual(rulesOf(".a { transition: opacity .5s; }"), ["duration"]);
  assert.deepEqual(rulesOf(".a { margin-top: 1.5px; }"), ["spacing"]);
});

test("comments are ignored", () => {
  assert.deepEqual(findViolations("/* color: #fff; font-size: 14px; */ .a { color: var(--color-text); }"), []);
  assert.deepEqual(rulesOf(".a { /* was 14px */ color: var(--color-text); }"), []);
});

test("a custom property definition is a token, not a raw value", () => {
  assert.deepEqual(findViolations(":root { --my-token: #1D1728; --my-size: 14px; }"), []);
});

test("in app.css only the :root and @theme blocks are skipped", () => {
  const css = ":root {\n  --a: 1px;\n}\n@theme inline {\n  --text-x: 14px;\n}\nbody {\n  font-weight: 500;\n}\n";
  const violations = findViolations(stripTokenBlocks(css));
  assert.deepEqual(violations.map((violation) => [violation.rule, violation.line]), [["font-weight", 8]]);
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
