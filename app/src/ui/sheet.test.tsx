import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sheet, SheetSurface } from "./sheet";
import { expectRtl, expectTarget } from "./test-support";

describe("Sheet", () => {
  it("opens a dialog with a 44px close control", () => {
    expectRtl();
    render(
      <Sheet open onOpenChange={() => undefined} title="תקופה">
        <p>תוכן</p>
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: "תקופה" })).toBeInTheDocument();
    expectTarget(screen.getByRole("button", { name: "סגירה" }));
    render(
      <SheetSurface title="תצוגה">
        <p>פאנל</p>
      </SheetSurface>,
    );
    expect(screen.getByRole("heading", { name: "תצוגה" })).toBeInTheDocument();
    expect(document.querySelector("[title]")).toBeNull();
  });

  it("draws no outline on an opened sheet panel", () => {
    render(
      <Sheet open onOpenChange={() => undefined} title="תקופה">
        <button type="button">בפנים</button>
      </Sheet>,
    );
    const panel = screen.getByRole("dialog", { name: "תקופה" });
    expect(panel).toHaveClass("ui-sheet-panel");
    panel.focus();
    expect(getComputedStyle(panel).outlineStyle).toBe("none");
    expect(sheetFocusRule()).toBe("none");
    expect(screen.getByRole("button", { name: "בפנים" })).toBeInTheDocument();
  });
});

function sheetFocusRule(): string {
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (!(rule instanceof CSSStyleRule)) continue;
      if (rule.selectorText.includes(".ui-sheet-panel:focus-visible")) return rule.style.outline;
    }
  }
  return "";
}
