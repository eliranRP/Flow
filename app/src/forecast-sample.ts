import type { ExpectedMonths, MissingBill } from "@flow/shared";

/**
 * Invented sample data for FLOW-403's dev routes, stories and tests: made-up supplier names and
 * round amounts, as in the approved mockup. Never real data.
 */
export const SAMPLE_MISSING_BILLS: MissingBill[] = [
  {
    supplier_id: "s-water",
    supplier_name: "מים טובים",
    currency: "ILS",
    typical_amount_minor: -48_000n,
    typical_day: 1,
    expected_by: "2026-10-06",
    months_seen: 6,
    last_doc_date: "2026-09-01",
    project_id: null,
    category_id: null,
  },
  {
    supplier_id: "s-power",
    supplier_name: "אור חשמל",
    currency: "ILS",
    typical_amount_minor: -185_000n,
    typical_day: 2,
    expected_by: "2026-10-07",
    months_seen: 5,
    last_doc_date: "2026-09-02",
    project_id: "p1",
    category_id: null,
  },
];

export const SAMPLE_MISSING_USD: MissingBill = {
  supplier_id: "s-cloud",
  supplier_name: "ענן לדוגמה",
  currency: "USD",
  typical_amount_minor: -2_000n,
  typical_day: 3,
  expected_by: "2026-10-08",
  months_seen: 4,
  last_doc_date: "2026-09-03",
  project_id: null,
  category_id: null,
};

const party = (
  direction: "income" | "expense",
  id: string,
  name: string,
  minor: bigint,
  seen = false,
  currency = "ILS",
) => ({
  direction,
  party_id: id,
  name,
  currency,
  typical_amount_minor: direction === "expense" ? -minor : minor,
  typical_day: 5,
  months_seen: 5,
  seen_this_month: seen,
  project_id: "p1",
  category_id: null,
});

/** October open (two parties already in), November and December full. */
export const SAMPLE_EXPECTED: ExpectedMonths = {
  today: "2026-10-08",
  project_id: "p1",
  months: [
    { month: "2026-10", open: true, by_currency: [{ currency: "ILS", income_minor: 0n, expense_minor: -233_000n }] },
    { month: "2026-11", open: false, by_currency: [{ currency: "ILS", income_minor: 1_200_000n, expense_minor: -409_000n }] },
    { month: "2026-12", open: false, by_currency: [{ currency: "ILS", income_minor: 1_200_000n, expense_minor: -409_000n }] },
  ],
  recurring: [
    party("expense", "s-power", "אור חשמל", 185_000n),
    party("expense", "s-home", "בטוח בית", 126_000n, true),
    party("expense", "s-gas", "גז הצפון", 50_000n, true),
    party("expense", "s-clean", "שי ניקיון", 48_000n),
    party("income", "c-rent", "שוכר לדוגמה", 1_200_000n, true),
  ],
};

/** A second currency in every month: the row then carries a second line. */
export const SAMPLE_EXPECTED_TWO_CURRENCIES: ExpectedMonths = {
  ...SAMPLE_EXPECTED,
  months: SAMPLE_EXPECTED.months.map((month) => ({
    ...month,
    by_currency: [...month.by_currency, { currency: "USD", income_minor: 0n, expense_minor: -2_000n }],
  })),
  recurring: [...SAMPLE_EXPECTED.recurring, party("expense", "s-cloud", "ענן לדוגמה", 2_000n, false, "USD")],
};

/** The open month has nothing left: every party already came in. */
export const SAMPLE_EXPECTED_OPEN_DONE: ExpectedMonths = {
  ...SAMPLE_EXPECTED,
  months: SAMPLE_EXPECTED.months.map((month) => (month.open ? { ...month, by_currency: [] } : month)),
  recurring: SAMPLE_EXPECTED.recurring.map((row) => ({ ...row, seen_this_month: true })),
};

/** Not enough history: no recurring party yet. */
export const SAMPLE_EXPECTED_EMPTY: ExpectedMonths = {
  today: "2026-10-08",
  project_id: "p1",
  months: SAMPLE_EXPECTED.months.map((month) => ({ ...month, by_currency: [] })),
  recurring: [],
};
