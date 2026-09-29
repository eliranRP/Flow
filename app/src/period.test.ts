import { describe, expect, it } from "vitest";
import { formatDayMonth, inclusiveDays, rangeLengthLabel } from "./ui/date-math";
import { allTime, comparisonWords, customRange, heroExplanation, heroProfitLabel, lastMonth, periodLabel, samePeriod, thisMonth, yearToDate } from "./period";

const now = new Date("2026-09-28T12:00:00Z");

describe("period identity", () => {
  it("selects by kind, not by the Hebrew label", () => {
    const month = thisMonth(now);
    expect(periodLabel(month)).toBe("החודש");
    expect(heroProfitLabel(month, 1n)).toBe("רווח נקי החודש");
    expect(heroProfitLabel(month, -1n)).toBe("הפסד החודש");
    expect(heroProfitLabel(month, 0n)).toBe("רווח נקי החודש");
    expect(heroExplanation(month, now)).toBe("הכנסות פחות הוצאות, מ־1 בספטמבר עד היום");
    expect(comparisonWords(month)).toBe("מחודש שעבר");
    expect(samePeriod(month, { ...month, kind: "month" })).toBe(true);
    expect(samePeriod(month, customRange(month.from ?? "", month.to ?? ""))).toBe(false);
    expect(comparisonWords(allTime())).toBeNull();
    expect(heroProfitLabel(allTime(), 1n)).toBe("רווח נקי בכל התקופה");
    expect(heroExplanation(allTime(), now)).toBe("הכנסות פחות הוצאות, בכל התקופה");
  });

  it("names the other periods in the label and spells a closed range", () => {
    expect(heroProfitLabel(yearToDate(now), 39_164_00n)).toBe("רווח נקי מתחילת השנה");
    expect(heroExplanation(yearToDate(now), now)).toBe("הכנסות פחות הוצאות, מ־1 בינואר עד היום");
    expect(heroProfitLabel(lastMonth(now), -100n)).toBe("הפסד בחודש קודם");
    expect(heroExplanation(lastMonth(now), now)).toBe("הכנסות פחות הוצאות, מ־1 באוגוסט עד 31 באוגוסט");
    const range = customRange("2025-12-01", "2026-01-15");
    expect(heroProfitLabel(range, 1n)).toBe("רווח נקי בטווח שנבחר");
    expect(heroExplanation(range, now)).toBe("הכנסות פחות הוצאות, מ־1 בדצמבר 2025 עד 15 בינואר");
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
