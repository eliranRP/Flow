import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TextField } from "./text-field";
import { expectRtl, expectTarget, expectThemePaint } from "./test-support";

describe("TextField", () => {
  it("keeps the label above the field and a 44px control", () => {
    expectRtl();
    render(<TextField label="שם העסק" error="מספר קצר מדי – 9 ספרות" defaultValue="12" />);
    const field = screen.getByLabelText("שם העסק");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAttribute("autocomplete", "off");
    expect(field.getAttribute("name") ?? "").toMatch(/^flow-text-/);
    expect(field.getAttribute("name") ?? "").not.toMatch(/name|email|tel|phone|contact/i);
    expectTarget(field);
    expectThemePaint(field, "color");
    expect(screen.getByText("מספר קצר מדי – 9 ספרות")).toBeInTheDocument();
  });

  it("a read-only field keeps its value, takes the muted read-only look, and keeps the error message linked", () => {
    const { container } = render(<TextField label="מזהה" error="לא תקין" readOnly defaultValue="ABC-1" />);
    const field = screen.getByLabelText("מזהה");
    expect(field).toHaveAttribute("readonly");
    expect(field).toHaveValue("ABC-1");
    expect(container.querySelector(".ui-field")).toHaveClass("ui-field-readonly", "ui-field-error");
    expect(field).toHaveAttribute("aria-describedby", expect.stringMatching(/-error$/));
    expect(screen.getByText("לא תקין")).toHaveAttribute("id", field.getAttribute("aria-describedby"));
  });

  it("an editable field has no read-only class", () => {
    const { container } = render(<TextField label="שם" defaultValue="טק" />);
    expect(container.querySelector(".ui-field")).not.toHaveClass("ui-field-readonly");
  });
});

describe("TextField hint (FLOW-139d)", () => {
  it("draws the hint under the field, and the error replaces it", () => {
    const { rerender } = render(<TextField label="תקופה" value="360" onChange={() => undefined} hint="30 שנה" />);
    expect(screen.getByText("30 שנה")).toHaveClass("ui-field-hint");
    rerender(<TextField label="תקופה" value="" onChange={() => undefined} hint="30 שנה" error="כתבו את מספר החודשים." />);
    expect(screen.getByText("כתבו את מספר החודשים.")).toBeInTheDocument();
    expect(screen.queryByText("30 שנה")).toBeNull();
  });
});

