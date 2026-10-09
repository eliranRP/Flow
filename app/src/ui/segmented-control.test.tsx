import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { describe, expect, it } from "vitest";
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
