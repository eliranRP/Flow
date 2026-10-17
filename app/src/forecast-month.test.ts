import { describe, expect, it } from "vitest";
import { nextMonth } from "./forecast-month";

describe("nextMonth (FLOW-141b)", () => {
  it("steps to the following month", () => {
    expect(nextMonth("2026-10")).toBe("2026-11");
  });

  it("rolls December into January of the next year", () => {
    expect(nextMonth("2026-12")).toBe("2027-01");
  });
});
