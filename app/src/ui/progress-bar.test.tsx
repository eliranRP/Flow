import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BudgetBar, ProgressBar } from "./progress-bar";
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
    expect(screen.getByText(/מעל התקציב/)).toBeInTheDocument();
    const fill = document.querySelector(".ui-bar-fill");
    expect(fill).not.toBeNull();
    if (fill instanceof HTMLElement) expectThemePaint(fill, "backgroundColor");
  });
});
