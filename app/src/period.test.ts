import { describe, expect, it } from "vitest";
import { formatDayMonth, inclusiveDays, rangeLengthLabel } from "./ui/date-math";
import {
  allTime,
  comparisonWords,
  customRange,
  defaultPeriod,
  heroExplanation,
  heroProfitLabel,
  isCurrentPeriod,
  monthPeriod,
  periodFromSearch,
  periodLabel,
  periodPhrase,
  periodSearch,
  presetPeriod,
  presetShortLabel,
  samePeriod,
  spansMonths,
  stepPeriod,
  thisMonth,
  windowLabel,
  windowToDate,
} from "./period";

const now = new Date("2026-10-08T12:00:00Z");

describe("period windows", () => {
  it("ends every preset with the current month and cuts it at today", () => {
    expect(presetPeriod("month", now)).toEqual({ kind: "month", from: "2026-10-01", to: "2026-10-08", anchor: "2026-10" });
    expect(presetPeriod("months3", now)).toMatchObject({ from: "2026-08-01", to: "2026-10-08" });
    expect(presetPeriod("months6", now)).toMatchObject({ from: "2026-05-01", to: "2026-10-08" });
    expect(presetPeriod("year", now)).toMatchObject({ from: "2026-01-01", to: "2026-10-08", anchor: "2026-12" });
    expect(presetPeriod("all", now)).toEqual(allTime());
    expect(defaultPeriod(now).kind).toBe("months3");
  });

  it("steps by the preset's own length, across a year boundary", () => {
    const back = stepPeriod(presetPeriod("months6", now), -1, now);
    expect(back).toMatchObject({ from: "2025-11-01", to: "2026-04-30", anchor: "2026-04" });
    expect(stepPeriod(presetPeriod("months3", now), -1, now)).toMatchObject({ from: "2026-05-01", to: "2026-07-31" });
    expect(stepPeriod(presetPeriod("month", now), -1, now)).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    const january = monthPeriod("2026-01", now);
    expect(stepPeriod(january, -1, now)).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(stepPeriod(presetPeriod("year", now), -1, now)).toMatchObject({ from: "2025-01-01", to: "2025-12-31" });
    expect(stepPeriod(stepPeriod(january, -1, now) ?? allTime(), 1, now)).toMatchObject({ from: "2026-01-01", to: "2026-01-31" });
  });

  it("never steps into the future and has no arrows on הכול or a custom range", () => {
    expect(stepPeriod(presetPeriod("month", now), 1, now)).toBeNull();
    expect(stepPeriod(presetPeriod("year", now), 1, now)).toBeNull();
    expect(isCurrentPeriod(presetPeriod("months3", now), now)).toBe(true);
    const september = stepPeriod(presetPeriod("month", now), -1, now);
    expect(september && isCurrentPeriod(september, now)).toBe(false);
    expect(september && stepPeriod(september, 1, now)).toMatchObject({ from: "2026-10-01", to: "2026-10-08" });
    expect(stepPeriod(allTime(), -1, now)).toBeNull();
    expect(stepPeriod(customRange("2026-01-01", "2026-02-01"), -1, now)).toBeNull();
    expect(presetPeriod("month", now, "2027-03")).toMatchObject({ anchor: "2026-10" });
  });

  it("selects by kind and anchor, not by the Hebrew label", () => {
    expect(samePeriod(thisMonth(now), presetPeriod("month", now), now)).toBe(true);
    expect(samePeriod(thisMonth(now), monthPeriod("2026-09", now), now)).toBe(false);
    expect(samePeriod(thisMonth(now), customRange("2026-10-01", "2026-10-08"), now)).toBe(false);
    expect(samePeriod({ kind: "month", from: "2026-09-01", to: "2026-09-30" }, monthPeriod("2026-09", now), now)).toBe(true);
  });

  it("spans months only for a range longer than one month", () => {
    expect(spansMonths(thisMonth(now))).toBe(false);
    expect(spansMonths(presetPeriod("months3", now))).toBe(true);
    expect(spansMonths(allTime())).toBe(true);
    expect(spansMonths(customRange("2026-09-02", "2026-09-20"))).toBe(false);
  });
});

