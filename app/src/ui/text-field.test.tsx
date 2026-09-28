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
    expectTarget(field);
    expectThemePaint(field, "color");
    expect(screen.getByText("מספר קצר מדי – 9 ספרות")).toBeInTheDocument();
  });
});
