import { describe, expect, it } from "vitest";
import {
  annuityPaymentMinor,
  applyBp,
  computeMemberShare,
  type MemberReportConfig,
  type MemberReportLoan,
  type MemberReportProperty,
} from "./member-share.ts";

const UUID_1 = "00000000-0000-4000-8000-000000000001";

function property(name: string, value: bigint | null, loan: bigint, extra: Partial<MemberReportProperty> = {}): MemberReportProperty {
  return {
    project_id: `id-${name}`,
    name,
    currency: "USD",
    value_minor: value,
    value_date: "2026-11-01",
    selling_cost_bp: 700,
    loan_balance_minor: loan,
    loans_other_currency: false,
    ...extra,
  };
}

// The approved design's invented figures, in cents.
const HOMES = [
  property("Birch", 42_000_000n, 26_800_000n),
  property("Juniper", 36_500_000n, 24_150_000n),
  property("Sable", 29_800_000n, 15_200_000n),
];

const CONFIG: MemberReportConfig = {
  members: [{ name: "Member A", ownership_bp: 5000 }, { name: "Member B", ownership_bp: 3000 }, { name: "Member C", ownership_bp: 2000 }],
  assumptions: { ltv_bp: 7500, closing_bp: 200, term_years: 30 },
  rate_rule: { tenor_years: 10, spread_bp: 150 },
  quotes: [
    { id: UUID_1, lender: "Example Lending", rate_ppm: 62_500, points_bp: 100, quoted_on: "2026-11-03", loan_type: "fixed" },
    { id: "q2", lender: "Example Capital", rate_ppm: 60_000, quoted_on: "2026-11-03" },
    { id: "q3", lender: "Example Bank", rate_ppm: 58_800, quoted_on: "2026-11-03" },
  ],
  yields: [
    { on_date: "2026-10-31", y5_ppm: 41_000, y10_ppm: 43_500, source: "treasury" },
    { on_date: "2026-11-03", y5_ppm: 41_200, y10_ppm: 43_800, source: "treasury" },
    { on_date: "2026-11-04", y5_ppm: 41_500, y10_ppm: 44_100, source: "treasury" },
  ],
};

describe("computeMemberShare", () => {
  const result = computeMemberShare(CONFIG, HOMES);

  it("sells everything: value less selling costs less the loans", () => {
    expect(result.totals.valueMinor).toBe(108_300_000n);
    expect(result.totals.sellingCostMinor).toBe(7_581_000n);
    expect(result.totals.loanBalanceMinor).toBe(66_150_000n);
    expect(result.totals.saleNetMinor).toBe(34_569_000n);
    expect(result.properties[0]?.saleNetMinor).toBe(12_260_000n);
  });

  it("refinances at the loan to value, less the payoff and the closing costs", () => {
    expect(result.totals.newLoanMinor).toBe(81_225_000n);
    expect(result.totals.closingMinor).toBe(1_624_500n);
    expect(result.totals.cashOutMinor).toBe(13_450_500n);
    expect(result.properties.map((p) => p.cashOutMinor)).toEqual([4_070_000n, 2_677_500n, 6_703_000n]);
    expect(result.totals.refinancedCount).toBe(3);
  });

  it("gives each member their ownership of both totals", () => {
    expect(result.members.map((m) => [m.saleMinor, m.refinanceMinor])).toEqual([
      [17_284_500n, 6_725_250n],
      [10_370_700n, 4_035_150n],
      [6_913_800n, 2_690_100n],
    ]);
    expect(result.ownershipSet).toBe(true);
  });

  it("expects the Treasury yield on the quotes' date plus the spread, and judges each quote", () => {
    expect(result.rate).toMatchObject({ quoteDate: "2026-11-03", yieldDate: "2026-11-03", yieldPpm: 43_800, expectedPpm: 58_800, paymentPpm: 58_800 });
    expect(result.quotes.map((q) => [q.diffPpm, q.verdict])).toEqual([[3_700, "high"], [1_200, "near"], [0, "good"]]);
    expect(result.quotes[0]?.effectivePpm).toBe(64_167);
  });

  it("pays the new loans at the expected rate", () => {
    expect(result.properties.map((p) => p.paymentMinor)).toEqual([186_435n, 162_021n, 132_280n]);
    expect(result.totals.paymentMinor).toBe(480_736n);
  });

  it("takes the trading day before when the quote date has no yield, and the 5 year with its spread", () => {
    const weekend = computeMemberShare({ ...CONFIG, quote_date: "2026-11-01", rate_rule: { tenor_years: 5, spread_bp: 200 } }, HOMES);
    expect(weekend.rate).toMatchObject({ quoteDate: "2026-11-01", yieldDate: "2026-10-31", yieldPpm: 41_000, expectedPpm: 61_000 });
  });

  it("uses the best quote for the payments with no yield, and none without quotes", () => {
    const noYields = computeMemberShare({ ...CONFIG, yields: [] }, HOMES);
    expect(noYields.rate.expectedPpm).toBeNull();
    expect(noYields.rate.paymentPpm).toBe(58_800);
    expect(noYields.quotes.every((q) => q.verdict == null)).toBe(true);
    const bare = computeMemberShare({ members: CONFIG.members }, HOMES);
    expect(bare.rate.paymentPpm).toBeNull();
    expect(bare.totals.paymentMinor).toBeNull();
  });

  it("does not refinance a property whose new loan does not cover its loans and closing", () => {
    const deep = computeMemberShare(CONFIG, [property("Deep", 10_000_000n, 9_000_000n), ...HOMES.slice(0, 1)]);
    expect(deep.properties[0]).toMatchObject({ cashOutMinor: -1_650_000n, refinances: false, paymentMinor: null });
    expect(deep.totals.cashOutMinor).toBe(4_070_000n);
    expect(deep.totals.payoffMinor).toBe(26_800_000n);
  });

  it("leaves out a property with no value, in another currency or with loans in another currency", () => {
    const mixed = computeMemberShare(null, [
      ...HOMES,
      property("Blank", null, 0n),
      property("Shekel", 100_000_000n, 0n, { currency: "ILS" }),
      property("Mixed", 10_000_000n, 0n, { loans_other_currency: true }),
    ]);
    expect(mixed.currency).toBe("USD");
    expect(mixed.missing.map((m) => [m.name, m.reason])).toEqual([["Blank", "value"], ["Shekel", "currency"], ["Mixed", "loan_currency"]]);
    expect(mixed.properties).toHaveLength(3);
  });

  it("falls back to the defaults: 8% selling cost, 75% loan to value, no members", () => {
    const plain = computeMemberShare(null, [property("Plain", 10_000_000n, 0n, { selling_cost_bp: null })]);
    expect(plain.properties[0]).toMatchObject({ sellingCostBp: 800, sellingCostDefault: true, sellingCostMinor: 800_000n, newLoanMinor: 7_500_000n });
    expect(plain.ownershipSet).toBe(false);
    expect(plain.members).toEqual([]);
  });
});

