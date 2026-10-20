import { describe, expect, it } from "vitest";
import { companyCategoryGroups, companySummaryRows } from "./company-profit-rows";
import type { ProfitCategoryRow, ProfitLine } from "./use-company-profit";

/** FLOW-143: the company profit page's summary rows and its category groups (board `co.sum`, `catGroups(L, true)`). Invented figures. */

describe("companySummaryRows", () => {
  it("is income, counted expenses, the month's profit in bold and the year to date", () => {
    const rows = companySummaryRows({ income: 300_000n, expense: 120_000n, profit: 180_000n, ytdProfit: 900_000n }, "2026-10");
    expect(rows.map((row) => [row.label, row.minor, row.strong])).toEqual([
      ["הכנסות", 300_000n, false],
      ["הוצאות שנספרות ברווח", 120_000n, false],
      ["רווח אוקטובר", 180_000n, true],
      ["רווח מתחילת השנה", 900_000n, false],
    ]);
  });

  it("names the page's month, keeps a loss signed, and waits for the year to date", () => {
    const rows = companySummaryRows({ income: 100_000n, expense: 150_000n, profit: -50_000n, ytdProfit: null }, "2026-04");
    expect(rows.map((row) => row.id)).toEqual(["income", "expense", "profit"]);
    expect(rows[2]).toMatchObject({ label: "רווח אפריל", minor: -50_000n });
  });
});

function category(key: string, name: string, direction: "income" | "expense", amount: bigint, count: number, projects: number): ProfitCategoryRow {
  return { key, name, direction, amount, count, projects };
}

function line(id: string, categoryKey: string, direction: "income" | "expense", amount: bigint, date: string, project: string | null): ProfitLine {
  return { id, transactionId: id, title: id, source: undefined, date, project, category: categoryKey, categoryKey, direction, amount };
}

describe("companyCategoryGroups", () => {
  const categories = [
    category("rent", "שכירות", "income", 600_000n, 4, 2),
    category("work", "עבודות לקוח", "income", 200_000n, 1, 1),
    category("repairs", "תיקונים", "expense", -300_000n, 3, 3),
    category("payroll", "שכר", "expense", -100_000n, 1, 0),
    category("tax", "מסים", "expense", -100_000n, 2, 2),
  ];
  const lines = [
    line("l1", "rent", "income", 150_000n, "2026-10-01", "בית א"),
    line("l2", "rent", "income", 150_000n, "2026-10-05", "בית ב"),
    line("l3", "repairs", "expense", -100_000n, "2026-10-03", "בית א"),
    line("l4", "repairs", "expense", -200_000n, "2026-10-03", "בית ב"),
  ];
  const groups = companyCategoryGroups({ categories, lines });

  it("is income, then expenses, each with its total", () => {
    expect(groups.map((group) => [group.title, group.total])).toEqual([["הכנסות", 800_000n], ["הוצאות", 500_000n]]);
  });

  it("gives each row its share of the group, its count and projects, and its bar against the group's biggest", () => {
    const [income, expense] = groups;
    expect(income?.categories.map((row) => [row.name, row.total, row.share, row.width, row.count, row.projects])).toEqual([
      ["שכירות", 600_000n, 75, 100, 4, 2],
      ["עבודות לקוח", 200_000n, 25, 33, 1, 1],
    ]);
    // Expenses are positive on their side, largest first, a tie by name.
    expect(expense?.categories.map((row) => [row.name, row.total, row.share, row.width])).toEqual([
      ["תיקונים", 300_000n, 60, 100],
      ["מסים", 100_000n, 20, 33],
      ["שכר", 100_000n, 20, 33],
    ]);
  });

  it("holds each row's lines newest first, then the biggest within a day", () => {
    expect(groups[0]?.categories[0]?.lines.map((row) => row.id)).toEqual(["l2", "l1"]);
    expect(groups[1]?.categories[0]?.lines.map((row) => row.id)).toEqual(["l4", "l3"]);
  });

  it("leaves out an empty group", () => {
    expect(companyCategoryGroups({ categories: categories.filter((row) => row.direction === "expense"), lines: [] }).map((group) => group.key)).toEqual(["out"]);
  });
});
