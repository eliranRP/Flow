import { describe, expect, it } from "vitest";
import { cashTakeaway, chartHistory, chartLabel, chartSub, expenseNote, forecastChartMonth, incomeNote } from "./next-month-chart";
import type { MonthFigures } from "./month-figures";
import type { NextMonthRow } from "./project-next-month";

function figures(entries: [string, number, number][]): Map<string, MonthFigures> {
  return new Map(entries.map(([key, income, expense]) => [key, { incomeMinor: BigInt(income), expenseMinor: BigInt(expense) }]));
}

function row(kind: NextMonthRow["kind"], minor: bigint, categoryId: string | null = null, name = "שורה"): NextMonthRow {
  return { key: `${kind}:${name}`, kind, direction: minor > 0n ? "income" : "expense", name, date: null, minor, categoryId, wasMinor: null, pace: null };
}

const CATEGORIES = [{ id: "rent", name: "שכירות" }, { id: "other", name: "הכנסה אחרת" }];

const SIX = figures([["2026-05", 415_000, 180_000], ["2026-06", 415_000, 187_000], ["2026-07", 415_000, 170_000], ["2026-08", 415_000, 176_000], ["2026-09", 415_000, 174_000], ["2026-10", 630_200, 250_640]]);

describe("the chart's history", () => {
  it("holds the current month and the five before it, oldest first", () => {
    const history = chartHistory("2026-10", SIX, "2025-03");
    expect(history.months.map((month) => month.label)).toEqual(["מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳"]);
    expect(history.fromStart).toBe(false);
    expect(chartSub(history, true)).toBe("מאי עד אוקטובר וצפי");
  });

  it("starts at the project's first month, keeping its empty months, and says מתחילת הפרויקט", () => {
    const history = chartHistory("2026-10", figures([["2026-07", 0, 18_500_000], ["2026-10", 0, 1_425_342]]), "2026-07");
    expect(history.months.map((month) => [month.key, month.expenseMinor])).toEqual([["2026-07", 18_500_000n], ["2026-08", 0n], ["2026-09", 0n], ["2026-10", 1_425_342n]]);
    expect(history.fromStart).toBe(true);
    expect(chartSub(history, true)).toBe("מתחילת הפרויקט וצפי");
    expect(chartSub(history, false)).toBe("מתחילת הפרויקט");
  });

  it("without the first month, drops the empty months at the window's start, never the current one", () => {
    expect(chartHistory("2026-10", figures([["2026-08", 1_640_000, 0], ["2026-10", 0, 0]]), null).months.map((month) => month.key)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(chartHistory("2026-10", new Map(), null).months.map((month) => month.key)).toEqual(["2026-10"]);
  });

  it("crosses a year", () => {
    expect(chartHistory("2027-02", new Map(), "2020-01").months.map((month) => month.key)).toEqual(["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("speaks every month's two figures, then next month's as the forecast (FLOW-961)", () => {
    const ahead = forecastChartMonth({ month: "2026-11", incomeMinor: 415_000n, expenseMinor: 186_500n });
    expect(ahead.label).toBe("נוב׳ · צפי");
    const history = chartHistory("2026-10", SIX, null);
    const months = "מאי: הכנסות $4,150, הוצאות $1,800. יוני: הכנסות $4,150, הוצאות $1,870. יולי: הכנסות $4,150, הוצאות $1,700. אוגוסט: הכנסות $4,150, הוצאות $1,760. ספטמבר: הכנסות $4,150, הוצאות $1,740. אוקטובר: הכנסות $6,302, הוצאות $2,506";
    expect(chartLabel(history, ahead, "USD")).toBe(`הכנסות והוצאות לפי חודש, מאי עד אוקטובר. ${months}. צפי נובמבר: הכנסות $4,150, הוצאות $1,865`);
    expect(chartLabel(history, null, "USD")).toBe(`הכנסות והוצאות לפי חודש, מאי עד אוקטובר. ${months}`);
    expect(chartLabel(history, null, "USD", "profit", "הכנסות והוצאות של החברה")).toMatch(/^הכנסות והוצאות של החברה, מאי עד אוקטובר\. מאי: /);
    // A cash view (the project page) says נכנס and יצא.
    expect(chartLabel(history, ahead, "USD", "cash")).toMatch(/^נכנס ויצא לפי חודש, מאי עד אוקטובר\. מאי: נכנס \$4,150, יצא \$1,800\. .* צפי נובמבר: נכנס \$4,150, יצא \$1,865$/);
  });

  it("titles the project chart with the month's takeaway (FLOW-961)", () => {
    const one = (incomeMinor: number, expenseMinor: number) => chartHistory("2026-10", figures([["2026-10", incomeMinor, expenseMinor]]), "2026-10");
    expect(cashTakeaway(one(0, 1_425_342), "USD")).toBe("אוקטובר: יצא $14,253 יותר משנכנס");
    expect(cashTakeaway(one(1_500_000, 0), "USD")).toBe("אוקטובר: נכנס $15,000 יותר משיצא");
    expect(cashTakeaway(one(0, 0), "USD")).toBe("אוקטובר: לא נכנס ולא יצא כסף");
    expect(cashTakeaway(one(10_000, 10_000), "USD")).toBe("אוקטובר: נכנס בדיוק מה שיצא");
    expect(cashTakeaway({ months: [], fromStart: false }, "USD")).toBeNull();
  });
});

describe("the card's captions", () => {
  it("names recurring rent, other recurring income, a single line, or the count", () => {
    expect(incomeNote({ rows: [row("recurring", 185_000n, "rent", "א"), row("recurring", 230_000n, "rent", "ב"), row("average", -31_000n)] }, CATEGORIES)).toBe("2 שכירויות קבועות");
    expect(incomeNote({ rows: [row("recurring", 185_000n, "rent")] }, CATEGORIES)).toBe("שכירות קבועה אחת");
    expect(incomeNote({ rows: [row("recurring", 185_000n, "rent", "א"), row("recurring", 9_000n, "other", "ב")] }, CATEGORIES)).toBe("2 הכנסות קבועות");
    expect(incomeNote({ rows: [row("recurring", 9_000n, null)] }, CATEGORIES)).toBe("הכנסה קבועה אחת");
    expect(incomeNote({ rows: [row("added", 1_250_000n, "other", "תשלום מהלקוח")] }, CATEGORIES)).toBe("תשלום מהלקוח");
    expect(incomeNote({ rows: [row("added", 1_250_000n, "other", "א"), row("recurring", 9_000n, "rent", "ב")] }, CATEGORIES)).toBe("2 הכנסות צפויות");
    // A sub-category of שכירות is rent too, whatever its own name.
    const units = [...CATEGORIES, { id: "unit-a", name: "דירה א", parent_id: "rent" }];
    expect(incomeNote({ rows: [row("recurring", 185_000n, "unit-a", "א"), row("recurring", 230_000n, "rent", "ב")] }, units)).toBe("2 שכירויות קבועות");
  });

  it("says when no income is expected (a flip before its sale)", () => {
    expect(incomeNote({ rows: [row("average", -1_200_000n)] }, CATEGORIES)).toBe("אין הכנסה צפויה");
  });

  it("sets next month's expenses against the last full month's on the page's own history", () => {
    const history = chartHistory("2026-10", SIX, null);
    const forecast = { month: "2026-11", rows: [row("average", -186_500n)], expenseMinor: 186_500n };
    expect(expenseNote(forecast, history, "USD")).toBe("מול $1,740 בספטמבר");
    expect(expenseNote({ ...forecast, rows: [row("recurring", 415_000n)], expenseMinor: 0n }, history, "USD")).toBe("אין הוצאות צפויות");
  });

  it("counts the expected expenses when the project has no full month yet", () => {
    const young = chartHistory("2026-10", figures([["2026-10", 0, 50_000]]), "2026-10");
    expect(expenseNote({ month: "2026-11", rows: [row("average", -50_000n, null, "א"), row("added", -9_000n, null, "ב")], expenseMinor: 59_000n }, young, "USD")).toBe("2 הוצאות צפויות");
    expect(expenseNote({ month: "2026-11", rows: [row("added", -9_000n)], expenseMinor: 9_000n }, young, "USD")).toBe("הוצאה צפויה אחת");
    // In cash terms (decision 0196) a loan's principal is an expense no row holds: one more.
    expect(expenseNote({ month: "2026-11", rows: [row("added", -9_000n)], expenseMinor: 51_000n }, young, "USD")).toBe("2 הוצאות צפויות");
  });
});
