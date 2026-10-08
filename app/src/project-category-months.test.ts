import type { ProjectCategoryMonthRow } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { presetPeriod } from "./period";
import { categoryEntries, markDay, usualFor, type CategoryLine } from "./project-category-months";

function line(id: string, name: string, minor: number, currency = "ILS"): CategoryLine {
  return { id, name, currency, amount_minor: BigInt(minor) };
}

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

describe("project categories by group (FLOW-401)", () => {
  // The server's order: biggest first.
  const lines = [line("b", "חומרים", 786000), line("a", "קבלנים", 600000), line("e", "חשמל", 45500), line("g", "גז", 15500)];
  const groups = new Map([["e", "חשבונות"], ["g", "חשבונות"], ["w", "חשבונות"]]);

  it("folds two or more categories of a group into one row with their total, in the server's order", () => {
    const entries = categoryEntries("ILS", lines, groups, null);
    expect(entries.map((entry) => (entry.kind === "group" ? entry.name : entry.line.name))).toEqual(["חומרים", "קבלנים", "חשבונות"]);
    const group = entries[2];
    expect(group?.kind === "group" && group.amount_minor).toBe(61000n);
    expect(group?.kind === "group" && group.items.map((item) => item.line.name)).toEqual(["חשמל", "גז"]);
  });

  it("keeps a lone member of a group as a plain row", () => {
    const entries = categoryEntries("ILS", [line("a", "קבלנים", 600000), line("e", "חשמל", 45500)], groups, null);
    expect(entries.every((entry) => entry.kind === "category")).toBe(true);
  });

  it("marks high and new categories, and the group of a marked member", () => {
    const entries = categoryEntries("ILS", lines, groups, [month("b", "high", 410000), month("a", null, 600000), month("g", "new")]);
    const marked = entries.map((entry) => entry.up);
    expect(marked).toEqual(["high", null, "new"]);
  });

  it("puts a missing bill under its group with no amount", () => {
    const entries = categoryEntries("ILS", lines, groups, [month("w", "missing", 9000)]);
    const group = entries.find((entry) => entry.kind === "group");
    expect(group?.kind === "group" && group.items.map((item) => [item.line.id, item.missing])).toEqual([["e", false], ["g", false], ["w", true]]);
  });

  it("keeps the server's order whatever the marks", () => {
    const entries = categoryEntries("ILS", [line("a", "קבלנים", 600000), line("b", "חומרים", -20000)], new Map(), [month("b", "new")]);
    expect(entries.map((entry) => entry.kind === "category" && entry.line.id)).toEqual(["a", "b"]);
  });

  it("shows a group of bills not in yet as missing, at the end", () => {
    const entries = categoryEntries("ILS", [line("a", "קבלנים", 600000)], groups, [month("e", "missing", 9000), month("w", "missing", 9000)]);
    const last = entries[entries.length - 1];
    expect(last?.kind === "group" && [last.name, last.missing, last.amount_minor]).toEqual(["חשבונות", true, 0n]);
    expect(entries[0]?.kind === "category" && entries[0].line.id).toBe("a");
  });

  it("puts a missing bill outside a group at the end", () => {
    const entries = categoryEntries("ILS", lines, new Map(), [month("x", "missing", 9000)]);
    const last = entries[entries.length - 1];
    expect(last?.kind === "category" && [last.line.id, last.missing]).toEqual(["x", true]);
  });

  it("ignores a missing bill in another currency", () => {
    const entries = categoryEntries("ILS", lines, new Map(), [month("x", "missing", 9000, "USD")]);
    expect(entries).toHaveLength(4);
  });
});

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
