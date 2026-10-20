import type { ProfitMonth } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { COMPANY_YEARS_SAMPLE } from "./dev/company-years-sample";
import type { RestOfYear } from "./company-year-forecast";
import { allTimeChart, allTimeSub, allTimeSummaryRows, allTimeTotals, companyYears, yearChart, yearsRange, yearSub, yearSummaryRows } from "./company-years";

const TODAY = "2026-10-11";

function month(key: string, income: number, expense: number): ProfitMonth {
  return { month: key, from: `${key}-01`, to: `${key}-28`, open: false, by_currency: [{ currency: "USD", income_minor: BigInt(income), expense_minor: BigInt(-expense), profit_minor: BigInt(income - expense) }] };
}

/** A rest of the year with only the totals and months the chart reads. */
function rest(months: Array<[string, bigint, bigint]>): RestOfYear {
  const incomeMinor = months.reduce((sum, [, income]) => sum + income, 0n);
  const expenseMinor = months.reduce((sum, [, , expense]) => sum + expense, 0n);
  return { year: "2026", months: months.map(([key, income, expense]) => ({ month: key, incomeMinor: income, expenseMinor: expense })), incomeMinor, expenseMinor, netMinor: incomeMinor - expenseMinor, forecasts: [] };
}

describe("companyYears", () => {
  const data = companyYears(COMPANY_YEARS_SAMPLE.months, "USD", TODAY);

  it("groups the months since the start by year, and each year adds up to its months", () => {
    expect(data.first).toBe("2024-01");
    expect(data.years.map((year) => [year.year, year.incomeMinor, year.expenseMinor, year.profitMinor, year.months.length, year.current])).toEqual([
      ["2024", 14_860_000n, 13_190_000n, 1_670_000n, 12, false],
      ["2025", 29_140_000n, 24_785_000n, 4_355_000n, 12, false],
      ["2026", 26_222_700n, 22_595_300n, 3_627_400n, 10, true],
    ]);
    for (const year of data.years) {
      expect(year.months.reduce((sum, row) => sum + row.incomeMinor - row.expenseMinor, 0n)).toBe(year.profitMinor);
    }
  });

  it("since the start is every year summed", () => {
    expect(allTimeTotals(data)).toEqual({ incomeMinor: 70_222_700n, expenseMinor: 60_570_300n, profitMinor: 9_652_400n });
  });

  it("drops the empty months before the first line, the months after this one and other currencies", () => {
    const months = [
      month("2026-11", 500_000, 0),
      month("2026-03", 100_000, 40_000),
      month("2025-12", 0, 0),
      month("2025-06", 0, 0),
      { ...month("2025-02", 0, 0), by_currency: [{ currency: "ILS", income_minor: 900_000n, expense_minor: 0n, profit_minor: 900_000n }] },
    ];
    const result = companyYears(months, "USD", "2026-04-02");
    expect(result.first).toBe("2026-03");
    expect(result.years.map((year) => [year.year, year.months.map((row) => row.key), year.incomeMinor])).toEqual([
      ["2026", ["2026-01", "2026-02", "2026-03", "2026-04"], 100_000n],
    ]);
  });

  it("with no line at all, this year alone and empty", () => {
    const result = companyYears([], "USD", TODAY);
    expect(result.first).toBeNull();
    expect(result.years).toHaveLength(1);
    expect(result.years[0]?.profitMinor).toBe(0n);
    expect(allTimeSub(result, TODAY)).toBe("מאז אוקטובר 2026 · שנה אחת");
  });

  it("reads twenty years back at most, within the read's 240 months", () => {
    expect(yearsRange(TODAY)).toEqual({ from: "2007-01-01", to: TODAY });
    expect(yearsRange("2026-12-31")).toEqual({ from: "2007-01-01", to: "2026-12-31" });
  });
});

