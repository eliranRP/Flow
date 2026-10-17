import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// FLOW-919: the form's sheet edge and head rule are scoped to the form (the shared sheet keeps its defaults).
const css = readFileSync(path.resolve(__dirname, "../ui/css/44-add-entry.css"), "utf8");

describe("add form sheet edge (FLOW-919)", () => {
  it("sets the form panel's top edge to 54px, with the keyboard rule kept", () => {
    expect(css).toMatch(/\.ui-add-entry \{\s*--sheet-gap: 54px;/);
    expect(css).toMatch(/:root\[data-kb="open"\] \.ui-add-entry/);
  });

  it("draws the form head's rule in the hairline colour", () => {
    expect(css).toMatch(/\.ui-add-entry \.ui-sheet-head \{[^}]*border-block-end: 1px solid var\(--color-line\)/);
  });
});
