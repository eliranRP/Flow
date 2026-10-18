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
  it("gives Split the 24px gutter", () => {
    expect(declared(".ui-split .ui-page", "padding-inline")).toBe("var(--space-side)");
  });

  it("draws the install steps with no hairlines and the number centred on its text", () => {
    expect(declared(".ui-install-step + .ui-install-step", "border-top")).toBe("");
    expect(declared(".ui-install-step", "align-items")).toBe("center");
    expect(declared(".ui-install-num", "margin-top")).toBe("");
  });

  it("gives empty and error state actions the standard 44px button shape", () => {
    expect(declared(".ui-empty-action .ui-btn-secondary", "min-height")).toBe("var(--touch-min)");
    expect(declared(".ui-empty-action .ui-btn-secondary", "height")).toBe("var(--touch-min)");
    expect(declared(".ui-btn.ui-btn-secondary", "border-radius")).toBe("var(--radius-button)");
  });

  it("puts the מצב תצוגה tag on the start side at the gutter, clear of the band curve", () => {
    expect(declared(".ui-preview-banner", "inset-inline")).toBe("var(--space-side)");
    expect(declared(".ui-preview-banner", "text-align")).not.toBe("center");
  });
});
