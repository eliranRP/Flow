import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DatePicker } from "./date-picker";
import { monthCells } from "./date-math";
import { expectRtl, expectTarget } from "./test-support";

describe("DatePicker", () => {
  it("starts the week on Sunday and disables future days", () => {
    expectRtl();
    expect(monthCells(2026, 8)[0]).toBe("2026-08-30");
    render(<DatePicker label="תאריך ההוצאה" value="2026-09-21" onChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /תאריך ההוצאה/ }));
    expect(screen.getByRole("grid", { name: "תאריך ההוצאה" })).toBeInTheDocument();
    expect(screen.getAllByText("א׳").length).toBeGreaterThan(0);
    const day = screen.getByRole("gridcell", { name: /21 בספטמבר 2026/ });
    expectTarget(day);
    expect(day).toHaveAttribute("aria-selected", "true");
  });
});
