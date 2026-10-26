import { describe, expect, it } from "vitest";
import { monthlyTakeaway } from "./loan-summary-card";

// FLOW-962: the summary card says in words what its bar shows.
describe("monthlyTakeaway", () => {
  it("names the part that takes most of the month, and says רוב only past half", () => {
    expect(monthlyTakeaway([{ key: "principal", value: 4_477n }, { key: "interest", value: 5_062n }, { key: "escrow", value: 643n }]))
      .toBe("החלק הגדול בתשלום החודשי הולך לריבית");
    expect(monthlyTakeaway([{ key: "principal", value: 3_957n }, { key: "interest", value: 920n }])).toBe("רוב התשלום החודשי הולך לקרן");
  });

  it("says nothing for a bar of one part", () => {
    expect(monthlyTakeaway([{ key: "interest", value: 100n }])).toBeNull();
    expect(monthlyTakeaway([])).toBeNull();
  });
});
