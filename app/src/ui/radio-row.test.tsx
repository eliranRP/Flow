import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RadioRow } from "./radio-row";

describe("RadioRow", () => {
  it("keeps a busy row focusable but ignores its clicks (FLOW-115)", () => {
    const onSelect = vi.fn();
    render(<RadioRow layout="picker" label="הלוואת דוגמה" value="loan-1" busy selected={false} onSelect={onSelect} />);
    const radio = screen.getByRole("radio", { name: "הלוואת דוגמה" });
    expect(radio).not.toBeDisabled();
    expect(radio).toHaveAttribute("aria-disabled", "true");
    expect(radio).toHaveAttribute("aria-busy", "true");
    expect(radio).toHaveAttribute("data-value", "loan-1");
    fireEvent.click(radio);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows disabledReason in picker layout with an accessible description", () => {
    render(
      <RadioRow
        layout="picker"
        label="הלוואת דוגמה"
        disabledReason="ההלוואה נפרעה"
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    const radio = screen.getByRole("radio", { name: "הלוואת דוגמה" });
    expect(radio).toBeDisabled();
    expect(radio).toHaveAccessibleDescription("ההלוואה נפרעה");
    expect(screen.getByText("ההלוואה נפרעה")).toBeInTheDocument();
  });

  it("omits aria-describedby in picker layout when there is no description", () => {
    render(
      <RadioRow
        layout="picker"
        label="הלוואת דוגמה"
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("radio", { name: "הלוואת דוגמה" })).not.toHaveAttribute("aria-describedby");
  });

  it("does not call onSelect when disabledReason is set", () => {
    const onSelect = vi.fn();
    render(
      <RadioRow
        layout="picker"
        label="הלוואת דוגמה"
        disabledReason="ההלוואה נפרעה"
        selected={false}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "הלוואת דוגמה" }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
