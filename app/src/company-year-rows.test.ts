import { describe, expect, it } from "vitest";
import { COMPANY_YEARS_SAMPLE } from "./dev/company-years-sample";
import { allTimeYearRows, yearMonthRows, yearProjectRows, yearRowMeta } from "./company-year-rows";
import { companyYears } from "./company-years";

const data = companyYears(COMPANY_YEARS_SAMPLE.months, "USD", "2026-10-11");

describe("the year's rows", () => {
  it("months newest first; only this month's row opens, the month view", () => {
    const year = data.years.at(-1);
    if (year == null) throw new Error("no year");
    const rows = yearMonthRows(year);
    expect(rows.map((row) => row.title).slice(0, 3)).toEqual(["אוקטובר · עד היום", "ספטמבר", "אוגוסט"]);
    expect(rows[0]?.opens).toEqual({ kind: "month" });
    expect(rows.slice(1).every((row) => row.opens == null)).toBe(true);
    expect(rows.reduce((sum, row) => sum + row.profitMinor, 0n)).toBe(year.profitMinor);
  });

  it("a closed year's months open nothing", () => {
    const year = data.years[1];
    if (year == null) throw new Error("no year");
    const rows = yearMonthRows(year);
    expect(rows.map((row) => row.title)[0]).toBe("דצמבר");
    expect(rows.every((row) => row.opens == null)).toBe(true);
  });

  it("projects: each its own row, the finished ones in one, כללי, the biggest profit first, adding up to the year", () => {
    const given = COMPANY_YEARS_SAMPLE.projects["2026"];
    if (given == null) throw new Error("no projects");
    const rows = yearProjectRows(given, "USD", COMPANY_YEARS_SAMPLE.statuses);
    expect(rows.map((row) => [row.title, row.profitMinor, row.opens])).toEqual([
      ["דירת הרימון", 2_796_000n, { kind: "project", projectId: "p3" }],
      ["פרויקטים שהסתיימו · 4", 1_892_700n, null],
      ["בית הדקל", 1_820_000n, { kind: "project", projectId: "p1" }],
      ["וילה הברושים", 985_000n, { kind: "project", projectId: "p2" }],
      ["בית השקד", 214_000n, { kind: "project", projectId: "p4" }],
      ["הבית ברחוב הזית", -851_000n, { kind: "project", projectId: "p5" }],
      ["כללי", -3_229_300n, null],
    ]);
    const year = data.years.at(-1);
    expect(rows.reduce((sum, row) => sum + row.incomeMinor, 0n)).toBe(year?.incomeMinor);
    expect(rows.reduce((sum, row) => sum + row.expenseMinor, 0n)).toBe(year?.expenseMinor);
  });

  it("a row's line: both figures, or the expenses alone when nothing came in", () => {
    expect(yearRowMeta({ incomeMinor: 9_600_000n, expenseMinor: 7_780_000n }, "USD")).toBe("הכנסות $96,000 · הוצאות $77,800");
    expect(yearRowMeta({ incomeMinor: 0n, expenseMinor: 851_000n }, "USD")).toBe("הוצאות $8,510");
  });
});

describe("since the start's rows", () => {
  it("a row per year, newest first, each opening its year", () => {
    expect(allTimeYearRows(data).map((row) => [row.title, row.profitMinor, row.opens])).toEqual([
      ["2026 · עד היום", 3_627_400n, { kind: "year", year: "2026" }],
      ["2025", 4_355_000n, { kind: "year", year: "2025" }],
      ["2024", 1_670_000n, { kind: "year", year: "2024" }],
    ]);
  });
});