describe("fetched Treasury yields (FLOW-1119)", () => {
  const FETCHED = [
    { on_date: "2026-10-30", y5_ppm: 40_900, y10_ppm: 43_300 },
    { on_date: "2026-11-03", y5_ppm: 41_100, y10_ppm: 43_700 },
  ];

  it("fills a date the owner typed nothing for, marked as the Treasury's", () => {
    const fetchedOnly = computeMemberShare({ ...CONFIG, yields: [] }, HOMES, FETCHED);
    expect(fetchedOnly.rate).toMatchObject({ yieldDate: "2026-11-03", yieldPpm: 43_700, yieldSource: "treasury", expectedPpm: 58_700 });
  });

  it("loses to a yield the owner typed for the same date and tenor", () => {
    const typed = computeMemberShare({ ...CONFIG, yields: [{ on_date: "2026-11-03", y10_ppm: 43_800, source: "manual" }] }, HOMES, FETCHED);
    expect(typed.rate).toMatchObject({ yieldPpm: 43_800, yieldSource: "manual" });
    const otherTenor = computeMemberShare({ ...CONFIG, rate_rule: { tenor_years: 5 }, yields: [{ on_date: "2026-11-03", y10_ppm: 43_800 }] }, HOMES, FETCHED);
    expect(otherTenor.rate).toMatchObject({ yieldPpm: 41_100, yieldSource: "treasury" });
  });

  it("takes the closest earlier fetched day over an older typed one", () => {
    const older = computeMemberShare({ ...CONFIG, quote_date: "2026-11-05", yields: [{ on_date: "2026-10-30", y10_ppm: 43_000 }] }, HOMES, FETCHED);
    expect(older.rate).toMatchObject({ yieldDate: "2026-11-03", yieldSource: "treasury" });
  });

  it("dates the report by the newest fetched day when there are no quotes", () => {
    const bare = computeMemberShare({ members: CONFIG.members }, HOMES, FETCHED);
    expect(bare.rate).toMatchObject({ quoteDate: "2026-11-03", yieldDate: "2026-11-03", yieldPpm: 43_700 });
  });
});

