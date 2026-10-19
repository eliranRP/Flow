import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ForecastAmountField } from "./forecast-edit-parts";

describe("ForecastAmountField", () => {
  it("is as wide as its figure in digit widths, so the last digit is never clipped", () => {
    const { rerender } = render(<ForecastAmountField value="2,500" onChange={() => {}} mark="$" sign="+" income label="סכום צפוי" />);
    expect(screen.getByLabelText("סכום צפוי").style.inlineSize).toBe("calc(5ch + 2px)");
    rerender(<ForecastAmountField value="" onChange={() => {}} mark="$" sign="+" income label="סכום צפוי" />);
    expect(screen.getByLabelText("סכום צפוי").style.inlineSize).toBe("calc(1ch + 2px)");
  });
});
