import type { Breakdown, ProfitMonth } from "@flow/shared";
import type { CompanyYearsSample } from "../company-years-query";

/**
 * FLOW-145 fixture: the company profit sample's months since the start (invented, USD cents), the board's Profit ·
 * 2026 and Profit · מההתחלה figures. January 2024 is the first month; 2024 is 148,600 in and 131,900 out, 2025
 * 291,400 and 247,850 (its best year, +43,550), and 2026 to date 262,227 and 225,953 (+36,274, the month view's
 * רווח מתחילת השנה, with October the page's own month), so since the start is 702,227 and 605,703 (+96,524).
 * The two closed years are spread over their months by fixed weights, the remainder in December. The projects
 * of 2026 and 2025 add up to those years; four finished projects fold into one row.
 */

const WEIGHTS_IN = [0.07, 0.07, 0.08, 0.08, 0.09, 0.09, 0.09, 0.09, 0.08, 0.09, 0.09, 0.08];
const WEIGHTS_OUT = [0.08, 0.08, 0.08, 0.08, 0.08, 0.09, 0.09, 0.09, 0.08, 0.08, 0.09, 0.08];

/** A whole year's dollars over its months, in cents; December takes what rounding leaves. */
function spread(dollars: number, weights: readonly number[]): number[] {
  const cents = weights.map((weight) => Math.round(dollars * weight) * 100);
  cents[11] = (cents[11] ?? 0) + dollars * 100 - cents.reduce((sum, value) => sum + value, 0);
  return cents;
}

const YEARS: Record<string, { income: number[]; expense: number[] }> = {
  "2024": { income: spread(148_600, WEIGHTS_IN), expense: spread(131_900, WEIGHTS_OUT) },
  "2025": { income: spread(291_400, WEIGHTS_IN), expense: spread(247_850, WEIGHTS_OUT) },
  // January to October 2026; May to October are the month view's chart months, October to date.
  "2026": {
    income: [3_410_000, 1_980_000, 3_650_000, 2_840_000, 2_140_000, 3_015_000, 2_780_000, 2_630_000, 1_290_000, 2_487_700],
    expense: [2_217_960, 1_745_000, 2_172_000, 1_931_000, 2_300_000, 1_784_000, 1_880_400, 1_971_800, 3_762_000, 2_831_140],
  },
};

function profitMonth(month: string, income: number, expense: number): ProfitMonth {
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return {
    month,
    from: `${month}-01`,
    to: month === "2026-10" ? "2026-10-11" : `${month}-${String(last)}`,
    open: month === "2026-10",
    by_currency: [{ currency: "USD", income_minor: BigInt(income), expense_minor: BigInt(-expense), profit_minor: BigInt(income - expense) }],
  };
}

/** Every month since January 2024, newest first, as get_profit_months returns them. */
const MONTHS: ProfitMonth[] = Object.entries(YEARS)
  .flatMap(([year, figures]) => figures.income.map((income, index) => profitMonth(`${year}-${String(index + 1).padStart(2, "0")}`, income, figures.expense[index] ?? 0)))
  .reverse();

type ProjectYear = [key: string, name: string | null, dollarsIn: number, dollarsOut: number];

function breakdown(direction: "income" | "expense", year: string, rows: readonly ProjectYear[]): Breakdown {
  const groups = rows
    .map(([key, name, dollarsIn, dollarsOut]) => ({ key, name, amount: (direction === "income" ? dollarsIn : dollarsOut) * 100 }))
    .filter((row) => row.amount > 0)
    // As get_breakdown: the general costs are `overhead` with no name; `shared` marks a project holding a share of
    // a shared cost (the first project's expenses here).
    .map((row) => ({ currency: "USD", key: row.key, name: row.name, shared: direction === "expense" && row.key === "p1", amount_minor: BigInt(row.amount), count: 1, projects: row.key === "overhead" ? 0 : 1 }));
  const total = groups.reduce((sum, group) => sum + group.amount_minor, 0n);
  return {
    direction,
    basis: "cash",
    group_by: "project",
    from: `${year}-01-01`,
    to: year === "2026" ? "2026-10-11" : `${year}-12-31`,
    totals: [{ currency: "USD", amount_minor: total, count: groups.length }],
    groups,
    excluded: [],
    review_count: 0,
  };
}

// 2026 to date: 262,227 in and 225,953 out.
const PROJECTS_2026: ProjectYear[] = [
  ["p1", "בית הדקל", 96_000, 77_800],
  ["p2", "וילה הברושים", 42_900, 33_050],
  ["p3", "דירת הרימון", 49_800, 21_840],
  ["p4", "בית השקד", 4_000, 3_460],
  ["p5", "הבית ברחוב הזית", 0, 8_510],
  ["f1", "מחסן התאנה", 17_000, 12_000],
  ["f2", "דירת הגפן", 20_000, 15_000],
  ["f3", "בית הערבה", 15_927, 11_000],
  ["f4", "חנות האלון", 15_000, 11_000],
  ["overhead", null, 0, 32_293],
  // The overhead project's own income (its id group); the page sums it with `overhead` into one row.
  ["p0", "משרד החברה / תקורה", 1_600, 0],
];

// 2025: 291,400 in and 247,850 out.
const PROJECTS_2025: ProjectYear[] = [
  ["p1", "בית הדקל", 150_000, 120_000],
  ["p3", "דירת הרימון", 80_000, 60_000],
  ["f1", "מחסן התאנה", 61_400, 40_000],
  ["overhead", null, 0, 27_850],
];

export const COMPANY_YEARS_SAMPLE: CompanyYearsSample = {
  months: MONTHS,
  projects: {
    "2026": { income: breakdown("income", "2026", PROJECTS_2026), expense: breakdown("expense", "2026", PROJECTS_2026) },
    "2025": { income: breakdown("income", "2025", PROJECTS_2025), expense: breakdown("expense", "2025", PROJECTS_2025) },
  },
  statuses: [
    ...["p1", "p2", "p3", "p4", "p5"].map((id) => ({ id, status: "active" })),
    ...["f1", "f2", "f3", "f4"].map((id) => ({ id, status: "finished" })),
  ],
};
