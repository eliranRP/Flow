import assert from "node:assert/strict";
import test from "node:test";
import { cssClasses, unusedClasses } from "./check-unused-css.mjs";

test("reads the classes of selectors, not of comments or declarations", () => {
  const css = "/* .ui-old */\n.ui-row, .ui-list > .ui-row-title:hover { background: url(a.b.png); }\n@media (max-width: 360px) { .ui-row-hint { opacity: .5; } }";
  assert.deepEqual(cssClasses(css).sort(), ["ui-list", "ui-row", "ui-row-hint", "ui-row-title"]);
});

test("a class is used when code names it, builds it from a template prefix, or a library sets it", () => {
  const source = 'className="ui-row"\nconst a = `ui-app-icon ui-app-icon-${size}`;\nexpect(el).toHaveClass("ui-row-hint")';
  assert.deepEqual(
    unusedClasses(["ui-row", "ui-row-hint", "ui-row-title", "ui-app-icon", "ui-app-icon-tile", "vaul-dragging"], source),
    ["ui-row-title"],
  );
});
