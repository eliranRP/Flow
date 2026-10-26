import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BudgetCard, BudgetEmptyCard, budgetUsedPercent } from "./budget-card";

describe("BudgetCard (FLOW-445, FLOW-961)", () => {
  it("floors the used percent and keeps an overrun as the real percent", () => {
    expect(budgetUsedPercent(12_345_678_900n, 12_346_678_900n)).toBe(99);
    expect(budgetUsedPercent(10_000_000n, 10_000_000n)).toBe(100);
    expect(budgetUsedPercent(12_000_000n, 10_000_000n)).toBe(120);
    expect(budgetUsedPercent(5n, 0n)).toBe(0);
    // 61,300 of 75,000 is 81.7%: nearest percent is 82.
    expect(budgetUsedPercent(6_130_000n, 7_500_000n)).toBe(82);
    // Just under the budget rounds to 100, but stops at 99 until the budget is reached.
    expect(budgetUsedPercent(9_999_000n, 10_000_000n)).toBe(99);
  });

  it("says what is left, with the used percent, under the budget", () => {
    const { container } = render(<BudgetCard spentMinor={4_000_000n} budgetMinor={10_000_000n} />);
    expect(screen.getByRole("heading", { name: "תקציב" })).toBeInTheDocument();
    expect(container.querySelector(".ui-budget-card")?.textContent).toContain("נשארו");
    expect(container.querySelector(".ui-budget-card")?.textContent).toContain("40%");
    expect(container.querySelector(".ui-budget-note-over")).toBeNull();
  });

  it("runs the bar past a tick when over, and names the overrun with its percent (FLOW-961)", () => {
    const { container } = render(<BudgetCard spentMinor={12_000_000n} budgetMinor={10_000_000n} currency="USD" />);
    expect(container.querySelector(".ui-budget-note-over")?.textContent).toBe("חריגה של $20,000 · 120% מהתקציב");
    expect(container.querySelector(".ui-budget-note-over svg")).not.toBeNull();
    const bar = screen.getByRole("img", { name: "נוצל $120,000 מתוך $100,000 · 120%" });
    expect(Array.from(bar.children).map((part) => part.className)).toEqual(["ui-budget-fill", "ui-budget-tick", "ui-budget-over"]);
    expect((bar.children[0] as HTMLElement).style.flexGrow).toBe("10000000");
    expect((bar.children[2] as HTMLElement).style.flexGrow).toBe("2000000");
  });

  it("outlines what is left under the budget", () => {
    render(<BudgetCard spentMinor={4_000_000n} budgetMinor={10_000_000n} currency="USD" />);
    const bar = screen.getByRole("img", { name: "נוצל $40,000 מתוך $100,000 · 40%" });
    expect(Array.from(bar.children).map((part) => part.className)).toEqual(["ui-budget-fill", "ui-budget-left"]);
  });

  it("asks for a budget on the empty card", () => {
    const onAdd = vi.fn();
    render(<BudgetEmptyCard onAdd={onAdd} />);
    expect(screen.getByRole("region", { name: "אין תקציב לפרויקט" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "הוספת תקציב" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("opens the project sheet from עריכה when it has an edit handler", () => {
    const onEdit = vi.fn();
    render(<BudgetCard spentMinor={0n} budgetMinor={10_000_000n} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "עריכה" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
