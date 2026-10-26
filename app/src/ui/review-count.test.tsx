import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReviewSegments } from "./review-count";

describe("ReviewSegments (FLOW-960)", () => {
  it("draws one segment per item up to 12, with its value for screen readers", () => {
    const { container } = render(<ReviewSegments index={3} total={12} />);
    expect(container.querySelectorAll(".ui-review-seg")).toHaveLength(12);
    expect(screen.getByRole("meter", { name: "התקדמות התור" })).toHaveAttribute("aria-valuenow", "3");
  });

  it("turns into one bar above 12 items, filled with the items done", () => {
    const { container } = render(<ReviewSegments index={29} total={40} />);
    expect(container.querySelectorAll(".ui-review-seg")).toHaveLength(0);
    const meter = screen.getByRole("meter", { name: "התקדמות התור" });
    expect(meter).toHaveClass("ui-review-segments-bar");
    expect(meter).toHaveAttribute("aria-valuemax", "40");
    expect(container.querySelector<HTMLElement>(".ui-review-bar-fill")?.style.inlineSize).toBe("70%");
  });
});