describe("period labels", () => {
  it("names the window on the stepper", () => {
    expect(windowLabel(presetPeriod("months3", now), now)).toBe("אוגוסט – אוקטובר 2026");
    expect(windowLabel(stepPeriod(presetPeriod("months6", now), -1, now) ?? allTime(), now)).toBe("נובמבר 2025 – אפריל 2026");
    expect(windowLabel(monthPeriod("2026-09", now), now)).toBe("ספטמבר 2026");
    expect(windowLabel(presetPeriod("year", now), now)).toBe("2026");
    expect(windowLabel(allTime(), now)).toBe("כל התקופה");
    expect(windowLabel(allTime(), now, "project")).toBe("מתחילת הפרויקט");
    expect(windowLabel(customRange("2026-09-02", "2026-09-20"), now)).toBe("02/09/2026 – 20/09/2026");
    expect(windowToDate(presetPeriod("months3", now), now)).toBe(true);
    expect(windowToDate(monthPeriod("2026-09", now), now)).toBe(false);
    expect(presetShortLabel("months3")).toBe("3 ח׳");
  });

  it("says החודש for the current month and a loss in the label", () => {
    expect(periodLabel(thisMonth(now), now)).toBe("החודש");
    expect(periodLabel(monthPeriod("2026-09", now), now)).toBe("ספטמבר 2026");
    expect(periodLabel(presetPeriod("months3", now), now)).toBe("3 חודשים");
    expect(heroProfitLabel(thisMonth(now), 1n, now)).toBe("רווח נקי החודש");
    expect(heroProfitLabel(thisMonth(now), 0n, now)).toBe("רווח נקי החודש");
    expect(heroProfitLabel(monthPeriod("2026-09", now), -1n, now)).toBe("הפסד בספטמבר 2026");
    expect(heroProfitLabel(thisMonth(now), "mixed", now)).toBe("רווח והפסד החודש");
    expect(heroProfitLabel(presetPeriod("months3", now), 1n, now)).toBe("רווח נקי ב־3 חודשים");
    expect(heroProfitLabel(presetPeriod("year", now), 1n, now)).toBe("רווח נקי ב־2026");
    expect(heroProfitLabel(allTime(), 1n, now)).toBe("רווח נקי בכל התקופה");
    expect(heroProfitLabel(customRange("2026-01-01", "2026-02-01"), 1n, now)).toBe("רווח נקי בטווח שנבחר");
    expect(periodPhrase(allTime(), now, "project")).toBe("מתחילת הפרויקט");
  });

  it("explains income less expenses without the dates, and compares with the window before", () => {
    // FLOW-335: the dates live in the period bar and the label, not a third time here.
    expect(heroExplanation()).toBe("הכנסות פחות הוצאות");
    expect(comparisonWords(thisMonth(now), now)).toBe("מחודש שעבר");
    expect(comparisonWords(monthPeriod("2026-09", now), now)).toBe("מהחודש שלפניו");
    expect(comparisonWords(presetPeriod("months3", now), now)).toBe("מ־3 החודשים שלפניהם");
    expect(comparisonWords(allTime(), now)).toBeNull();
  });
});

describe("period in the URL", () => {
  it("round-trips every kind and ignores a broken value", () => {
    for (const period of [monthPeriod("2026-09", now), presetPeriod("months6", now), presetPeriod("year", now), allTime(), customRange("2026-01-02", "2026-03-04")]) {
      const back = periodFromSearch(new URLSearchParams(periodSearch(period, now)), now);
      expect(back && samePeriod(back, period, now)).toBe(true);
    }
    expect(periodFromSearch(new URLSearchParams("period=custom&from=2026-05-01&to=2026-01-01"), now)).toBeNull();
    expect(periodFromSearch(new URLSearchParams("period=week"), now)).toBeNull();
    expect(periodFromSearch(new URLSearchParams("period=month&at=2026-13"), now)).toMatchObject({ anchor: "2026-10" });
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
