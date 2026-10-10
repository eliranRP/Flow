import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MonthStepper } from "./month-stepper";

describe("MonthStepper (FLOW-362)", () => {
  it("names each chevron by its month and steps earlier and later", () => {
    const onStep = vi.fn();
    render(<MonthStepper earlier="תזרים אוגוסט" later="תזרים אוקטובר" onStep={onStep} />);
    fireEvent.click(screen.getByRole("button", { name: "תזרים אוגוסט" }));
    fireEvent.click(screen.getByRole("button", { name: "תזרים אוקטובר" }));
    expect(onStep.mock.calls).toEqual([[-1], [1]]);
  });

  it("shows a disabled chevron where there is no month to open", () => {
    const onStep = vi.fn();
    render(<MonthStepper earlier="תזרים ספטמבר" later={null} onStep={onStep} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    const next = screen.getByRole("button", { name: "חודש הבא" });
    expect(next).toHaveAttribute("aria-disabled", "true");
    expect(next).toHaveAccessibleDescription("זה החודש הנוכחי");
    fireEvent.click(next);
    expect(onStep).not.toHaveBeenCalled();
  });
});
