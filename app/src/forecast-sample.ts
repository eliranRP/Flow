import { buildMonthForecast, expectedMonthsSchema, type ForecastOverrideRow, type MissingBill, type RecurringChange, unpaidRowSchema } from "@flow/shared";
import type { MonthFigures } from "./month-figures";
import type { ForecastSoFar } from "./screens/forecast-categories";
import type { ForecastSample as MonthForecastSampleShape } from "./screens/forecast-screen";

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

/** A chart's cash months in whole units, oldest first: [yyyy-mm, נכנס, יצא]. */
function cashMonths(rows: ReadonlyArray<readonly [string, number, number]>): Map<string, MonthFigures> {
  return new Map(rows.map(([key, income, expense]) => [key, { incomeMinor: BigInt(income) * 100n, expenseMinor: BigInt(expense) * 100n }]));
}

/**
 * FLOW-141: invented month-end forecast data for stories. Payees are placeholders and amounts are
 * round. `kind` picks the state: a positive month, a negative one, or one item moved to next month.
 */
export type ForecastSampleKind = "positive" | "negative" | "moved";

export function monthForecastSample(kind: ForecastSampleKind): MonthForecastSampleShape {
  const today = "2026-10-16";
  const expected = {
    today,
    project_id: null,
    months: [{ month: "2026-10", open: true, by_currency: [{ currency: "ILS", income_minor: 0, expense_minor: 0 }] }],
    recurring: [
      { direction: "expense", party_id: "rent", name: "ספק לדוגמה א׳", currency: "ILS", typical_amount_minor: -420000, typical_day: 1, months_seen: 6, seen_this_month: false },
      { direction: "expense", party_id: "tools", name: "ספק לדוגמה ב׳", currency: "ILS", typical_amount_minor: -180000, typical_day: 8, months_seen: 6, seen_this_month: false },
      { direction: "expense", party_id: "coffee", name: "ספק לדוגמה ג׳", currency: "ILS", typical_amount_minor: -4500, typical_day: 12, months_seen: 6, seen_this_month: false },
      { direction: "income", party_id: "retainer", name: "לקוח לדוגמה", currency: "ILS", typical_amount_minor: 650000, typical_day: 20, months_seen: 5, seen_this_month: false },
    ],
  };
  const unpaid = [
    { id: "inv-1", description: "חשבונית לדוגמה", doc_date: "2026-10-02", project_name: null, customer_name: "לקוח לדוגמה ד׳", open_gross_agorot: 250000, open_net_agorot: 250000, currency: "ILS" },
  ];
  const overrides: ForecastOverrideRow[] = kind === "negative"
    ? [{ item_key: "party:expense:rent:ILS", amount_minor: 480000, due_on: null, moved_out: false }]
    : kind === "moved"
      ? [{ item_key: "invoice:inv-1", amount_minor: null, due_on: null, moved_out: true }]
      : [];
  const build = buildMonthForecast({
    base: "ILS",
    expected: expectedMonthsSchema.parse(expected),
    unpaid: unpaidRowSchema.array().parse(unpaid),
    overrides,
  });
  // October so far adds up to today's net: in minus out.
  const october: readonly [string, number, number] = kind === "negative" ? ["2026-10", 21_800, 23_300] : ["2026-10", 24_500, 23_300];
  return {
    today,
    net: kind === "negative" ? -150000n : 120000n,
    data: { month: "2026-10", base: "ILS", build, overrides },
    months: cashMonths([["2026-05", 26_000, 22_400], ["2026-06", 27_500, 25_100], ["2026-07", 25_800, 26_900], ["2026-08", 28_200, 24_600], ["2026-09", 26_400, 25_700], october]),
  };
}

/**
 * `board` is the MonthForecast frame; `changed` moves its largest invoice to next month (the
 * MonthForecastChanged frame); `empty` has nothing left to arrive (StatesForecastEmpty); `category` opens
 * לפי קטגוריה with the rent category open (MonthForecastCategory); `failed` is the forecast's failed read and
 * `offline` the board's figures from 09:41 with no connection (FLOW-970).
 */
export type BoardForecastVariant = "board" | "changed" | "empty" | "category" | "failed" | "offline";

/** 09:41 Israel time on the board's day: the moment the offline frame's figures are from. */
const BOARD_OFFLINE_SINCE = Date.parse("2026-10-11T06:41:00Z");

/**
 * FLOW-141: the dev fixture that matches the board frames: an invented USD company with the same
 * parties, invoices and count of small charges. Its amounts are the board's, except the six small
 * charges, which total less than the board's (each one is under the 100 units rule).
 */
