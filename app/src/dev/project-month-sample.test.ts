import { describe, expect, it } from "vitest";
import { projectMonthAmount } from "../screens/project-transactions";
import { SAMPLE_MONTH_FIGURES, SAMPLE_MONTH_KEPT, SAMPLE_PROFIT_FIGURES, sampleMonthLines, sampleProfitLines } from "./project-month-sample";

// FLOW-438 (design lead, §3.7): a page's listed lines add up to its figures for the month shown.
describe("project month samples", () => {
  const month = "2026-09";

  it("cash month: the lines are the month's and make up נכנס, יצא, רווח and לא נספר ברווח", () => {
    const { counted, kept } = sampleMonthLines(month);
    const all = [...counted, ...kept];
    expect(all.every((line) => line.cash_month_date.startsWith(`${month}-`))).toBe(true);
    const signed = (line: (typeof all)[number]) => (line.side === "in" ? line.amount_minor : -line.amount_minor);
    const sum = (lines: typeof all) => lines.reduce((total, line) => total + signed(line), 0n);
    expect(all.filter((line) => line.side === "in").reduce((total, line) => total + line.amount_minor, 0n)).toBe(SAMPLE_MONTH_FIGURES.in_minor);
    expect(all.filter((line) => line.side === "out").reduce((total, line) => total + line.amount_minor, 0n)).toBe(SAMPLE_MONTH_FIGURES.out_minor);
    expect(sum(counted)).toBe(SAMPLE_MONTH_FIGURES.profit_minor);
    expect(sum(kept)).toBe(SAMPLE_MONTH_KEPT.reduce((total, row) => total + row.amount_minor, 0n));
  });

  it("profit page: the counted lines make up הכנסות and הוצאות; a kept-out line adds nothing", () => {
    const lines = sampleProfitLines(month).map(projectMonthAmount);
    const income = lines.filter((line) => line.direction === "income").reduce((total, line) => total + line.minor, 0n);
    const expenses = lines.filter((line) => line.direction === "expense").reduce((total, line) => total - line.minor, 0n);
    expect(income).toBe(SAMPLE_PROFIT_FIGURES.income_minor);
    expect(expenses).toBe(SAMPLE_PROFIT_FIGURES.direct_minor);
    expect(income - expenses).toBe(SAMPLE_PROFIT_FIGURES.profit_minor);
  });
});
