import { describe, expect, it } from "vitest";
import { basisChoiceLabel, currencyChoiceLabel } from "./company-choices";

describe("company choices", () => {
  it("labels a known currency and falls back to the code", () => {
    expect(currencyChoiceLabel("USD")).toBe("$ דולר");
    expect(currencyChoiceLabel("EUR")).toBe("EUR");
  });

  it("names each basis for the Settings row", () => {
    expect(basisChoiceLabel("cash")).toBe("תאריך תשלום");
    expect(basisChoiceLabel("invoiced")).toBe("תאריך חשבונית");
  });
});
