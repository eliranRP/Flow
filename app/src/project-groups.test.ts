import { describe, expect, it } from "vitest";
import { projectChoices } from "./project-groups";
import { projectsGrouped } from "./screens/project-groups-sample";
import { groupHint, groupSections, PICK_REST_HEADING } from "./ui/change-picker";
import { type CashCurrencyRow, type ProjectCategoryMonthRow } from "@flow/shared";
import { projectCashSummaryRows, projectEarlierMonthRows, projectProfitMonthPath } from "./project-cash";
import { presetPeriod } from "./period";
import { markDay, usualFor } from "./project-category-months";

// --- project-groups.test.ts

describe("project groups (FLOW-406)", () => {
  it("gives each picker choice its group's name", () => {
    const choices = projectChoices(projectsGrouped);
    expect(choices.find((choice) => choice.id === "u1")?.group).toBe("בניין לדוגמה");
    expect(choices.find((choice) => choice.id === "a")).not.toHaveProperty("group");
    expect(projectChoices(undefined)).toEqual([]);
  });

  it("sections the picker by group, then the rest, and not at all with no groups", () => {
    const sections = groupSections([
      { id: "a", name: "א" },
      { id: "u1", name: "דירה 1", group: "בניין" },
      { id: "u2", name: "דירה 2", group: "בניין" },
    ]);
    expect(sections?.map((section) => section.heading)).toEqual(["בניין", PICK_REST_HEADING]);
    expect(sections?.[0]?.options.map((option) => option.id)).toEqual(["u1", "u2"]);
    expect(groupSections([{ id: "a", name: "א" }])).toBeNull();
  });

  it("keeps the suggestion above the sections and two same-named groups apart", () => {
    const sections = groupSections(
      [
        { id: "s", name: "מוצע" },
        { id: "u1", name: "דירה 1", group: "בניין", groupId: "g1" },
        { id: "u2", name: "דירה 2", group: "בניין", groupId: "g2" },
      ],
      "s",
    );
    expect(sections?.map((section) => section.options.map((option) => option.id))).toEqual([["u1"], ["u2"]]);
  });

  it("names the group under a row only when the search matched through the group (FLOW-358)", () => {
    const unit = { id: "u1", name: "דירה 1", code: "P-7", group: "בניין לדוגמה", groupId: "g1" };
    expect(groupHint(unit, "לדוגמה")).toBe("בניין לדוגמה");
    expect(groupHint(unit, "דירה")).toBeUndefined();
    expect(groupHint(unit, "p-7")).toBeUndefined();
    expect(groupHint(unit, "")).toBeUndefined();
    expect(groupHint({ id: "a", name: "לדוגמה" }, "לדוגמה")).toBeUndefined();
  });
});
// --- project-cash.test.ts

const NOW = new Date("2026-10-10T09:00:00Z");

function row(inMinor: bigint, outMinor: bigint, profit: bigint, currency = "USD"): CashCurrencyRow {
  return {
    currency,
    in_minor: inMinor,
    out_minor: outMinor,
    net_minor: inMinor - outMinor,
    profit_minor: profit,
    excluded_count: 0,
    excluded_in_minor: 0n,
    excluded_out_minor: 0n,
    not_in_profit_categories: [],
  };
}

describe("FLOW-419 project cash rows", () => {
  it("opens the project's month page, and search for the kept row", () => {
    const rows = projectCashSummaryRows("p1", "2026-10", [row(310_000n, 75_000n, 128_000n)], "?preview=1", NOW);
    // Net $2,350 less profit $1,280: Home's לא נספר ברווח row: the month page lists counted lines only, so it opens search.
    expect(rows.map((r) => r.label)).toEqual(["נכנס", "יצא", "רווח החודש", "לא נספר ברווח"]);
    const monthPage = /^\/projects\/p1\/profit\/2026-10\?preview=1&period=month&at=2026-10/;
    expect(rows[3]?.href).toMatch(/^\/search\?preview=1&period=month&at=2026-10&project=p1$/);
    expect(rows[0]?.href).toMatch(monthPage);
    expect(rows[1]?.href).toMatch(monthPage);
    expect(rows[2]?.href).toMatch(/^\/projects\/p1\/profit\/2026-10\?preview=1&period=month&at=2026-10/);
  });

  it("lists the earlier months, each opening its own page", () => {
    const data = {
      basis: "paid" as const,
      base_currency: "USD",
      months: [
        { month: "2026-10-01", by_currency: [row(1n, 0n, 0n)] },
        { month: "2026-09-01", by_currency: [row(310_000n, 500_000n, 95_000n)] },
      ],
    };
    const rows = projectEarlierMonthRows("p1", data, "", NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("ספטמבר");
    expect(rows[0]?.amounts).toEqual([{ currency: "USD", minor: -190_000n }]);
    expect(rows[0]?.href).toBe("/projects/p1/profit/2026-09?period=month&at=2026-09");
  });

  it("names the profit page's path", () => {
    expect(projectProfitMonthPath("p 1", "2026-09", "?period=month&at=2026-09")).toBe("/projects/p 1/profit/2026-09?period=month&at=2026-09");
  });
});
// --- project-category-months.test.ts

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