import type { CategoryRow, ExpectedParty, ProjectCategoryMonths } from "@flow/shared";
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

function companyCategory(id: string, name: string, kind: "expense" | "income" = "expense", loanPart: string | null = null): CategoryRow {
  return { id, name, kind, hidden: false, is_default: false, loan_part: loanPart };
}

/** The company's categories (invented names): the forecast's own, the project's other ones, and the rest. */
const CATEGORIES: CategoryRow[] = [
  companyCategory("rent", "שכירות", "income"),
  companyCategory("loan-interest", "ריבית הלוואות", "expense", "interest"),
  companyCategory("loan-principal", "קרן הלוואות", "expense", "principal"),
  companyCategory("taxes", "מסים וביטוח"),
  companyCategory("repairs", "תיקונים ותחזוקה"),
  companyCategory("power", "חשמל ומים"),
  companyCategory("property-mgmt", "ניהול נכס"),
  companyCategory("insurance", "ביטוח"),
  companyCategory("pest", "הדברה"),
  ...[
    "אחזקת גינה", "אגרות והיתרים", "ביטוח עסק", "גז", "הנהלת חשבונות", "חומרים", "ייעוץ משפטי", "ניקיון", "עבודה",
    "עמלות בנק", "פרסום", "קבלני משנה", "ריהוט", "תחבורה ודלק", "תקשורת", "אחר",
  ].map((name, index) => companyCategory(`c-${String(index)}`, name)),
  companyCategory("other-income", "הכנסה אחרת", "income"),
  companyCategory("insurance-refund", "החזר ביטוח", "income"),
  companyCategory("deposit", "פיקדון", "income"),
];

/**
 * The ProfitProject card and the ProfitNext page on the board's figures (USD, cents), today 11/10/2026, so
 * next month is November: rent 1,850 + 2,300 in; out, the loan's interest 1,180, repairs 310, escrow 280 and
 * power and water 95, each its category's average over April to September (repairs 1,860 / 6, power 570 / 6):
 * expenses 1,865, net +2,285. The servicer's monthly charge is the whole payment, 1,880 with 420 of principal:
 * it pays a loan, so it is not a row, and its interest and escrow come from their categories. Three charges are
 * not due in November and keep their categories out of the averages: pest control every quarter (next in
 * December), the property manager (November already paid) and the yearly insurance (next in April).
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
      charge("s-eastside", "Eastside Pest", "expense", 6_500n, 18, "pest", "quarter", "2026-12"),
      charge("s-harbor", "Harbor Property Co", "expense", 30_500n, 5, "property-mgmt", "month", "2026-12"),
      charge("s-pinecrest", "Pinecrest Insurance", "expense", 124_000n, 10, "insurance", "year", "2027-04"),
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
      category("repairs", "תיקונים ותחזוקה", [31_000, 34_000, 41_000, 24_000, 30_000, 26_000]),
      category("power", "חשמל ומים", [9_000, 11_000, 8_500, 9_500, 10_000, 9_000]),
      category("property-mgmt", "ניהול נכס", [30_500, 30_500, 30_500, 30_500, 30_500, 30_500]),
      category("pest", "הדברה", [0, 0, 6_500, 0, 0, 6_500]),
      category("insurance", "ביטוח", [124_000, 0, 0, 0, 0, 0]),
    ],
  },
  categories: CATEGORIES,
};

/** The ProfitNextEdited frame: repairs changed to 1,200 for November, power and water taken out, the property manager added every month. */
export const JUNIPER_NEXT_EDITED: NextMonthSample = {
  ...JUNIPER_NEXT,
  edits: [
    { id: "e-repairs", kind: "change", row_key: "avg:repairs", category_id: null, direction: null, amount_minor: 120_000, pace: "once", start_month: "2026-11" },
    { id: "e-power", kind: "remove", row_key: "avg:power", category_id: null, direction: null, amount_minor: null, pace: "once", start_month: "2026-11" },
    {
      id: "e-mgmt", kind: "add", row_key: null, category_id: "property-mgmt", category_name: "ניהול נכס", direction: "expense",
      amount_minor: 30_500, pace: "month", start_month: "2026-11",
    },
  ],
};
