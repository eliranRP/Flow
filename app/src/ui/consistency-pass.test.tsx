import { describe, expect, it } from "vitest";

/** The declared value of a property on an exact selector, from the loaded ui.css. jsdom leaves vars unresolved. */
function declared(selector: string, property: string): string {
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (!(rule instanceof CSSStyleRule)) continue;
      if (!rule.selectorText.split(",").some((part) => part.trim() === selector)) continue;
      const value = rule.style.getPropertyValue(property);
      if (value) return value.trim();
    }
  }
  return "";
}

describe("mobile UI consistency pass (FLOW-328)", () => {
  it("gives Split the 24px gutter, a start-side amount, and no hairlines between choices", () => {
    expect(declared(".ui-split .ui-page", "padding-inline")).toBe("var(--space-side)");
    expect(declared(".ui-split-amount", "padding-inline")).toBe("var(--space-side)");
    expect(declared(".ui-split-amount", "text-align")).not.toBe("center");
    expect(declared(".ui-split-question", "padding-inline")).toBe("var(--space-side)");
    expect(declared(".ui-split-card", "margin")).toContain("var(--space-side)");
    for (const row of [".ui-split-card .ui-radio-row", ".ui-split-card .ui-check-row", ".ui-split-card .ui-split-manual"]) {
      expect(declared(row, "border-bottom")).toMatch(/^(0|0px|none)/);
      // The card's surface shows in dark, so the choices keep their inset from its edge.
      expect(declared(row, "padding-inline")).toBe("var(--space-4)");
    }
  });

  it("keeps the turning save spinner inside the line split total", () => {
    expect(declared(".ui-lsplit-total .ui-spinner", "margin-inline")).toBe("var(--space-1) var(--space-2)");
  });

  it("draws the install steps with no hairlines and the number centred on its text", () => {
    expect(declared(".ui-install-step + .ui-install-step", "border-top")).toBe("");
    expect(declared(".ui-install-step", "align-items")).toBe("center");
    expect(declared(".ui-install-num", "margin-top")).toBe("");
  });

  it("leaves 20px between the project band and the overhead switch", () => {
    expect(declared(".ui-project-overhead", "margin-top")).toBe("var(--space-5)");
  });

  it("gives empty and error state actions the standard 44px button shape", () => {
    expect(declared(".ui-empty-action .ui-btn-pill", "min-height")).toBe("var(--touch-min)");
    expect(declared(".ui-empty-action .ui-btn-pill", "border-radius")).toBe("var(--radius-button)");
    expect(declared(".ui-empty-action .ui-btn-pill", "height")).toBe("auto");
  });

  it("puts the מצב תצוגה tag on the start side at the gutter, clear of the band curve", () => {
    expect(declared(".ui-preview-banner", "inset-inline")).toBe("var(--space-side)");
    expect(declared(".ui-preview-banner", "text-align")).not.toBe("center");
  });
});
