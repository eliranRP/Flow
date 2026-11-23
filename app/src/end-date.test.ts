import { describe, expect, it } from "vitest";
import { endChoiceOf, endPresets, endText, endToast, nextChargeMonth, priorEnd, shiftDate } from "./end-date";

// FLOW-1266: the end date's presets and words.
describe("the end date presets", () => {
  it("ends with the next charge's month, in 3 and 6 months, and at the year's end", () => {
    expect(endPresets({ next_due_month: "2026-11", pace: "month" }, "2026-10-11")).toEqual({
      next: "2026-11-30",
      "3m": "2027-01-11",
      "6m": "2027-04-11",
      year: "2026-12-31",
    });
  });

  it("caps a moved day at the month's end", () => {
    expect(shiftDate("2026-11-30", 3)).toBe("2027-02-28");
  });

  it("takes this month for a charge still due here, and steps a late yearly charge onto its cycle", () => {
    expect(nextChargeMonth({ next_due_month: "2026-10", pace: "month" }, "2026-10-11")).toBe("2026-10");
    expect(nextChargeMonth({ next_due_month: "2026-08", pace: "quarter" }, "2026-10-11")).toBe("2026-11");
    expect(nextChargeMonth({ next_due_month: "", pace: "month" }, "2026-10-11")).toBe("2026-10");
  });

  it("names a date by its preset, else custom, and none when there is no date", () => {
    const presets = endPresets({ next_due_month: "2026-11", pace: "month" }, "2026-10-11");
    expect(endChoiceOf("2026-12-31", presets)).toBe("year");
    expect(endChoiceOf("2027-05-05", presets)).toBe("custom");
    expect(endChoiceOf(null, presets)).toBe("none");
  });
});

describe("the end date words", () => {
  it("says ללא or the date, and the toast says what changed", () => {
    expect(endText(null)).toBe("ללא");
    expect(endText("2027-03-31")).toBe("31/03/2027");
    expect(endToast("2027-03-31", "Example Water")).toBe("מסתיים ב־31/03/2027: Example Water");
    expect(endToast(null, "Example Water")).toBe("תאריך הסיום הוסר: Example Water");
  });

  it("reads the server's date before, or none", () => {
    expect(priorEnd({ prior_ends_on: "2027-01-31" })).toBe("2027-01-31");
    expect(priorEnd({ prior_ends_on: null })).toBeNull();
    expect(priorEnd(null)).toBeNull();
  });
});
