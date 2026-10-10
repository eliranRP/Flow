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

  it("keeps a slot where there is no month to open", () => {
    const { container } = render(<MonthStepper earlier="תזרים ספטמבר" later={null} onStep={() => undefined} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(container.querySelectorAll(".ui-month-step-slot")).toHaveLength(1);
  });
});
