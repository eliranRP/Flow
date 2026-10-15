import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProgressBar, budgetUsedPercent } from "./progress-bar";
import { expectRtl, expectThemePaint } from "./test-support";

describe("ProgressBar", () => {
  it("shows a value bar whose fill grows in on first render", () => {
    expectRtl();
    render(<ProgressBar value={40} label="התקדמות" />);
    expect(screen.getByRole("meter", { name: "התקדמות" })).toHaveAttribute("aria-valuenow", "40");
    const fill = document.querySelector(".ui-bar-fill");
    expect(document.querySelector(".ui-bar-grow")).toHaveClass("m-bar-grow");
    if (fill instanceof HTMLElement) expectThemePaint(fill, "backgroundColor");
  });

  it("gives the thin variant the same grown fill, with its caption beside it", () => {
    render(<ProgressBar variant="thin" value={1} max={7} label="התקדמות התור" caption="1 מתוך 7" />);
    expect(document.querySelector(".ui-meter-row .ui-bar")).not.toBeNull();
    expect(document.querySelector(".ui-bar-grow")).toHaveClass("m-bar-grow");
    expect(screen.getByText("1 מתוך 7")).toBeInTheDocument();
  });

  it("draws a split bar and names an overrun in words", () => {
    render(<ProgressBar variant="split" label="חריגה" spentAgorot={12000000n} budgetAgorot={10000000n} />);
    expect(screen.getByRole("meter", { name: "חריגה, מעל התקציב" })).toBeInTheDocument();
    expect(document.body.textContent.replace(/\s+/g, " ")).toMatch(/נוצלו 120%/);
    expect(screen.getByText(/מעל התקציב/)).toBeInTheDocument();
    const over = document.querySelector('.ui-bar-fill[data-over="true"]');
    expect(over).toBeInstanceOf(HTMLElement);
    if (over instanceof HTMLElement) expect(over.style.transform).toBe("scaleX(1)");
    expect(over?.parentElement).toHaveClass("m-bar-grow");
  });

  it("floors a partial budget and keeps an overrun as the real percent", () => {
    expect(budgetUsedPercent(12_345_678_900n, 12_346_678_900n)).toBe(99);
    expect(budgetUsedPercent(10_000_000n, 10_000_000n)).toBe(100);
    expect(budgetUsedPercent(12_000_000n, 10_000_000n)).toBe(120);
    render(<ProgressBar variant="split" label="כמעט" spentAgorot={12_345_678_900n} budgetAgorot={12_346_678_900n} />);
    const text = document.body.textContent.replace(/\s+/g, " ");
    expect(text).toMatch(/נוצלו 99%/);
    expect(text).not.toMatch(/נוצלו 100%/);
    const fill = document.querySelector(".ui-bar-fill");
    if (fill instanceof HTMLElement) expect(fill.style.transform).toBe("scaleX(0.99)");
    expect(document.querySelector(".ui-overage")).toBeNull();
  });

  it("draws a job: a count, the steps in order, and a way to leave that does not stop the job", () => {
    const onLeave = vi.fn();
    render(
      <ProgressBar
        variant="job"
        label="התקדמות הסנכרון הראשון"
        value={120}
        max={340}
        count="120 מתוך כ־340 תנועות"
        steps={[
          { label: "משיכת תנועות", state: "done" },
          { label: "התאמה לפרויקטים", state: "doing" },
          { label: "בדיקת כפילויות", state: "todo" },
        ]}
        onLeave={onLeave}
      />,
    );
    expect(screen.getByRole("meter", { name: "התקדמות הסנכרון הראשון" })).toHaveAttribute("aria-valuenow", "35");
    expect(screen.getByText("120 מתוך כ־340 תנועות")).toBeInTheDocument();
    const steps = screen.getAllByRole("listitem");
    expect(steps.map((step) => step.getAttribute("data-state"))).toEqual(["done", "doing", "todo"]);
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    expect(document.querySelector(".ui-job-bar")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "המשך ברקע" }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});
