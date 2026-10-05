import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Button } from "../ui/button";
import { SetupCard } from "./card";
import "./setup.css";
import { SetupStep } from "./shell";
import { StepInstall, SumitFailureNote } from "./steps";

describe("setup step chrome", () => {
  it("has no skip and no counter on step 0", () => {
    render(
      <SetupStep step={0} title="פרטי העסק" line="השם שיופיע בבית." primary={<Button type="button">המשך</Button>} />,
    );
    expect(screen.getByRole("heading", { name: "פרטי העסק" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "דלג" })).not.toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("counts step 2 out of 5 and skips without saving", () => {
    const skip = vi.fn();
    render(
      <SetupStep
        step={2}
        title="תיוג חכם"
        line="Flow יציע פרויקט וקטגוריה לכל תנועה."
        demo="jev"
        onBack={() => undefined}
        onSkip={skip}
        primary={<Button type="button">המשך</Button>}
      />,
    );
    expect(screen.getByRole("meter", { name: "התקדמות ההגדרה" })).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByRole("meter", { name: "התקדמות ההגדרה" })).toHaveAttribute("aria-valuemax", "5");
    expect(screen.getByText(/מתוך/)).toBeInTheDocument();
    expect(document.querySelector("[data-demo-slot]")).toBeInTheDocument();
    expect(document.querySelector(".ui-demo-phone")).toHaveAttribute("aria-hidden", "true");
    const meter = document.querySelector(".ui-setup-meter .ui-bar-thin");
    const setup = document.querySelector(".ui-setup");
    expect(meter).not.toBeNull();
    expect(setup).not.toBeNull();
    if (meter) expect(getComputedStyle(meter).blockSize).toBe("var(--space-1)");
    if (setup) expect(getComputedStyle(setup).paddingBlockStart).toBe("var(--safe-top)");
    const primary = screen.getByRole("button", { name: "המשך" });
    const stage = document.querySelector(".ui-demo");
    expect(stage).not.toBeNull();
    if (stage) expect(primary.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "דלג" }));
    expect(skip).toHaveBeenCalledOnce();
  });

  it("lists only the open rows and shows the SUMIT failure note", () => {
    render(
      <MemoryRouter>
        <SetupCard done={3} steps={[2, 5]} onDismiss={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "תיוג חכם" })).toHaveAttribute("href", "/setup/2?from=card");
    expect(screen.getByRole("link", { name: "התקנה" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "חיבור SUMIT" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "מתקדם · עוזר AI" })).toHaveAttribute("href", "/settings?sheet=assistant");
    render(<SumitFailureNote />);
    expect(screen.getByText("SUMIT עוד לא מחובר.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הסתרה" })).toBeInTheDocument();
  });

  it("numbers the step 5 rows and divides them", () => {
    render(<StepInstall onSkip={() => undefined} onFinish={() => undefined} />);
    const items = document.querySelectorAll(".ui-setup-steps li");
    expect(items).toHaveLength(3);
    expect(items[0]?.querySelector(".ui-setup-stepn")).toHaveTextContent("1");
    expect(items[1]?.querySelector(".ui-setup-stepn")).toHaveTextContent("2");
    expect(items[2]?.querySelector(".ui-setup-stepn")).toHaveTextContent("3");
  });
});
