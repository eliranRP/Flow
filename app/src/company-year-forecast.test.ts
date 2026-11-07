import type { ExpectedParty } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { companyNextMonthForecast, type CompanyNextMonthInputs, type RestOfYearEdit } from "./company-next-month";
import { companyMonthForecast, companyMonthInput, companyRestOfYear, restExpenseNote, restIncomeNote, restMonthsCaption, restOfYearMonths } from "./company-year-forecast";

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

// INPUTS has no rest_edits (an older payload): next month's edits apply by their pace, matched in next month only.
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

// FLOW-1096: a charge taken out of one month (FLOW-1079) leaves that month's totals only.
describe("companyRestOfYear with each month's skips", () => {
  const rest = companyRestOfYear({ ...input, skipsByMonth: { "2026-12": ["party:expense:s-payroll:USD"] } });
  if (rest == null) throw new Error("two months are left");

  it("takes the charge out of December only", () => {
    expect(rest.months[0]?.expenseMinor).toBe(40_000n + 200_000n + 10_000n);
    expect(rest.months[1]?.expenseMinor).toBe(60_000n + 30_000n + 10_000n);
    expect(rest.expenseMinor).toBe(550_000n - 200_000n);
  });

  it("gives a month of the forecast its own skips", () => {
    expect(companyMonthInput({ ...input, skipsByMonth: { "2026-12": ["k"] } }, "2026-12").skips).toEqual(["k"]);
    expect(companyMonthInput({ ...input, skipsByMonth: { "2026-12": ["k"] } }, "2026-11").skips).toBeUndefined();
  });
});

// FLOW-1096: a project whose only charge was taken out still lists it, so it can be put back; and a party with
// more than one charge in the currency is split by project in every month, as this month's forecast keys it.
describe("companyNextMonthForecast's skipped rows and split parties", () => {
  const solo = {
    ...input,
    inputs: { ...INPUTS, projects: [...INPUTS.projects, { project_id: "p2", categories: [] }] },
    recurring: [charge("s-hoa", "p2", "c-repairs", "expense", 9_000n, "month", "2026-11"), ...RECURRING],
    skips: ["party:expense:s-hoa:USD"],
  };
  const forecast = companyNextMonthForecast(solo);

  it("lists a skipped row whose project has no row left", () => {
    expect(forecast.parts.some((part) => part.projectId === "p2")).toBe(false);
    expect(forecast.skipped.map(({ projectId, row }) => [projectId, row.key])).toEqual([["p2", "rec:expense:s-hoa"]]);
  });

  it("names the parties split by project", () => {
    const split = companyNextMonthForecast({ ...input, recurring: [...RECURRING, charge("s-payroll", "p1", "c-payroll", "expense", 1_000n, "year", "2027-05")] });
    expect([...split.splitKeys]).toEqual(["party:expense:s-payroll:USD"]);
    expect([...forecast.splitKeys]).toEqual([]);
  });
});

describe("the rest of the year's own edits (rest_edits)", () => {
  // The read's rest of the year: the two edits above, and a 2-month expense of $70 started in October, which lands
  // in October and December, not November, so next month's edits do not hold it. The added income line came in
  // November only.
  const twoMonths: RestOfYearEdit = { id: "e-two", project_id: "p1", kind: "add", row_key: null, category_id: "c-repairs", category_name: "תיקונים", direction: "expense", amount_minor: 7_000, pace: "2months", start_month: "2026-10" };
  const withRest: CompanyNextMonthInputs = {
    ...INPUTS,
    rest_edits: [
      ...INPUTS.edits.map(({ matched_transaction_id: matched, ...edit }): RestOfYearEdit => ({ ...edit, matches: matched == null ? {} : { "2026-11": matched } })),
      twoMonths,
    ],
  };
  const rest = companyRestOfYear({ ...input, inputs: withRest });
  if (rest == null) throw new Error("two months are left");

  it("a 2-month edit started in October shows in December's forecast, not November's", () => {
    expect(rest.months[0]).toEqual({ month: "2026-11", incomeMinor: 100_000n, expenseMinor: 40_000n + 200_000n + 10_000n });
    expect(rest.months[1]).toEqual({ month: "2026-12", incomeMinor: 100_000n + 5_000n, expenseMinor: 60_000n + 30_000n + 200_000n + 10_000n + 7_000n });
  });

  it("an added line matched in a month leaves that month only", () => {
    const matchedDecember: CompanyNextMonthInputs = {
      ...withRest,
      rest_edits: (withRest.rest_edits ?? []).map((edit) => (edit.id === "e-extra" ? { ...edit, matches: { "2026-12": "t-extra-12" } } : edit)),
    };
    const result = companyRestOfYear({ ...input, inputs: matchedDecember });
    expect(result?.months.map((month) => month.incomeMinor)).toEqual([105_000n, 100_000n]);
  });
});

// FLOW-1066: any month of the forecast, 12 months ahead, from next month's reads.
describe("companyMonthForecast", () => {
  // A once edit for March 2027 sets its repairs to $200, matched nowhere; the added income line came in April.
  const march: RestOfYearEdit = { id: "e-march", project_id: "p1", kind: "change", row_key: "avg:c-repairs", category_id: null, direction: null, amount_minor: 20_000, pace: "once", start_month: "2027-03" };
  const far: CompanyNextMonthInputs = {
    ...INPUTS,
    rest_edits: [
      ...INPUTS.edits.map(({ matched_transaction_id: matched, ...edit }): RestOfYearEdit => ({ ...edit, matches: edit.id === "e-extra" ? { "2027-04": "t-extra-04" } : matched == null ? {} : { "2026-11": matched } })),
      march,
    ],
  };
  const farInput = { ...input, inputs: far };

  it("next month is next month's forecast, exactly", () => {
    expect(companyMonthForecast(farInput, "2026-11")).toEqual(companyNextMonthForecast(farInput));
  });

  it("a month next year: its charges by their pace, its own edits, its own matches", () => {
    // March 2027: the quarterly insurance (due Dec, Mar, ...), repairs as edited, the extra income expected.
    expect(companyMonthForecast(farInput, "2027-03")).toMatchObject({ month: "2027-03", incomeMinor: 105_000n, expenseMinor: 20_000n + 30_000n + 200_000n + 10_000n });
    // April 2027: no insurance, repairs back to the average, the extra income already came.
    expect(companyMonthForecast(farInput, "2027-04")).toMatchObject({ month: "2027-04", incomeMinor: 100_000n, expenseMinor: 60_000n + 200_000n + 10_000n });
  });

  it("the horizon's last month builds too; the year card still stops in December", () => {
    expect(companyMonthForecast(farInput, "2027-10").month).toBe("2027-10");
    expect(companyRestOfYear(farInput)?.months.map((month) => month.month)).toEqual(["2026-11", "2026-12"]);
    expect(restOfYearMonths("2026-11-06")).toEqual(["2026-12"]);
  });

  it("companyMonthInput carries the month and its edits for the general costs' builder", () => {
    const set = companyMonthInput(farInput, "2027-03");
    expect(set.month).toBe("2027-03");
    expect(set.inputs.edits.map((edit) => edit.id)).toEqual(["e-repairs", "e-extra", "e-march"]);
    expect(set.inputs.edits.find((edit) => edit.id === "e-extra")?.matched_transaction_id).toBeNull();
    expect(companyMonthInput(farInput, "2026-11").inputs.edits).toBe(INPUTS.edits);
  });
});
