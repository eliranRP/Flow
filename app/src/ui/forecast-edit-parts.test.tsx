import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ForecastAmountField } from "./forecast-edit-parts";

describe("ForecastAmountField", () => {
  it("is as wide as its figure in digit widths, so the last digit is never clipped", () => {
    const { rerender } = render(<ForecastAmountField value="2,500" onChange={() => {}} mark="$" sign="+" income label="סכום צפוי" />);
    expect(screen.getByLabelText("סכום צפוי").style.inlineSize).toBe("5ch");
    rerender(<ForecastAmountField value="" onChange={() => {}} mark="$" sign="+" income label="סכום צפוי" />);
    expect(screen.getByLabelText("סכום צפוי").style.inlineSize).toBe("1ch");
  });
});
