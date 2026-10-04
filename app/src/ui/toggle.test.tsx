import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectTarget } from "./test-support";
import { Toggle } from "./toggle";

describe("Toggle", () => {
  it("is a 44px switch and shows not-allowed when disabled", () => {
    render(<Toggle label="סיכום שבועי" checked={false} disabled onChange={() => undefined} />);
    const control = screen.getByRole("switch", { name: "סיכום שבועי" });
    expect(control).toBeDisabled();
    const row = control.closest("label");
    expect(row).toBeInstanceOf(HTMLElement);
    if (!(row instanceof HTMLElement)) return;
    expectTarget(row);
    expect(getComputedStyle(row).cursor).toBe("not-allowed");
    expect(getComputedStyle(row).opacity).toBe("1");
  });

  it("keeps a disabled on-track muted and readable", () => {
    const sheet = [...document.styleSheets].find((item) => {
      try {
        return [...item.cssRules].some((rule) => rule instanceof CSSStyleRule && rule.selectorText.includes("ui-switch"));
      } catch {
        return false;
      }
    });
    expect(sheet).toBeDefined();
    const rules = [...(sheet?.cssRules ?? [])].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
    const faded = rules.find((rule) => rule.selectorText.includes("ui-switch-row") && rule.selectorText.includes(":disabled") && rule.style.opacity === "0.45");
    expect(faded).toBeUndefined();
    const onTrack = rules.find((rule) => rule.selectorText.includes("disabled") && rule.selectorText.includes(":checked") && rule.selectorText.includes("ui-switch"));
    expect(onTrack?.style.background).toContain("--color-disabled-text");
  });
});
