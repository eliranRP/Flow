import type { CashMonths, ProjectDetail } from "@flow/shared";
import { shiftMonthKey } from "../period";
import type { InvestmentFigures } from "../ui/investment-card";
import { israelToday } from "../ui/date-math";
import { SAMPLE_PROFIT_FIGURES, sampleProfitLines } from "./project-month-sample";

/**
 * The project page's cash-first sample, shared by the stories and the proof build (dev route
 * /e2e/project-detail). USD, invented names; the figures follow the board's flip frame (Lark Hill,
 * the month's net −$14,253.42, a $75,000 budget with $61,300 spent).
 */

export function cashRow(inMinor: bigint, outMinor: bigint, profit: bigint, currency = "USD") {
  return {
    currency,
    in_minor: inMinor,
    out_minor: outMinor,
    net_minor: inMinor - outMinor,
    profit_minor: profit,
    excluded_count: 0,
    excluded_in_minor: 0n,
    excluded_out_minor: 0n,
    not_in_profit_categories: [] as { name: string; amount_minor: bigint }[],
  };
}

export const thisMonth = israelToday().slice(0, 7);

export function months(rows: ReturnType<typeof cashRow>[][], base = "USD"): NonNullable<CashMonths> {
  const current = israelToday().slice(0, 7);
  return {
    basis: "paid",
    base_currency: base,
    months: rows.map((byCurrency, back) => ({ month: `${shiftMonthKey(current, -back)}-01`, by_currency: byCurrency })),
  };
}

export const cash = months([
  [cashRow(0n, 1_425_342n, -1_425_342n)],
  [cashRow(0n, 19_000n, -19_000n)],
  [cashRow(115_000n, 0n, 115_000n)],
  [cashRow(98_000n, 0n, 98_000n)],
]);
// This month's net less its profit (לא נספר ברווח, FLOW-418): the owner's money put into the project.
const currentRow = cash.months[0]?.by_currency[0];
if (currentRow) currentRow.not_in_profit_categories = [{ name: "השקעת בעלים", amount_minor: 107_000n }];

export const project: NonNullable<ProjectDetail> = {
  id: "p-c",
  name: "Lark Hill",
  status: "active",
  state_label: "flip • בשיפוץ",
  budget_agorot: 7_500_000n,
  base_currency: "USD",
  income_agorot: 0n,
  // The budget's spent: $61,300 of the $75,000 budget (82%), the board's flip frame.
  direct_agorot: 6_130_000n,
  shared_agorot: 0n,
  profit_agorot: 0n,
  by_currency: [{ currency: "USD", ...SAMPLE_PROFIT_FIGURES, shared_minor: 0n }],
  categories: [],
  pending_count: 0,
  pending_agorot: 0n,
  // FLOW-438: the profit page lists these under its figures; they add up to them.
  transactions: sampleProfitLines(thisMonth),
  loans: [{ id: "l1", name: "הלוואת DSCR לדוגמה", currency: "USD", balance_minor: 21_000_000n, status: "open" }],
};

/** A dollar project's investment, so the row's figure is in the project's currency. */
export const usdFigures: InvestmentFigures = {
  currency: "USD",
  purchaseMinor: 18_500_000n,
  arvMinor: 31_000_000n,
  valueMinor: 31_000_000n,
  valueDate: "2026-10-01",
  rehabMinor: 6_130_000n,
  rehabOther: [],
  loanMinor: 21_000_000n,
  loanOther: [],
  forcedEquityMinor: 6_370_000n,
  currentEquityMinor: 10_000_000n,
};
export const investment = { isOverhead: false, figures: usdFigures, categories: [], loans: [] };
