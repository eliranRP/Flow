import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "../ui/button";
import { OnboardingFrame } from "./shell";
import { SKIP_SHEET_CONFIRM, SKIP_ALL, SETUP_TOTAL } from "./copy";
import "./setup.css";

describe("onboarding frame (FLOW-514 §1)", () => {
  it("shows the counter, the seven segments and skip-all on a counted step", () => {
    render(
      <OnboardingFrame step={2} title="חיבור הבנק והספרים" onBack={() => undefined} onSkipAll={() => undefined} primary={<Button type="button">המשך</Button>} />,
    );
    const meter = screen.getByRole("meter", { name: "התקדמות ההגדרה" });
    expect(meter).toHaveAttribute("aria-valuenow", "2");
    expect(meter).toHaveAttribute("aria-valuemax", String(SETUP_TOTAL));
    expect(screen.getByText(/מתוך/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "חיבור הבנק והספרים" })).toBeInTheDocument();
    expect(screen.getByText(SKIP_ALL)).toBeInTheDocument();
  });

  it("keeps the back slot on step 1 without a control", () => {
    render(<OnboardingFrame step={1} title="העסק" onSkipAll={() => undefined} primary={<Button type="button">המשך</Button>} />);
    expect(screen.queryByRole("button", { name: "הקודם" })).not.toBeInTheDocument();
  });

  it("opens the skip sheet from skip-all and runs the confirm", async () => {
    const skipAll = vi.fn(() => Promise.resolve());
    render(<OnboardingFrame step={4} title="הלוואות" onSkipAll={skipAll} primary={<Button type="button">המשך</Button>} />);
    fireEvent.click(screen.getByText(SKIP_ALL));
    fireEvent.click(await screen.findByRole("button", { name: SKIP_SHEET_CONFIRM }));
    expect(skipAll).toHaveBeenCalledOnce();
  });

  it("gives a full screen (welcome) no counter, and passes the skip opener to a secondary function", () => {
    const onSkipAll = vi.fn();
    render(
      <OnboardingFrame
        step="welcome"
        title="ברוכים הבאים ל־Flow"
        onSkipAll={onSkipAll}
        primary={<Button type="button">בואו נתחיל</Button>}
        secondary={(open) => <button type="button" onClick={open}>דילוג, אגדיר אחר כך</button>}
      />,
    );
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "דילוג, אגדיר אחר כך" }));
    expect(screen.getByRole("button", { name: SKIP_SHEET_CONFIRM })).toBeInTheDocument();
  });
});
