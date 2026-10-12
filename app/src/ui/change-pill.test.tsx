import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChangePill, formatChange } from "./change-pill";

function pillOf(container: HTMLElement): HTMLElement {
  const pill = container.querySelector(".ui-change");
  if (!(pill instanceof HTMLElement)) throw new Error("no change pill");
  return pill;
}

describe("ChangePill", () => {
  it("shows a neutral 0% when the change is exactly zero", () => {
    expect(formatChange(0)).toEqual({ text: "0%", tone: "flat" });
    render(<ChangePill percent={0} comparison="מחודש שעבר" />);
    expect(screen.getByLabelText("0% מחודש שעבר")).toHaveTextContent("0%");
    expect(screen.getByLabelText("0% מחודש שעבר")).not.toHaveTextContent("▲");
  });

  it("keeps the direction when the exact change rounds to zero", () => {
    expect(formatChange(0.2)).toEqual({ text: "<1%", tone: "up" });
    expect(formatChange(-0.4)).toEqual({ text: "<1%", tone: "down" });
    render(<ChangePill percent={-0.4} comparison="מחודש שעבר" />);
    expect(screen.getByLabelText("ירידה של <1% מחודש שעבר")).toHaveTextContent("▼ <1%");
  });

  it("rounds a real change to a whole percent", () => {
    expect(formatChange(12.6)).toEqual({ text: "13%", tone: "up" });
    expect(formatChange(-10)).toEqual({ text: "10%", tone: "down" });
  });

  it("marks a rise as helping, a fall as hurting, and a flat change as neutral", () => {
    const up = render(<ChangePill percent={12} comparison="מחודש שעבר" />);
    expect(pillOf(up.container)).toHaveClass("ui-delta-good");
    expect(pillOf(up.container)).not.toHaveClass("ui-change-band");
    up.unmount();
    const down = render(<ChangePill percent={-10} comparison="מחודש שעבר" />);
    expect(pillOf(down.container)).toHaveClass("ui-delta-bad");
    down.unmount();
    const flat = render(<ChangePill percent={0} comparison="מחודש שעבר" />);
    expect(pillOf(flat.container)).toHaveClass("ui-delta-flat");
  });

  it("adds the band class on the band", () => {
    const { container } = render(<ChangePill percent={-10} comparison="מחודש שעבר" onBand />);
    expect(pillOf(container)).toHaveClass("ui-change", "ui-change-band", "ui-delta-bad");
  });

  it("swaps the tones when an increase hurts, as for an expense", () => {
    const up = render(<ChangePill percent={12} comparison="מחודש שעבר" upHurts />);
    expect(pillOf(up.container)).toHaveClass("ui-delta-bad");
    expect(pillOf(up.container)).not.toHaveClass("ui-delta-good");
    up.unmount();
    const down = render(<ChangePill percent={-10} comparison="מחודש שעבר" upHurts />);
    expect(pillOf(down.container)).toHaveClass("ui-delta-good");
  });
});
