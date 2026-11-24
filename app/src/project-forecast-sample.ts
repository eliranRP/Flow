/**
 * FLOW-1315: an invented answer of `project_forecast` (the database's JSON, absent = null) for the tests of the project page's
 * read: one project, November 2026 from 2026-10-20, in dollars. Two recurring rents, a power bill, two average rows, no loan. The
 * totals are the rows': income 4,150.00, expense 435.00, net 3,715.00.
 */
export const SAMPLE_TODAY = "2026-10-20";
export const SAMPLE_MONTH = "2026-11";

export function sampleProjectForecastAnswer(): Record<string, unknown> {
  return {
    today: SAMPLE_TODAY,
    month: SAMPLE_MONTH,
    currency: "USD",
    general: false,
    income_minor: 415_000,
    expense_minor: 43_500,
    net_minor: 371_500,
    cash_only_minor: 0,
    cash_expense_minor: 43_500,
    cash_net_minor: 371_500,
    loan_count: 0,
    average_months: 6,
    income: { rows: 2, recurring: 2, rent: 2 },
    rows: [
      { key: "rec:income:ortiz", kind: "recurring", direction: "income", name: "M. Ortiz", date: "2026-11-01", minor: 185_000, category_id: "rent" },
      { key: "rec:income:kim", kind: "recurring", direction: "income", name: "S. Kim", date: "2026-11-03", minor: 230_000, category_id: "rent" },
      { key: "rec:expense:power", kind: "recurring", direction: "expense", name: "Example Power", date: "2026-11-15", minor: -9_500, category_id: "power" },
      { key: "avg:repairs", kind: "average", direction: "expense", name: "תיקונים", minor: -31_000, category_id: "repairs" },
      { key: "avg:none", kind: "average", direction: "expense", name: "אחר", minor: -3_000 },
    ],
    removed: [],
    skipped: [],
    edited: false,
    overrides: [],
    history: {
      months: ["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"],
      categories: [
        { id: "repairs", currency: "USD", months_minor: [31_000, 34_000, 41_000, 24_000, 30_000, 26_000] },
        { id: "power", currency: "USD", months_minor: [9_000, 11_000, 8_500, 9_500, 10_000, 9_000] },
        // The uncategorized row has no id in the answer.
        { currency: "USD", months_minor: [0, 0, 6_000, 0, 0, 12_000] },
      ],
    },
    charges: [{ category_id: "power", amount_minor: 9_500, pace: "month" }],
  };
}