describe("all-in, profit and the members' loans (FLOW-1124)", () => {
  const homes = [
    property("Birch", 42_000_000n, 26_800_000n, { all_in_minor: 30_000_000n, purchase_minor: 27_000_000n, rehab_minor: 2_500_000n, holding_minor: 500_000n }),
    property("Juniper", 36_500_000n, 24_150_000n, { all_in_minor: 31_000_000n }),
    property("Sable", 29_800_000n, 15_200_000n),
  ];
  const loan = (loan_id: string, project_id: string | null, balance: bigint, currency = "USD"): MemberReportLoan =>
    ({ loan_id, name: `Loan ${loan_id}`, kind: "demand", project_id, currency, balance_minor: balance });
  const loans = [
    loan("a-note", "id-overhead", 5_000_000n),
    loan("b-note", "id-Juniper", 2_000_000n),
    loan("bank", "id-Birch", 26_800_000n),
    loan("c-euro", null, 1_000_000n, "EUR"),
  ];
  const config: MemberReportConfig = {
    members: [
      { name: "Member A", ownership_bp: 5000, loan_ids: ["a-note"] },
      { name: "Member B", ownership_bp: 3000, loan_ids: ["b-note"] },
      { name: "Member C", ownership_bp: 2000, loan_ids: ["c-euro"] },
    ],
  };
  const result = computeMemberShare(config, homes, [], loans);

  it("profit is the value less the selling costs less the all-in", () => {
    expect(result.properties.map((p) => p.profitMinor)).toEqual([9_060_000n, 2_945_000n, null]);
    expect(result.properties[0]?.purchaseMinor).toBe(27_000_000n);
    expect(result.totals.allInMinor).toBe(61_000_000n);
    expect(result.totals.profitValueMinor).toBe(78_500_000n);
    expect(result.totals.profitSellingMinor).toBe(5_495_000n);
    expect(result.totals.profitMinor).toBe(12_005_000n);
    expect(result.profitMissing.map((p) => p.name)).toEqual(["Sable"]);
  });

  it("repays the members' loans before the equity is split, a loan on a property from its loans", () => {
    expect(result.properties[1]?.memberLoanMinor).toBe(2_000_000n);
    expect(result.properties[1]?.bankLoanMinor).toBe(22_150_000n);
    expect(result.totals.bankLoanMinor).toBe(64_150_000n);
    expect(result.totals.memberLoansMinor).toBe(7_000_000n);
    expect(result.totals.saleNetMinor).toBe(34_569_000n);
    expect(result.totals.equityMinor).toBe(29_569_000n);
    const t = result.totals;
    expect(t.valueMinor - t.sellingCostMinor - t.bankLoanMinor - t.memberLoansMinor).toBe(t.equityMinor);
  });

  it("gives each member their part of the equity, plus their own loans, and their part of the profit", () => {
    expect(result.members.map((m) => [m.saleMinor, m.loansMinor, m.saleTotalMinor, m.profitMinor])).toEqual([
      [14_784_500n, 5_000_000n, 19_784_500n, 6_002_500n],
      [8_870_700n, 2_000_000n, 10_870_700n, 3_601_500n],
      [5_913_800n, 0n, 5_913_800n, 2_401_000n],
    ]);
    expect(result.memberLoans.map((l) => [l.loanId, l.member, l.projectId])).toEqual([
      ["a-note", "Member A", null],
      ["b-note", "Member B", "id-Juniper"],
    ]);
  });

  it("without members' loans, the equity is the net of the sale", () => {
    const plain = computeMemberShare(CONFIG, HOMES);
    expect(plain.totals.equityMinor).toBe(plain.totals.saleNetMinor);
    expect(plain.members[0]?.saleTotalMinor).toBe(plain.members[0]?.saleMinor);
    expect(plain.totals.profitMinor).toBe(0n);
  });

  it("leaves out a member's loan on a property the report leaves out", () => {
    const withPine = computeMemberShare({ members: [{ name: "Member A", ownership_bp: 10000, loan_ids: ["pine"] }] },
      [...homes, property("Pine", null, 1_000_000n)], [], [loan("pine", "id-Pine", 1_000_000n)]);
    expect(withPine.totals.memberLoansMinor).toBe(0n);
    expect(withPine.members[0]?.loansMinor).toBe(0n);
  });
});

describe("helpers", () => {
  it("applies basis points with half-even rounding on either sign", () => {
    expect(applyBp(25n, 5000)).toBe(12n);
    expect(applyBp(35n, 5000)).toBe(18n);
    expect(applyBp(-35n, 5000)).toBe(-18n);
  });

  it("pays a loan with no interest in equal months", () => {
    expect(annuityPaymentMinor(1_200n, 0, 1)).toBe(100n);
    expect(annuityPaymentMinor(0n, 60_000, 30)).toBe(0n);
  });
});