export function monthForecastBoardSample(variant: BoardForecastVariant = "board"): MonthForecastSampleShape {
  const empty = variant === "empty";
  const today = empty ? "2026-10-30" : "2026-10-11";
  const small = [
    ["Streaming", 8700],
    ["Cloud storage", 8700],
    ["Phone line", 8700],
    ["Domain", 8700],
    ["Password manager", 8700],
    ["Accounting app", 8700],
    ["Backup drive", 8700],
    ["Video calls", 8700],
    ["Design fonts", 8700],
    ["Mail tool", 8700],
    ["Scanner plan", 9200],
  ] as const;
  const expected = {
    today,
    project_id: null,
    months: [{ month: "2026-10", open: true, by_currency: [{ currency: "USD", income_minor: 0, expense_minor: 0 }] }],
    recurring: empty ? [] : [
      ...small.map(([name, minor], index) => ({
        direction: "expense" as const,
        party_id: `small-${String(index + 1)}`,
        name,
        currency: "USD",
        typical_amount_minor: -minor,
        // The first one is 8 days late, as the board's.
        typical_day: index === 0 ? 3 : 15 + index,
        months_seen: 6,
        seen_this_month: false,
        category_id: "cat-bills",
      })),
      { direction: "income" as const, party_id: "elm", name: "Elm St, unit 2", currency: "USD", typical_amount_minor: 165000, typical_day: 1, months_seen: 6, seen_this_month: false, category_id: "cat-rent" },
    ],
  };
  const unpaid = empty ? [] : [
    { id: "inv-1043", description: "Invoice #1043", doc_date: "2026-08-08", project_name: "Northgate Co", customer_name: "Northgate Co", open_gross_agorot: 1250000, open_net_agorot: 1250000, currency: "USD", direction: "income" as const, category_id: "cat-clients" },
    { id: "inv-1047", description: "Invoice #1047", doc_date: "2026-09-22", project_name: null, customer_name: "Lakeside HOA", open_gross_agorot: 560000, open_net_agorot: 560000, currency: "USD", direction: "income" as const, category_id: "cat-clients" },
    { id: "bill-118", description: "Bill VD-118", doc_date: "2026-09-15", project_name: null, customer_name: "Varga Drywall", open_gross_agorot: 420000, open_net_agorot: 420000, currency: "USD", direction: "expense" as const, category_id: "cat-subs" },
    { id: "bill-hd", description: "Bill HD-22", doc_date: "2026-09-25", project_name: null, customer_name: "Harbor Supply Pro", open_gross_agorot: 313800, open_net_agorot: 313800, currency: "USD", direction: "expense" as const, category_id: "cat-materials" },
  ];
  const overrides: ForecastOverrideRow[] = variant === "changed"
    ? [{ item_key: "invoice:inv-1043", amount_minor: null, due_on: null, moved_out: true }]
    : [];
  const build = buildMonthForecast({
    base: "USD",
    expected: expectedMonthsSchema.parse(expected),
    unpaid: unpaidRowSchema.array().parse(unpaid),
    overrides,
    paymentTermsDays: 30,
  });
  // The changed frame's reset line reads these, so the undo has the prior state to send back.
  // What each category already had in October, as the board's (it adds up to today's cash).
  const soFar: ForecastSoFar = {
    expense: [
      { key: "cat-materials", name: "חומרים", minor: 1_524_000n },
      { key: "cat-subs", name: "קבלני משנה", minor: 1_186_000n },
      { key: "cat-loans", name: "תשלומי הלוואות", minor: 1_018_200n },
      { key: "cat-bills", name: "חשבונות קבועים", minor: 298_700n },
      { key: "none", name: null, minor: 180_000n },
    ],
    income: [
      { key: "cat-clients", name: "הכנסה מלקוחות", minor: 2_092_800n },
      { key: "cat-rent", name: "שכירות", minor: 395_000n },
    ],
  };
  const category = variant === "category";
  return {
    today,
    net: -1719100n,
    // May to September as they ended, and October so far (+$24,878 in, $42,069 out: today's −$17,191), as the board's.
    months: cashMonths([["2026-05", 23_100, 27_400], ["2026-06", 31_200, 24_800], ["2026-07", 28_600, 26_100], ["2026-08", 27_900, 29_300], ["2026-09", 14_200, 52_400], ["2026-10", 24_878, 42_069]]),
    data: { month: "2026-10", base: "USD", build, overrides },
    soFar,
    view: category ? "categories" : "items",
    openCategories: category ? ["income:cat-rent"] : [],
    ...(variant === "failed" ? { failed: true } : {}),
    ...(variant === "offline" ? { offlineSince: BOARD_OFFLINE_SINCE } : {}),
  };
}
