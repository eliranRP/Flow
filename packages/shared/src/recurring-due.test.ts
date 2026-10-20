import { describe, expect, it } from "vitest";
import { dueInMonth, monthIndex, paceMonths } from "./recurring-due";

describe("dueInMonth (the pace filter)", () => {
  it("counts a monthly charge every month from its due month", () => {
    expect(dueInMonth("2026-11", "month", "2026-11", "2026-10")).toBe(true);
    expect(dueInMonth("2026-10", "month", "2026-11", "2026-10")).toBe(true);
  });

  it("counts a charge every 2 months only in its due months", () => {
    expect(dueInMonth("2026-11", "2months", "2026-11", "2026-10")).toBe(true);
    expect(dueInMonth("2026-10", "2months", "2026-11", "2026-10")).toBe(false);
    expect(dueInMonth("2026-12", "2months", "2026-11", "2026-10")).toBe(false);
  });

  it("counts a quarterly charge three months apart", () => {
    expect(dueInMonth("2026-11", "quarter", "2026-11", "2026-10")).toBe(true);
    expect(dueInMonth("2026-12", "quarter", "2026-11", "2026-10")).toBe(false);
    expect(dueInMonth("2026-08", "quarter", "2026-11", "2026-08")).toBe(true);
  });

  it("still expects a late monthly charge next month", () => {
    expect(dueInMonth("2026-08", "month", "2026-11", "2026-10")).toBe(true);
  });

  it("counts a late charge from this month, as expected_months does", () => {
    // Due in August and not come: expected from October, so every 2 months is October, December, …
    expect(dueInMonth("2026-08", "2months", "2026-11", "2026-10")).toBe(false);
    expect(dueInMonth("2026-08", "2months", "2026-12", "2026-10")).toBe(true);
  });

  it("counts a monthly charge with no due month from this month", () => {
    expect(dueInMonth(null, "month", "2026-11", "2026-10")).toBe(true);
  });

  it("counts a yearly charge only in its due month", () => {
    expect(dueInMonth("2026-11", "year", "2026-11", "2026-10")).toBe(true);
    expect(dueInMonth("2027-11", "year", "2026-11", "2026-10")).toBe(false);
  });

  it("counts a late yearly charge from this month, so not next month", () => {
    // Due last November and not come: expected from October, a gap of 1 to November.
    expect(dueInMonth("2025-11", "year", "2026-11", "2026-10")).toBe(false);
  });
});

describe("dueInMonth with the server's due day", () => {
  it("reads a yyyy-mm-dd due month as its month", () => {
    expect(dueInMonth("2026-10-01", "year", "2026-10", "2026-10")).toBe(true);
    expect(dueInMonth("2027-07-01", "year", "2026-10", "2026-10")).toBe(false);
    expect(dueInMonth("2026-08-01", "year", "2026-10", "2026-10")).toBe(true);
  });
});

describe("paceMonths and monthIndex", () => {
  it("counts a missing pace as monthly", () => {
    expect([paceMonths("month"), paceMonths("2months"), paceMonths("quarter"), paceMonths("year"), paceMonths(null)]).toEqual([1, 2, 3, 12, 1]);
  });

  it("subtracts two keys to the months between them, across a year end", () => {
    expect(monthIndex("2027-01") - monthIndex("2026-11")).toBe(2);
    expect(monthIndex("2027-01-15")).toBe(monthIndex("2027-01"));
  });
});
