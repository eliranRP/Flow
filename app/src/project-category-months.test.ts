import type { ProjectCategoryMonthRow } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { presetPeriod } from "./period";
import { markDay, usualFor } from "./project-category-months";

function month(id: string, flag: ProjectCategoryMonthRow["flag"], expected: number | null = null, currency = "ILS"): ProjectCategoryMonthRow {
  return {
    id,
    name: id,
    group_name: null,
    currency,
    this_month_minor: 0,
    months_minor: [],
    months_seen: 3,
    expected_minor: expected,
    typical_day: 10,
    flag,
  };
}

describe("marks only in the month view", () => {
  const now = new Date("2026-10-20T10:00:00Z");

  it("reads the month's last day, cut at today", () => {
    expect(markDay(presetPeriod("month", now))).toBe("2026-10-20");
    expect(markDay(presetPeriod("month", now, "2026-08"))).toBe("2026-08-31");
  });

  it("is off for longer periods", () => {
    expect(markDay(presetPeriod("months3", now))).toBeNull();
    expect(markDay(presetPeriod("all", now))).toBeNull();
    expect(markDay(null)).toBeNull();
  });

  it("gives the category page its usual month", () => {
    const months = { project_id: "p", today: "2026-10-20", this_month: "2026-10-01", months: [], categories: [month("b", "high", 410000)] };
    expect(usualFor(months, "b", "ILS")).toEqual({ expected: 410000n, up: "high", currency: "ILS" });
    expect(usualFor(months, "b", "USD")).toBeNull();
    expect(usualFor(months, "a", "ILS")).toBeNull();
  });
});
