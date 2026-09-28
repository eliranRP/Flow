import { describe, expect, it } from "vitest";
import { formatDayMonth, inclusiveDays, rangeLengthLabel } from "./ui/date-math";
import { allTime, comparisonWords, customRange, heroProfitLabel, periodLabel, samePeriod, thisMonth } from "./period";

describe("period identity", () => {
  it("selects by kind, not by the Hebrew label", () => {
    const month = thisMonth(new Date("2026-09-28T12:00:00Z"));
    expect(periodLabel(month)).toBe("החודש");
    expect(heroProfitLabel(month)).toBe("רווח נקי בספטמבר");
    expect(comparisonWords(month)).toBe("מחודש שעבר");
    expect(samePeriod(month, { ...month, kind: "month" })).toBe(true);
    expect(samePeriod(month, customRange(month.from ?? "", month.to ?? ""))).toBe(false);
    expect(comparisonWords(allTime())).toBeNull();
    expect(heroProfitLabel(allTime())).toBe("רווח נקי בכל התקופה");
  });
});

describe("dates", () => {
  it("keeps the year when the row is outside the current year", () => {
    expect(formatDayMonth("2026-09-21", new Date("2026-09-28T12:00:00Z"))).toBe("21/09");
    expect(formatDayMonth("2025-03-01", new Date("2026-09-28T12:00:00Z"))).toBe("01/03/2025");
  });

  it("uses the singular day label for a one-day range", () => {
    expect(rangeLengthLabel(inclusiveDays("2026-09-01", "2026-09-01"))).toBe("הצגת יום אחד");
    expect(rangeLengthLabel(2)).toBe("הצגת 2 ימים");
  });
});
