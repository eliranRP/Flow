import { describe, expect, it } from "vitest";
import { computeMemberProjection, guessCostType, type ProjectionInput, type ProjectionLoan } from "./member-projection.ts";
import type { MemberReportLoan, MemberReportProperty } from "./member-share.ts";

/* FLOW-1126: invented figures, in cents. */

const AS_OF = "2026-10-31";

function property(id: string, value: bigint | null, loan: bigint, extra: Partial<MemberReportProperty> = {}): MemberReportProperty {
  return { project_id: id, name: id, currency: "USD", value_minor: value, value_date: "2026-11-01", selling_cost_bp: null, loan_balance_minor: loan, loans_other_currency: false, ...extra };
}

function mortgage(id: string, balance: bigint, extra: Partial<ProjectionLoan> = {}): ProjectionLoan {
  return {
    loan_id: id, kind: "amortizing", currency: "USD", principal_minor: balance, annual_rate_ppm: 65_000, term_months: 360,
    start_date: "2026-11-01", payment_minor: 169_394n, interest_only_months: null, amortization_months: null,
    balance_minor: balance, rates: [], ...extra,
  };
}

function input(id: string, rent: bigint, loans: ProjectionLoan[], extra: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    project_id: id, rent_minor: rent, rented_months: 12, units: 1,
    costs: [
      { category_id: "c-tax", name: "Property tax", amount_minor: 348_000n },
      { category_id: "c-ins", name: "Insurance", amount_minor: 192_000n },
      { category_id: "c-rep", name: "Repairs", amount_minor: 90_000n },
    ],
    loans, ...extra,
  };
}

const BIRCH = property("birch", 42_000_000n, 26_800_000n);
const BIRCH_IN = input("birch", 310_000n, [mortgage("m-birch", 26_800_000n)]);

function run(extra: Partial<Parameters<typeof computeMemberProjection>[0]> = {}) {
  return computeMemberProjection({
    config: { members: [{ name: "Member A", ownership_bp: 5000 }, { name: "Member B", ownership_bp: 5000 }] },
    properties: [BIRCH],
    loans: [],
    inputs: [BIRCH_IN],
    asOf: AS_OF,
    expectedRatePpm: 58_800,
    ...extra,
  });
}