describe("the heads", () => {
  const data = companyYears(COMPANY_YEARS_SAMPLE.months, "USD", TODAY);
  const [y2024, y2025, y2026] = data.years;
  if (y2024 == null || y2025 == null || y2026 == null) throw new Error("the sample has three years");

  it("the subs", () => {
    expect(yearSub(y2026, TODAY)).toBe("2026 · עד היום, 11/10");
    expect(yearSub(y2025, TODAY)).toBe("2025 · שנה סגורה");
    expect(allTimeSub(data, TODAY)).toBe("מאז ינואר 2024 · 3 שנים");
  });

  it("this year's summary compares with the whole year before; the first year has none", () => {
    expect(yearSummaryRows(data, y2026).map((row) => [row.id, row.label, row.minor, row.strong])).toEqual([
      ["income", "הכנסות", 26_222_700n, false],
      ["expense", "הוצאות שנספרות ברווח", 22_595_300n, false],
      ["profit", "רווח 2026 עד היום", 3_627_400n, true],
      ["compare", "רווח 2025 כולה", 4_355_000n, false],
    ]);
    expect(yearSummaryRows(data, y2025).map((row) => row.label)).toEqual(["הכנסות", "הוצאות שנספרות ברווח", "רווח 2025", "רווח 2024 כולה"]);
    expect(yearSummaryRows(data, y2024).map((row) => row.id)).toEqual(["income", "expense", "profit"]);
  });

  it("since the start names the most profitable closed year", () => {
    expect(allTimeSummaryRows(data).map((row) => [row.label, row.minor])).toEqual([
      ["הכנסות", 70_222_700n],
      ["הוצאות שנספרות ברווח", 60_570_300n],
      ["רווח מתחילת הדרך", 9_652_400n],
      ["השנה הרווחית ביותר · 2025", 4_355_000n],
    ]);
    // A company in its first year has no closed year to name.
    expect(allTimeSummaryRows(companyYears([month("2026-02", 100, 0)], "USD", TODAY)).map((row) => row.id)).toEqual(["income", "expense", "profit"]);
  });

  it("this year's chart: January to this month, then the months left dashed", () => {
    const chart = yearChart(y2026, rest([["2026-11", 3_000_000n, 2_000_000n], ["2026-12", 2_500_000n, 2_100_000n]]), "נובמבר ודצמבר");
    expect(chart.history.map((row) => row.label)).toEqual(["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳"]);
    expect(chart.forecast.map((row) => [row.label, row.incomeMinor])).toEqual([["נוב׳", 3_000_000n], ["דצמ׳", 2_500_000n]]);
    expect(chart.sub).toBe("2026 וצפי לסוף השנה");
    expect(chart.label).toBe("הכנסות והוצאות לפי חודש ב־2026, וצפי לנובמבר ודצמבר");
  });

  it("a past year's chart is its twelve months, solid", () => {
    const chart = yearChart(y2025, null, "");
    expect(chart.history).toHaveLength(12);
    expect(chart.forecast).toEqual([]);
    expect(chart.sub).toBe("2025");
    expect(chart.label).toBe("הכנסות והוצאות לפי חודש ב־2025");
  });

  it("since the start: a pair per year, this year capped with the rest of the year", () => {
    const chart = allTimeChart(data, rest([["2026-11", 3_000_000n, 2_000_000n], ["2026-12", 2_500_000n, 2_100_000n]]), "USD");
    expect(chart.months.map((row) => [row.label, row.incomeMinor, row.ahead ?? null])).toEqual([
      ["2024", 14_860_000n, null],
      ["2025", 29_140_000n, null],
      ["2026 · צפי", 26_222_700n, { incomeMinor: 5_500_000n, expenseMinor: 4_100_000n }],
    ]);
    expect(chart.sub).toBe("מאז 2024 וצפי לסוף 2026");
    expect(chart.label).toBe("הכנסות לפי שנה: 2024 $148,600, 2025 $291,400, 2026 עד היום $262,227 וצפי לסוף השנה $317,227");
    // In December nothing is left: no cap.
    const december = allTimeChart(data, null, "USD");
    expect(december.months.at(-1)?.ahead).toBeUndefined();
    expect(december.sub).toBe("מאז 2024");
  });
});
