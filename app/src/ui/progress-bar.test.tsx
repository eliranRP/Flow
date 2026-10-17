import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProgressBar } from "./progress-bar";
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

  it("draws seven segments: done before the current one, the rest after", () => {
    render(<ProgressBar variant="steps" count={7} current={3} label="התקדמות ההגדרה" />);
    const states = [...document.querySelectorAll(".ui-steps-seg")].map((seg) => seg.getAttribute("data-state"));
    expect(states).toEqual(["done", "done", "current", "next", "next", "next", "next"]);
    expect(screen.getByRole("meter", { name: "התקדמות ההגדרה" })).toHaveAttribute("aria-valuenow", "3");
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
    fireEvent.click(screen.getByRole("button", { name: "המשך לבית בינתיים" }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});
