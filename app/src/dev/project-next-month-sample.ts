import type { ExpectedParty, ProjectCategoryMonths } from "@flow/shared";
import type { NextMonthSample } from "../project-next-month-query";

const PROJECT = "juniper-ct";

function charge(
  partyId: string,
  name: string,
  direction: "income" | "expense",
  minor: bigint,
  day: number,
  categoryId: string,
  pace: NonNullable<ExpectedParty["pace"]> = "month",
  nextDue = "2026-11",
  paysLoan = false,
): ExpectedParty {
  return {
    direction,
    party_id: partyId,
    name,
    currency: "USD",
    typical_amount_minor: direction === "expense" ? -minor : minor,
    typical_day: day,
    months_seen: 6,
    seen_this_month: true,
    project_id: PROJECT,
    category_id: categoryId,
    pace,
    next_due_month: nextDue,
    pays_loan: paysLoan,
  };
}

function category(id: string, name: string, months: number[]): ProjectCategoryMonths["categories"][number] {
  return {
    id,
    name,
    group_name: null,
    currency: "USD",
    this_month_minor: 0,
    months_minor: months,
    months_seen: months.filter((value) => value > 0).length,
    expected_minor: null,
    typical_day: null,
    flag: null,
  };
}

/**
 * The ProfitProject card and the ProfitNext page on the board's figures (USD, cents), today 11/10/2026, so
 * next month is November: rent 1,850 + 2,300 in; out, the loan's interest 1,180 and escrow 280 and repairs
 * 310, each its category's average over April to September (repairs 1,860 / 6). The servicer's monthly
 * charge is the whole payment, 1,880 with 420 of principal: it pays a loan, so it is not a row, and its
 * interest and escrow come from their categories. A quarterly water bill is due in December, so it stays
 * out of November, and its category has no average row.
 */
export const JUNIPER_NEXT: NextMonthSample = {
  today: "2026-10-11",
  expected: {
    today: "2026-10-11",
    project_id: PROJECT,
    months: [
      { month: "2026-10", open: true, by_currency: [] },
      { month: "2026-11", open: false, by_currency: [{ currency: "USD", income_minor: 415_000n, expense_minor: -188_000n }] },
    ],
    recurring: [
      charge("s-northgate", "Northgate Mortgage", "expense", 188_000n, 4, "loan-interest", "month", "2026-11", true),
      charge("s-riverbend", "Riverbend Water", "expense", 21_000n, 18, "utilities", "quarter", "2026-12"),
      charge("c-ortiz", "M. Ortiz", "income", 185_000n, 1, "rent"),
      charge("c-kim", "S. Kim", "income", 230_000n, 3, "rent"),
    ],
  },
  categoryMonths: {
    project_id: PROJECT,
    today: "2026-10-11",
    this_month: "2026-10-01",
    months: ["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"],
    categories: [
      category("loan-interest", "ריבית הלוואות", [118_000, 118_000, 118_000, 118_000, 118_000, 118_000]),
      category("taxes", "מסים וביטוח", [28_000, 28_000, 28_000, 28_000, 28_000, 28_000]),
      category("repairs", "תיקונים ותחזוקה", [29_000, 34_000, 41_000, 24_000, 30_000, 28_000]),
      category("utilities", "מים", [0, 0, 21_000, 0, 0, 21_000]),
    ],
  },
};
