import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BudgetCard, budgetUsedPercent } from "./budget-card";

describe("BudgetCard (FLOW-445)", () => {
  it("floors the used percent and keeps an overrun as the real percent", () => {
    expect(budgetUsedPercent(12_345_678_900n, 12_346_678_900n)).toBe(99);
    expect(budgetUsedPercent(10_000_000n, 10_000_000n)).toBe(100);
    expect(budgetUsedPercent(12_000_000n, 10_000_000n)).toBe(120);
    expect(budgetUsedPercent(5n, 0n)).toBe(0);
  });

  it("says what is left, with the used percent, under the budget", () => {
    const { container } = render(<BudgetCard spentMinor={4_000_000n} budgetMinor={10_000_000n} />);
    expect(screen.getByRole("heading", { name: "תקציב" })).toBeInTheDocument();
    expect(container.querySelector(".ui-budget-card")?.textContent).toContain("נשארו");
    expect(container.querySelector(".ui-budget-card")?.textContent).toContain("40%");
    expect(container.querySelector(".ui-budget-note-over")).toBeNull();
  });

  it("names the overrun in words and fills the bar in the signal colour when over", () => {
    const { container } = render(<BudgetCard spentMinor={12_000_000n} budgetMinor={10_000_000n} />);
    expect(container.querySelector(".ui-budget-note-over")?.textContent).toContain("חריגה");
    expect(container.querySelector(".ui-budget-fill-over")).not.toBeNull();
  });

  it("opens the project sheet from עריכה when it has an edit handler", () => {
    const onEdit = vi.fn();
    render(<BudgetCard spentMinor={0n} budgetMinor={10_000_000n} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "עריכה" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
