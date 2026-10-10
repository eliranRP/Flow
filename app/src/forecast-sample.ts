import type { ExpectedMonths, MissingBill, RecurringChange } from "@flow/shared";

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
    project_id: "p2",
    project_name: "שיפוץ הרצל 12",
    category_id: "c-water",
    category_name: "מים",
    direction: "expense",
    party_id: "s-water",
    party_name: "מים טובים",
    pace: "month",
    due_month: "2026-10",
    alert_key: "expense:00000000-0000-4000-8000-000000000001:ILS:2026-10",
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
    last_amount_minor: -184_000n,
    project_id: "p1",
    project_name: "בניין הדקל",
    category_id: "c-power",
    category_name: "חשמל",
    source: "auto",
    direction: "expense",
    party_id: "s-power",
    party_name: "אור חשמל",
    pace: "month",
    due_month: "2026-10",
    alert_key: "expense:00000000-0000-4000-8000-000000000002:ILS:2026-10",
  },
];

/** FLOW-415 (b-2): a late payment from a customer, invented. */
export const SAMPLE_MISSING_INCOME: MissingBill = {
  supplier_id: null,
  supplier_name: "",
  direction: "income",
  party_id: "c-rent",
  party_name: "שוכר לדוגמה",
  currency: "ILS",
  typical_amount_minor: 650_000n,
  typical_day: 5,
  expected_by: "2026-10-10",
  months_seen: 8,
  last_doc_date: "2026-09-05",
  project_id: "p1",
  project_name: "בניין הדקל",
  category_id: null,
  category_name: null,
  pace: "month",
  due_month: "2026-10",
  alert_key: "income:00000000-0000-4000-8000-000000000003:ILS:2026-10",
};

/**
 * FLOW-430: an invented water bill whose October charge came in under a longer name, so the row
 * suggests that supplier.
 */
export const SAMPLE_MISSING_RENAMED: MissingBill = {
  supplier_id: "s-river",
  supplier_name: "Riverside Water",
  direction: "expense",
  party_id: "s-river",
  party_name: "Riverside Water",
  currency: "USD",
  typical_amount_minor: -4_200n,
  typical_day: 4,
  expected_by: "2026-10-09",
  months_seen: 6,
  last_doc_date: "2026-09-04",
  project_id: "p2",
  project_name: "שיפוץ הרצל 12",
  category_id: "c-water",
  category_name: "מים",
  pace: "month",
  due_month: "2026-10",
  alert_key: "expense:00000000-0000-4000-8000-000000000004:USD:2026-10",
  suggestion: {
    party_id: "s-river-works",
    party_name: "Riverside Water Works",
    transaction_id: "t-river-oct",
    doc_date: "2026-10-06",
    amount_minor: -5_779n,
  },
};

/** FLOW-415: invented recurring charges off their usual amount, for Home's rows. */
export const SAMPLE_RECURRING_CHANGES: RecurringChange[] = [
  {
    supplier_id: "s-power",
    supplier_name: "אור חשמל",
    currency: "ILS",
    amount_minor: -255_000n,
    typical_amount_minor: -185_000n,
    change_percent: 38,
    typical_day: 4,
    transaction_id: "t-power-oct",
    project_id: "p1",
    project_name: "בניין הדקל",
    category_id: "c-power",
    category_name: "חשמל",
    source: "auto",
    direction: "expense",
    party_id: "s-power",
    party_name: "אור חשמל",
    changed: true,
    pace: "month",
    alert_key: "t-power-oct",
  },
];

/** FLOW-415 (b-2): הגיעו החודש, invented: the changed power bill, two steady charges and the rent. */
export const SAMPLE_RECURRING_THIS_MONTH: RecurringChange[] = [
  ...SAMPLE_RECURRING_CHANGES,
  {
    supplier_id: "s-arnona",
    supplier_name: "ארנונה עירונית",
    direction: "expense",
    party_id: "s-arnona",
    party_name: "ארנונה עירונית",
    currency: "ILS",
    amount_minor: -132_000n,
    typical_amount_minor: -130_000n,
    change_percent: 2,
    changed: false,
    typical_day: 1,
    transaction_id: "t-arnona-oct",
    project_id: "p2",
    project_name: "שיפוץ הרצל 12",
    category_id: null,
    category_name: null,
    source: "auto",
    pace: "2months",
    alert_key: "t-arnona-oct",
  },
  {
    supplier_id: "s-insure",
    supplier_name: "ביטוח דוגמה",
    direction: "expense",
    party_id: "s-insure",
    party_name: "ביטוח דוגמה",
    currency: "ILS",
    amount_minor: -41_000n,
    typical_amount_minor: -41_000n,
    change_percent: 0,
    changed: false,
    typical_day: 1,
    transaction_id: "t-insure-oct",
    project_id: null,
    project_name: null,
    category_id: "c-insure",
    category_name: "ביטוח",
    source: "user",
    pace: "month",
    alert_key: "t-insure-oct",
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
    party("expense", "s-gas", "גז לדוגמה", 50_000n, true),
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
