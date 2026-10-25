// FLOW-517: the weekly summary sheet's words and week logic. Invented figures only; amounts are cents.
import { describe, expect, it } from "vitest";
import {
  budgetPercent,
  cardStatus,
  searchWithWeek,
  countedNote,
  countsText,
  linesText,
  moreOverBudgetText,
  profitChange,
  reviewLabel,
  searchWithoutWeek,
  weekFromSearch,
  weekLabel,
} from "./weekly-summary";

const TODAY = "2026-10-11";

describe("weekFromSearch", () => {
  it("takes a Sunday no later than today", () => {
    expect(weekFromSearch("?week=2026-10-04", TODAY)).toBe("2026-10-04");
    expect(weekFromSearch("?week=2026-10-11", TODAY)).toBe("2026-10-11");
  });

  it("ignores a missing, malformed, non-Sunday or future week", () => {
    expect(weekFromSearch("", TODAY)).toBeNull();
    expect(weekFromSearch("?week=soon", TODAY)).toBeNull();
    expect(weekFromSearch("?week=2026-10-05", TODAY)).toBeNull();
    expect(weekFromSearch("?week=2026-02-30", TODAY)).toBeNull();
    expect(weekFromSearch("?week=2026-10-18", TODAY)).toBeNull();
  });

  it("drops only the week from the address", () => {
    expect(searchWithoutWeek("?week=2026-10-04")).toBe("");
    expect(searchWithoutWeek("?preview=1&week=2026-10-04")).toBe("?preview=1");
  });
});

describe("weekLabel", () => {
  it("names the month once inside one month, twice across two", () => {
    expect(weekLabel("2026-10-04")).toBe("ראשון 4 עד שבת 10 באוקטובר");
    expect(weekLabel("2026-09-27")).toBe("ראשון 27 בספטמבר עד שבת 3 באוקטובר");
  });
});

describe("the counts", () => {
  it("says the lines in the push's words, singular and plural", () => {
    expect(linesText(0)).toBe("לא נכנסו תנועות השבוע");
    expect(linesText(1)).toBe("תנועה אחת נכנסה השבוע");
    expect(linesText(23)).toBe("23 תנועות נכנסו השבוע");
  });

  it("adds the auto-approved count when there is one", () => {
    expect(countsText({ lines: 23, auto_approved: 16 })).toBe("23 תנועות נכנסו השבוע · 16 אושרו אוטומטית");
    expect(countsText({ lines: 1, auto_approved: 1 })).toBe("תנועה אחת נכנסה השבוע · אושרה אוטומטית");
    expect(countsText({ lines: 3, auto_approved: 0 })).toBe("3 תנועות נכנסו השבוע");
  });

  it("says the profit already counts the week's lines that wait, only when some do", () => {
    expect(countedNote({ week_waiting: 7 })).toBe("כולל 7 שעוד מחכות לאישור");
    expect(countedNote({ week_waiting: 1 })).toBe("כולל אחת שעוד מחכה לאישור");
    expect(countedNote({ week_waiting: 0 })).toBeNull();
  });

  it("estimates the review at about 20 seconds an item", () => {
    expect(reviewLabel(1)).toBe("לאישור פריט אחד · פחות מדקה");
    expect(reviewLabel(3)).toBe("לאישור 3 פריטים · כדקה");
    expect(reviewLabel(7)).toBe("לאישור 7 פריטים · כ־2 דקות");
    expect(reviewLabel(12)).toBe("לאישור 12 פריטים · כ־4 דקות");
  });

  it("names the other projects over budget", () => {
    expect(moreOverBudgetText(0)).toBeNull();
    expect(moreOverBudgetText(1)).toBe("ועוד פרויקט אחד מעל התקציב");
    expect(moreOverBudgetText(2)).toBe("ועוד 2 פרויקטים מעל התקציב");
  });
});

describe("the figures", () => {
  it("rounds the overrun to a whole percent", () => {
    expect(budgetPercent(5_824_000n, 5_200_000n)).toBe(112);
    expect(budgetPercent(100n, 0n)).toBe(0);
  });

  it("colours the change by whether profit got better, both ways", () => {
    expect(profitChange({ lines: 23, profit_minor: -121_000n, prev_profit_minor: -205_000n })).toEqual({ minor: 84_000n, tone: "helps" });
    expect(profitChange({ lines: 50, profit_minor: -224_000n, prev_profit_minor: -205_000n })).toEqual({ minor: -19_000n, tone: "hurts" });
  });

  it("shows no change with no lines or no week before", () => {
    expect(profitChange({ lines: 0, profit_minor: 0n, prev_profit_minor: -205_000n })).toBeNull();
    expect(profitChange({ lines: 4, profit_minor: 100n, prev_profit_minor: null })).toBeNull();
  });
});

describe("searchWithWeek", () => {
  it("adds the week and keeps the rest", () => {
    expect(searchWithWeek("", "2026-10-04")).toBe("?week=2026-10-04");
    expect(searchWithWeek("?month=2026-10", "2026-10-04")).toBe("?month=2026-10&week=2026-10-04");
    expect(searchWithWeek("?week=2026-09-27", "2026-10-04")).toBe("?week=2026-10-04");
  });
});

describe("cardStatus", () => {
  it("counts the open queue, then says all approved or no lines", () => {
    expect(cardStatus({ lines: 23, waiting: 7 })).toEqual({ text: "7 מחכות לאישור", tone: "waiting" });
    expect(cardStatus({ lines: 3, waiting: 1 })).toEqual({ text: "אחת מחכה לאישור", tone: "waiting" });
    expect(cardStatus({ lines: 1, waiting: 0 })).toEqual({ text: "הכול מאושר", tone: "done" });
    expect(cardStatus({ lines: 0, waiting: 0 })).toEqual({ text: "לא נכנסו תנועות", tone: "empty" });
    expect(cardStatus({ lines: 0, waiting: 2 })).toEqual({ text: "2 מחכות לאישור", tone: "waiting" });
  });
});
