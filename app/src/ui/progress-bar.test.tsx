import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BudgetBar, ProgressBar, budgetUsedPercent } from "./progress-bar";
import { expectRtl, expectThemePaint } from "./test-support";

describe("ProgressBar", () => {
  it("shows a budget bar and names an overrun in words", () => {
    expectRtl();
    render(
      <>
        <ProgressBar value={40} label="התקדמות" />
        <BudgetBar label="חריגה" spentAgorot={12000000n} budgetAgorot={10000000n} />
      </>,
    );
    expect(screen.getByRole("meter", { name: "התקדמות" })).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByRole("meter", { name: "חריגה, מעל התקציב" })).toBeInTheDocument();
    expect(screen.getByText(/נוצלו 120%/)).toBeInTheDocument();
    expect(screen.getByText(/מעל התקציב/)).toBeInTheDocument();
    const over = document.querySelector('.ui-bar-fill[data-over="true"]');
    expect(over).toBeInstanceOf(HTMLElement);
    if (over instanceof HTMLElement) expect(over.style.width).toBe("100%");
    const fill = document.querySelector(".ui-bar-fill");
    expect(fill).not.toBeNull();
    if (fill instanceof HTMLElement) expectThemePaint(fill, "backgroundColor");
  });

  it("floors a partial budget and keeps an overrun as the real percent", () => {
    expect(budgetUsedPercent(12_345_678_900n, 12_346_678_900n)).toBe(99);
    expect(budgetUsedPercent(10_000_000n, 10_000_000n)).toBe(100);
    expect(budgetUsedPercent(12_000_000n, 10_000_000n)).toBe(120);
    render(<BudgetBar label="כמעט" spentAgorot={12_345_678_900n} budgetAgorot={12_346_678_900n} />);
    expect(screen.getByText(/נוצלו 99%/)).toBeInTheDocument();
    expect(screen.queryByText(/נוצלו 100%/)).not.toBeInTheDocument();
    const fill = document.querySelector(".ui-bar-fill");
    if (fill instanceof HTMLElement) expect(fill.style.width).toBe("99%");
  });
});
