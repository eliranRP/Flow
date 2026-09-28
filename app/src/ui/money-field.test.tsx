import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MoneyField } from "./money-field";
import { expectRtl, expectTarget } from "./test-support";

describe("MoneyField", () => {
  it("puts ₪ before an LTR amount and says the figure is before VAT", () => {
    expectRtl();
    render(<MoneyField label="סכום" defaultValue="1200" />);
    const field = screen.getByLabelText("סכום");
    expect(field).toHaveAttribute("dir", "ltr");
    expect(field).toHaveAttribute("inputmode", "decimal");
    expectTarget(field);
    expect(screen.getByText("₪")).toBeInTheDocument();
    expect(screen.getByText("לפני מע״מ")).toBeInTheDocument();
  });
});
