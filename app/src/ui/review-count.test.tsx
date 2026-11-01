import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReviewCount, ReviewSegments, reviewCountDigits, reviewCountText } from "./review-count";

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

  it("writes a count over a thousand with a comma and reserves its width (FLOW-984)", () => {
    expect(reviewCountText(1287)).toBe("1,287");
    expect(reviewCountText(12)).toBe("12");
    const { container } = render(<ReviewCount value={12} digits={reviewCountDigits(1287)} side="index" />);
    expect(container.querySelector("bdi")?.textContent).toBe("12");
    expect(container.querySelector("bdi")).toHaveAttribute("data-reserve", "00000");
    const total = render(<ReviewCount value={1287} digits={reviewCountDigits(1287)} side="total" />);
    expect(total.container.querySelector("bdi")?.textContent).toBe("1,287");
  });
});
