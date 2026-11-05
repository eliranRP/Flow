import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./segmented-control";
import { expectRtl, expectTarget, expectThemePaint } from "./test-support";

describe("SegmentedControl", () => {
  it("presses one segment and paints it in both themes", () => {
    expectRtl();
    render(
      <SegmentedControl
        label="תצוגה"
        value="expenses"
        onChange={() => undefined}
        options={[
          { value: "expenses", label: "הוצאות" },
          { value: "income", label: "הכנסות" },
        ]}
      />,
    );
    const selected = screen.getByRole("radio", { name: "הוצאות" });
    expect(selected).toHaveAttribute("aria-checked", "true");
    expectTarget(selected);
    expectThemePaint(selected, "backgroundColor");
  });

  it("keeps one tab stop when no segment is selected (a custom period)", () => {
    render(
      <SegmentedControl<string>
        label="תקופה"
        value="custom"
        onChange={() => undefined}
        options={[
          { value: "month", label: "חודש" },
          { value: "year", label: "שנה" },
        ]}
      />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "false"]);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1]);
  });

  it("ignores taps and arrow keys while busy, but keeps the segment enabled and focused (#231)", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="סף"
        value="a"
        busy
        onChange={onChange}
        options={[{ value: "a", label: "80%", numeric: true }, { value: "b", label: "90%", numeric: true }]}
      />,
    );
    const group = screen.getByRole("radiogroup", { name: "סף" });
    expect(group).toHaveAttribute("aria-busy", "true");
    const first = screen.getByRole("radio", { name: "80%" });
    first.focus();
    fireEvent.click(screen.getByRole("radio", { name: "90%" }));
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(onChange).not.toHaveBeenCalled();
    expect(first).toBeEnabled();
    expect(document.activeElement).toBe(first);
  });

  it("draws a numeric label in an LTR bdi and keeps it as the name", () => {
    render(<SegmentedControl label="סף" value="a" onChange={() => undefined} options={[{ value: "a", label: "90%", numeric: true }]} />);
    const radio = screen.getByRole("radio", { name: "90%" });
    expect(radio.querySelector("bdi[dir='ltr']")?.textContent).toBe("90%");
  });
});

describe("SegmentedControl's sliding indicator (FLOW-1043)", () => {
  // jsdom lays nothing out: each option is 100px wide and 40px tall, side by side, 4px from the track's edge.
  function layOut() {
    const at = (node: HTMLElement) => [...(node.parentElement?.querySelectorAll(".ui-seg-btn") ?? [])].indexOf(node);
    const button = (node: HTMLElement) => node.classList.contains("ui-seg-btn");
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return button(this) ? 100 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return button(this) ? 40 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
      return button(this) ? 4 + at(this) * 104 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      return button(this) ? 4 : 0;
    });
  }

  function Demo({ initial = "all" }: { initial?: string }) {
    const [value, setValue] = useState(initial);
    return (
      <SegmentedControl
        label="סינון תנועות"
        value={value}
        onChange={setValue}
        options={[
          { value: "all", label: "הכול" },
          { value: "fixed", label: "קבועים" },
          { value: "left", label: "נותר לשלם" },
        ]}
      />
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws one aria-hidden indicator on the selected option and moves it on a pick", () => {
    layOut();
    const { container } = render(<Demo />);
    const indicators = container.querySelectorAll(".ui-seg-ind");
    expect(indicators).toHaveLength(1);
    const indicator = indicators[0] as HTMLElement;
    expect(indicator).toHaveAttribute("aria-hidden", "true");
    expect(indicator.style.transform).toBe("translate(4px, 4px)");
    expect(indicator.style.inlineSize).toBe("100px");
    fireEvent.click(screen.getByRole("radio", { name: "נותר לשלם" }));
    expect(container.querySelector(".ui-seg-ind")).toBe(indicator);
    expect(indicator.style.transform).toBe("translate(212px, 4px)");
    // The roles and the checked state are the options' own, as before.
    expect(screen.getByRole("radio", { name: "נותר לשלם" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("draws no indicator while nothing is selected, or before layout", () => {
    const { container, rerender } = render(<Demo />);
    expect(container.querySelector(".ui-seg-ind")).toBeNull();
    layOut();
    rerender(<Demo initial="custom" />);
    expect(container.querySelector(".ui-seg-ind")).toBeNull();
  });
});
