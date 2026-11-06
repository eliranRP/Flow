import { describe, expect, it } from "vitest";
import { forecastMonthOf, forecastMonthSearch } from "./forecast-page-month";

const TODAY = "2026-11-06";

describe("forecastMonthOf (FLOW-1066)", () => {
  it("reads any month of the forecast, next month otherwise", () => {
    expect(forecastMonthOf("", TODAY)).toBe("2026-12");
    expect(forecastMonthOf("?month=2027-03", TODAY)).toBe("2027-03");
    expect(forecastMonthOf("?month=2027-11&preview=1", TODAY)).toBe("2027-11");
    expect(forecastMonthOf("?month=2027-12", TODAY)).toBe("2026-12");
    expect(forecastMonthOf("?month=2026-11", TODAY)).toBe("2026-12");
    expect(forecastMonthOf("?month=soon", TODAY)).toBe("2026-12");
  });
});

describe("forecastMonthSearch", () => {
  it("adds ?month= for a month after next, and keeps the preview switch", () => {
    expect(forecastMonthSearch("", "2026-12", TODAY)).toBe("");
    expect(forecastMonthSearch("", "2027-03", TODAY)).toBe("?month=2027-03");
    expect(forecastMonthSearch("?preview=1", "2027-03", TODAY)).toBe("?preview=1&month=2027-03");
    expect(forecastMonthSearch("?preview=1&month=2027-03", "2026-12", TODAY)).toBe("?preview=1");
  });
});