describe("computeMemberProjection (FLOW-1126)", () => {
  it("year 1: rent, vacancy and turnover, costs by type without repairs, maintenance and CapEx, NOI", () => {
    const y1 = run({ years: 1 }).properties[0]?.years[0];
    expect(y1?.rentMinor).toBe(3_720_000n);
    // $3,100 × 1 empty month × 12 ÷ 24 months; $2,000 × 1 unit × 12 ÷ 24.
    expect(y1?.vacancyMinor).toBe(155_000n);
    expect(y1?.turnoverMinor).toBe(100_000n);
    expect(y1?.costs).toEqual({ tax: 348_000n, insurance: 192_000n, hoa: 0n, other: 0n });
    expect(y1?.maintenanceMinor).toBe(186_000n);
    expect(y1?.capexMinor).toBe(186_000n);
    expect(y1?.noiMinor).toBe(3_720_000n - 155_000n - 100_000n - 540_000n - 186_000n - 186_000n);
    // Twelve payments of principal and interest, no escrow.
    expect(y1?.debtServiceMinor).toBe(12n * 169_394n);
    expect(y1?.valueMinor).toBe(43_260_000n);
  });

  it("grows rent and each cost by its own rate from year 2, with a year that has its own change", () => {
    const r = run({
      years: 3,
      config: { projection: { by_year: { rent: { "2": 500 } }, insurance_growth_bp: 1000 } },
    });
    const ys = r.properties[0]?.years ?? [];
    expect(ys.map((y) => y.rentMinor)).toEqual([3_720_000n, 3_906_000n, 4_023_180n]);
    expect(ys.map((y) => y.costs.insurance)).toEqual([192_000n, 211_200n, 232_320n]);
    expect(ys.map((y) => y.costs.tax)).toEqual([348_000n, 358_440n, 369_193n]);
  });

  it("pays the loan down on its schedule, from today's balance", () => {
    const ys = run({ years: 10 }).properties[0]?.years ?? [];
    expect(ys[0]?.balanceMinor).toBeLessThan(26_800_000n);
    expect(ys[9]?.balanceMinor).toBeLessThan(ys[0]?.balanceMinor ?? 0n);
    // A loan already paid ahead by $10,000 stays $10,000 lower.
    const ahead = run({ years: 10, inputs: [input("birch", 310_000n, [mortgage("m-birch", 26_800_000n, { balance_minor: 25_800_000n })])] });
    expect((ys[9]?.balanceMinor ?? 0n) - (ahead.properties[0]?.years[9]?.balanceMinor ?? 0n)).toBe(1_000_000n);
  });

  it("refinances in year N at the LTV of that year's value, and splits the cash out", () => {
    const r = run({ years: 10 });
    const last = r.properties[0]?.years[9];
    const refi = r.properties[0]?.refi;
    expect(refi?.newLoanMinor).toBe(((last?.valueMinor ?? 0n) * 7500n + 5000n) / 10000n);
    expect(refi?.cashOutMinor).toBe((refi?.newLoanMinor ?? 0n) - (last?.balanceMinor ?? 0n) - (refi?.closingMinor ?? 0n));
    expect(refi?.refinances).toBe(true);
    expect(r.refi.splitMinor).toBe(refi?.cashOutMinor);
    expect(r.members[0]?.cashShareMinor).toBe((r.refi.splitMinor * 5000n + 5000n) / 10000n);
    expect(r.refi.dscrMilli).toBeGreaterThan(0);
    expect(r.refi.rateIsToday).toBe(true);
    expect(r.refi.ratePpm).toBe(58_800);
  });

  it("repays members' loans first: on a refinanced property to its member, the company's out of the cash out", () => {
    const loans: MemberReportLoan[] = [
      { loan_id: "a-note", name: "A note", kind: "demand", project_id: null, currency: "USD", balance_minor: 1_000_000n },
      { loan_id: "b-note", name: "B note", kind: "demand", project_id: "birch", currency: "USD", balance_minor: 500_000n },
    ];
    const r = run({
      years: 10,
      config: { members: [{ name: "Member A", ownership_bp: 5000, loan_ids: ["a-note"] }, { name: "Member B", ownership_bp: 5000, loan_ids: ["b-note"] }] },
      loans,
      inputs: [input("birch", 310_000n, [mortgage("m-birch", 26_300_000n), { ...mortgage("b-note", 500_000n), kind: "demand", term_months: null, payment_minor: null }])],
    });
    expect(r.refi.companyLoansRepaidMinor).toBe(1_000_000n);
    expect(r.refi.splitMinor).toBe(r.refi.cashOutMinor - 1_000_000n);
    expect(r.members.map((m) => m.loansBackMinor)).toEqual([1_000_000n, 500_000n]);
    expect(r.properties[0]?.refi.memberLoansMinor).toBe(500_000n);
    // A demand loan keeps its balance year by year.
    expect(r.properties[0]?.years.map((y) => y.debtServiceMinor > 0n)).toEqual(Array.from({ length: 10 }, () => true));
  });

  it("leaves out a property with no rent, and scales a partial year's costs", () => {
    const r = run({
      years: 1,
      properties: [BIRCH, property("pine", 30_000_000n, 0n)],
      inputs: [{ ...BIRCH_IN, rented_months: 6 }, input("pine", 0n, [])],
    });
    expect(r.missing).toEqual([{ projectId: "pine", name: "pine", reason: "rent" }]);
    expect(r.properties[0]?.years[0]?.costs.tax).toBe(696_000n);
  });

  it("does not refinance a property whose cash out is not above zero", () => {
    const r = run({ years: 1, inputs: [input("birch", 310_000n, [mortgage("m-birch", 33_000_000n, { payment_minor: 210_000n })])] });
    expect(r.properties[0]?.refi.refinances).toBe(false);
    expect(r.refi.cashOutMinor).toBe(0n);
    expect(r.members[0]?.totalMinor).toBe(0n);
  });

  it("keeps a loan whose terms the schedule refuses at its balance, paying interest only", () => {
    const r = run({ years: 2, inputs: [input("birch", 310_000n, [mortgage("m-birch", 26_800_000n, { payment_minor: 1_000n })])] });
    expect(r.properties[0]?.years.map((y) => [y.balanceMinor, y.debtServiceMinor])).toEqual([[26_800_000n, 1_742_000n], [26_800_000n, 1_742_000n]]);
  });

  it("uses the owner's category types over the guess", () => {
    expect(guessCostType("Property tax")).toBe("tax");
    expect(guessCostType("ביטוח מבנה")).toBe("insurance");
    expect(guessCostType("HOA dues")).toBe("hoa");
    expect(guessCostType("Repairs")).toBe("repairs");
    expect(guessCostType("Utilities")).toBe("other");
    const r = run({ years: 1, config: { projection: { category_types: { "c-rep": "other" } } } });
    expect(r.properties[0]?.years[0]?.costs.other).toBe(90_000n);
  });
});
