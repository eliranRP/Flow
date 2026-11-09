import type { MemberReportConfig, MemberReportProperty } from "@flow/shared";
import type { MemberReportRead } from "../use-member-report";

/**
 * FLOW-1118: the member share report's fixtures, the approved board's invented figures in cents. Three
 * properties worth $1,083,000 with $661,500 of loans; members A, B and C at 50%, 30% and 20%.
 */

function home(id: string, name: string, value: number, loan: number): MemberReportProperty {
  return {
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
  home("1", "Birch Lane", 42_000_000, 26_800_000),
  home("2", "Juniper Ct", 36_500_000, 24_150_000),
  home("3", "Sable Ct", 29_800_000, 15_200_000),
];

export const MEMBER_CONFIG: MemberReportConfig = {
  members: [
    { name: "Member A", ownership_bp: 5000 },
    { name: "Member B", ownership_bp: 3000 },
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

export const MEMBER_REPORT: MemberReportRead = { config: MEMBER_CONFIG, properties: MEMBER_PROPERTIES, treasuryYields: [], canEdit: true };

/** Before any ownership is set: the company's figures only. */
export const MEMBER_REPORT_EMPTY: MemberReportRead = { config: null, properties: MEMBER_PROPERTIES, treasuryYields: [], canEdit: true };

/** A property with no value yet and one in shekels: both left out, and named. */
export const MEMBER_REPORT_LEFT_OUT: MemberReportRead = {
  ...MEMBER_REPORT,
  properties: [
    ...MEMBER_PROPERTIES,
    { ...home("4", "Cedar Row", 0, 0), value_minor: null },
    { ...home("5", "Olive House", 150_000_000, 0), currency: "ILS" },
  ],
};
