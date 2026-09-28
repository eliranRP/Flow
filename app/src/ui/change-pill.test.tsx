import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChangePill, formatChange } from "./change-pill";

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
});
