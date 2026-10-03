import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sheet, SheetSurface } from "./sheet";
import { expectRtl, expectTarget } from "./test-support";

describe("Sheet", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("notifies a close once, and the panel is inert while it closes", async () => {
    vi.useFakeTimers();
    let closed = 0;
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <Sheet open={open} onOpenChange={setOpen} onClosed={() => { closed += 1; }} title="תקופה">
          <p>תוכן</p>
        </Sheet>
      );
    }
    render(<Harness />);
    const panel = screen.getByRole("dialog", { name: "תקופה" });
    expect(panel).not.toHaveAttribute("inert");
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const sliding = screen.queryByRole("dialog", { name: "תקופה" });
    if (sliding) expect(sliding).toHaveAttribute("inert");
    expect(closed).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(220); });
    expect(closed).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(closed).toBe(1);
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
