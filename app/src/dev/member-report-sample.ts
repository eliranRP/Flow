import type { MemberReportConfig, MemberReportLoan, MemberReportProperty, ProjectionInput, ProjectionLoan } from "@flow/shared";
import type { MemberProjectionInputs, MemberReportRead } from "../use-member-report";

/**
 * FLOW-1118: the member share report's fixtures, the approved board's invented figures in cents. Three
 * properties worth $1,083,000 with $661,500 of loans; members A, B and C at 50%, 30% and 20%. FLOW-1124: each
 * property's all-in, and two members' loans: A's $50,000 to the company, B's $20,000 on Juniper.
 */

function home(id: string, name: string, value: number, loan: number, allIn?: [number, number, number]): MemberReportProperty {
  return {
    ...(allIn == null ? {} : {
      purchase_minor: BigInt(allIn[0]),
      rehab_minor: BigInt(allIn[1]),
      holding_minor: BigInt(allIn[2]),
      all_in_minor: BigInt(allIn[0] + allIn[1] + allIn[2]),
    }),
    project_id: `b0000000-0000-4000-8000-00000000111${id}`,
    name,
    currency: "USD",
    value_minor: BigInt(value),
    value_date: "2026-11-01",
    selling_cost_bp: 700,
    loan_balance_minor: BigInt(loan),
    loans_other_currency: false,
  };
}

export const MEMBER_PROPERTIES: MemberReportProperty[] = [
  home("1", "Birch Lane", 42_000_000, 26_800_000, [27_000_000, 2_500_000, 500_000]),
  home("2", "Juniper Ct", 36_500_000, 24_150_000, [28_000_000, 2_400_000, 600_000]),
  home("3", "Sable Ct", 29_800_000, 15_200_000, [19_500_000, 1_200_000, 300_000]),
];

const A_NOTE = "d0000000-0000-4000-8000-000000000001";
const B_NOTE = "d0000000-0000-4000-8000-000000000002";

/** The company's open loans: the two members' notes, then each property's mortgage. */
export const MEMBER_LOANS: MemberReportLoan[] = [
  { loan_id: A_NOTE, name: "Member A note", kind: "demand", project_id: null, currency: "USD", balance_minor: 5_000_000n },
  { loan_id: B_NOTE, name: "Member B note", kind: "demand", project_id: MEMBER_PROPERTIES[1]?.project_id ?? null, currency: "USD", balance_minor: 2_000_000n },
  { loan_id: "d0000000-0000-4000-8000-000000000003", name: "Birch mortgage", kind: "amortizing", project_id: MEMBER_PROPERTIES[0]?.project_id ?? null, currency: "USD", balance_minor: 26_800_000n },
  { loan_id: "d0000000-0000-4000-8000-000000000004", name: "Juniper mortgage", kind: "amortizing", project_id: MEMBER_PROPERTIES[1]?.project_id ?? null, currency: "USD", balance_minor: 22_150_000n },
];

export const MEMBER_CONFIG: MemberReportConfig = {
  members: [
    { name: "Member A", ownership_bp: 5000, loan_ids: [A_NOTE] },
    { name: "Member B", ownership_bp: 3000, loan_ids: [B_NOTE] },
    { name: "Member C", ownership_bp: 2000 },
  ],
  assumptions: { ltv_bp: 7500, closing_bp: 200, term_years: 30 },
  rate_rule: { tenor_years: 10, spread_bp: 150 },
  quotes: [
    { id: "c0000000-0000-4000-8000-000000000001", lender: "Example Lending", rate_ppm: 62_500, points_bp: 100, quoted_on: "2026-11-03", loan_type: "fixed" },
    { id: "c0000000-0000-4000-8000-000000000002", lender: "Example Capital", rate_ppm: 60_000, quoted_on: "2026-11-03", loan_type: "fixed" },
    { id: "c0000000-0000-4000-8000-000000000003", lender: "Example Bank", rate_ppm: 58_000, quoted_on: "2026-11-03", loan_type: "dscr" },
  ],
  yields: [{ on_date: "2026-11-03", y5_ppm: 41_200, y10_ppm: 43_800, source: "manual" }],
  quote_date: "2026-11-03",
};

export const MEMBER_REPORT: MemberReportRead = { config: MEMBER_CONFIG, properties: MEMBER_PROPERTIES, loans: MEMBER_LOANS, treasuryYields: [], canEdit: true };

/** Before any ownership is set: the company's figures only. */
export const MEMBER_REPORT_EMPTY: MemberReportRead = { config: null, properties: MEMBER_PROPERTIES, loans: MEMBER_LOANS, treasuryYields: [], canEdit: true };

/** A property with no value yet and one in shekels: both left out, and named. */
export const MEMBER_REPORT_LEFT_OUT: MemberReportRead = {
  ...MEMBER_REPORT,
  properties: [
    ...MEMBER_PROPERTIES,
    { ...home("4", "Cedar Row", 0, 0), value_minor: null },
    { ...home("5", "Olive House", 150_000_000, 0), currency: "ILS" },
  ],
};

/* FLOW-1127: the forecast's inputs for the three homes: their rent, last 12 months of costs, and loans. */

function mortgage(id: string, balance: number, payment: number, rate: number): ProjectionLoan {
  return {
    loan_id: id, kind: "amortizing", currency: "USD", principal_minor: BigInt(balance), annual_rate_ppm: rate, term_months: 360,
    start_date: "2026-11-01", payment_minor: BigInt(payment), interest_only_months: null, amortization_months: null,
    balance_minor: BigInt(balance), rates: [],
  };
}

function inputs(i: number, rent: number, tax: number, insurance: number, loans: ProjectionLoan[]): ProjectionInput {
  return {
    project_id: MEMBER_PROPERTIES[i]?.project_id ?? "",
    rent_minor: BigInt(rent),
    rented_months: 12,
    units: 1,
    costs: [
      { category_id: "e0000000-0000-4000-8000-000000000001", name: "Property tax", amount_minor: BigInt(tax) },
      { category_id: "e0000000-0000-4000-8000-000000000002", name: "Insurance", amount_minor: BigInt(insurance) },
      { category_id: "e0000000-0000-4000-8000-000000000003", name: "Repairs", amount_minor: 90_000n },
    ],
    loans,
  };
}

const B_NOTE_LOAN: ProjectionLoan = { ...mortgage(B_NOTE, 2_000_000, 0, 60_000), kind: "demand", term_months: null, payment_minor: null };

export const MEMBER_PROJECTION_INPUTS: MemberProjectionInputs = {
  asOf: "2026-10-31",
  today: "2026-11-09",
  properties: [
    inputs(0, 310_000, 348_000, 192_000, [mortgage("d0000000-0000-4000-8000-000000000003", 26_800_000, 169_394, 65_000)]),
    inputs(1, 275_000, 300_000, 168_000, [mortgage("d0000000-0000-4000-8000-000000000004", 22_150_000, 143_656, 67_500), B_NOTE_LOAN]),
    inputs(2, 235_000, 252_000, 144_000, []),
  ],
};
