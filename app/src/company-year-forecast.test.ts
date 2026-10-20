import type { ExpectedParty } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { companyNextMonthForecast, type CompanyNextMonthInputs } from "./company-next-month";
import { companyRestOfYear, restExpenseNote, restIncomeNote, restMonthsCaption, restOfYearMonths } from "./company-year-forecast";

/**
 * FLOW-145: the rest of the year is next month's company forecast built again for each month left, by the same
 * rules. Invented figures, USD cents, today 11/10/2026: one rental and the general costs.
 */

const TODAY = "2026-10-11";

function charge(partyId: string, projectId: string | null, categoryId: string, direction: "income" | "expense", minor: bigint, pace: ExpectedParty["pace"], due: string): ExpectedParty {
  return {
    direction,
    party_id: partyId,
    name: partyId,
    currency: "USD",
    typical_amount_minor: direction === "income" ? minor : -minor,
    typical_day: 5,
    months_seen: 6,
    seen_this_month: true,
    project_id: projectId,
    category_id: categoryId,
    pace,
    next_due_month: due,
    pays_loan: false,
  };
}

const CATEGORIES = [
  { id: "c-rent", name: "שכירות", loan_part: null, excluded_from_pnl: false },
  { id: "c-other", name: "הכנסה אחרת", loan_part: null, excluded_from_pnl: false },
  { id: "c-insurance", name: "ביטוח", loan_part: null, excluded_from_pnl: false },
  { id: "c-repairs", name: "תיקונים", loan_part: null, excluded_from_pnl: false },
  { id: "c-payroll", name: "שכר", loan_part: null, excluded_from_pnl: false },
  { id: "c-accounting", name: "הנהלת חשבונות", loan_part: null, excluded_from_pnl: false },
];

// Rent of $1,000 every month; the building's insurance, $300 a quarter, next due in December; payroll $2,000.
const RECURRING: ExpectedParty[] = [
  charge("s-rent", "p1", "c-rent", "income", 100_000n, "month", "2026-11"),
  charge("s-insurance", "p1", "c-insurance", "expense", 30_000n, "quarter", "2026-12"),
  charge("s-payroll", null, "c-payroll", "expense", 200_000n, "month", "2026-11"),
];

const INPUTS: CompanyNextMonthInputs = {
  month: "2026-11",
  overhead_project_id: null,
  // Repairs average $600 a month on the rental; the accountant $100 a month in the general costs.
  projects: [{ project_id: "p1", categories: [{ id: "c-repairs", name: "תיקונים", currency: "USD", months_minor: [60_000, 60_000, 60_000, 60_000, 60_000, 60_000] }] }],
  general: [{ id: "c-accounting", name: "הנהלת חשבונות", currency: "USD", months_minor: [10_000, 10_000, 10_000, 10_000, 10_000, 10_000] }],
  edits: [
    // November's repairs are set to $400, that month only.
    { id: "e-repairs", project_id: "p1", kind: "change", row_key: "avg:c-repairs", category_id: null, direction: null, amount_minor: 40_000, pace: "once", start_month: "2026-11" },
    // $50 of other income every month from November; November's already came in.
    { id: "e-extra", project_id: "p1", kind: "add", row_key: null, category_id: "c-other", category_name: "הכנסה אחרת", direction: "income", amount_minor: 5_000, pace: "month", start_month: "2026-11", matched_transaction_id: "t-extra" },
  ],
};

const input = { currency: "USD", today: TODAY, recurring: RECURRING, loans: [], categories: CATEGORIES, inputs: INPUTS };

describe("restOfYearMonths", () => {
  it("next month to December of the same year; none in December", () => {
    expect(restOfYearMonths(TODAY)).toEqual(["2026-11", "2026-12"]);
    expect(restOfYearMonths("2026-01-31")).toHaveLength(11);
    expect(restOfYearMonths("2026-11-30")).toEqual(["2026-12"]);
    expect(restOfYearMonths("2026-12-01")).toEqual([]);
  });
});

describe("companyRestOfYear", () => {
  const rest = companyRestOfYear(input);
  if (rest == null) throw new Error("two months are left");

  it("November is next month's company forecast, exactly as the month view's card", () => {
    const next = companyNextMonthForecast(input);
    expect(rest.months[0]).toEqual({ month: "2026-11", incomeMinor: next.incomeMinor, expenseMinor: next.expenseMinor });
    // Rent in ($50 already came); repairs as edited, payroll and the accountant out.
    expect(rest.months[0]).toEqual({ month: "2026-11", incomeMinor: 100_000n, expenseMinor: 40_000n + 200_000n + 10_000n });
  });

  it("December: the quarterly charge falls due, a once edit no longer applies, a monthly one is expected again", () => {
    expect(rest.months[1]).toEqual({ month: "2026-12", incomeMinor: 100_000n + 5_000n, expenseMinor: 60_000n + 30_000n + 200_000n + 10_000n });
  });

  it("the totals add up to the months", () => {
    expect(rest.incomeMinor).toBe(205_000n);
    expect(rest.expenseMinor).toBe(550_000n);
    expect(rest.netMinor).toBe(-345_000n);
    expect(rest.year).toBe("2026");
  });

  it("the card's captions", () => {
    expect(restMonthsCaption(rest)).toBe("נובמבר ודצמבר");
    // Each stream once, however many months it comes in.
    expect(restIncomeNote(rest, CATEGORIES)).toBe("שכירות אחת והכנסה אחת");
    expect(restExpenseNote(rest)).toBe("קבועים וממוצעים");
    expect(restExpenseNote({ expenseMinor: 0n })).toBe("אין הוצאות צפויות");
    expect(restMonthsCaption({ months: [{ month: "2026-12", incomeMinor: 0n, expenseMinor: 0n }] })).toBe("דצמבר");
    expect(restMonthsCaption({ months: ["2026-03", "2026-04", "2026-05"].map((month) => ({ month, incomeMinor: 0n, expenseMinor: 0n })) })).toBe("מרץ עד מאי");
  });

  it("nothing is left in December", () => {
    expect(companyRestOfYear({ ...input, today: "2026-12-02", inputs: { ...INPUTS, month: "2027-01" } })).toBeNull();
  });
});
