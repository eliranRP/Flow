import { buildLoanSchedule } from "@flow/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyForecastInput, CompanyNextMonthInputs } from "./company-next-month";
import { companyRestOfYear } from "./company-year-forecast";
import type { ForecastLoan } from "./project-next-loans";

/**
 * FLOW-1304: a build keeps each loan's payments left once per read, so its two schedules (the loan's own, the rest
 * from the balance) are built at most once per loan, however many months and parts read it. Invented loans of Flow
 * QA's kinds, one of them refused by its schedule, general and overhead loans included.
 */

vi.mock("@flow/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow/shared")>();
  return { ...actual, buildLoanSchedule: vi.fn(actual.buildLoanSchedule) };
});

const OVERHEAD = "p-overhead";
const PROJECTS = ["p1", "p2", "p3"];

function loanOf(id: string, projectId: string | null, kind: ForecastLoan["kind"], payment?: bigint): ForecastLoan {
  const principal = 20_000_000n + BigInt(id.length) * 1_000_000n;
  const demand = kind === "demand";
  // A 6% loan: the 360-month payment is about 0.6% of the principal; interest only is 0.5% a month plus 1/120.
  const monthly = kind === "interest_only" ? principal / 200n + principal / 120n : (principal * 599_551n) / 100_000_000n;
  return {
    id,
    currency: "USD",
    projectId,
    categoryIds: { interest: "loan-interest", escrow: null, principal: null, fees: null },
    status: "open",
    balanceMinor: (principal * 6n) / 10n,
    kind,
    termMonths: demand ? null : kind === "balloon" ? 60 : kind === "interest_only" ? 120 : 360,
    paymentMinor: demand ? null : (payment ?? monthly),
    rates: [{ id: "rate-1", effectiveDate: "2025-03-05", annualRatePpm: 60_000 }],
    principalMinor: principal,
    annualRatePpm: 60_000,
    startDate: "2025-03-05",
    escrowMinor: 0n,
    interestOnlyMonths: kind === "interest_only" ? 12 : null,
    amortizationMonths: kind === "balloon" ? 360 : null,
  };
}

const LOANS: ForecastLoan[] = [
  ...Array.from({ length: 12 }, (_, i) => loanOf(`amortizing-${String(i)}`, PROJECTS[i % 3] ?? null, "amortizing")),
  ...Array.from({ length: 4 }, (_, i) => loanOf(`balloon-${String(i)}`, PROJECTS[i % 3] ?? null, "balloon")),
  ...Array.from({ length: 3 }, (_, i) => loanOf(`interest-only-${String(i)}`, PROJECTS[i % 3] ?? null, "interest_only")),
  loanOf("general-interest-only", null, "interest_only"),
  loanOf("overhead-amortizing", OVERHEAD, "amortizing"),
  loanOf("demand", "p1", "demand"),
];

// A payment below the interest: the schedule refuses the loan, so the forecast has no rows for it.
const REFUSED = loanOf("refused", "p2", "amortizing", 1n);

const INPUTS = {
  month: "2026-12",
  overhead_project_id: OVERHEAD,
  projects: PROJECTS.map((project_id) => ({ project_id, categories: [] })),
  general: [],
  edits: [],
} as CompanyNextMonthInputs;

const CATEGORIES = [
  { id: "loan-interest", name: "ריבית הלוואה", loan_part: "interest" as const, excluded_from_pnl: false },
  { id: "loan-escrow", name: "ביטחון", loan_part: "escrow" as const, excluded_from_pnl: false },
];

const TODAY = "2026-01-20";
const base: CompanyForecastInput = { currency: "USD", today: TODAY, recurring: [], loans: LOANS, categories: CATEGORIES, inputs: INPUTS };
const schedules = vi.mocked(buildLoanSchedule);

beforeEach(() => {
  schedules.mockClear();
});

describe("a read builds each loan's payments left once (FLOW-1304)", () => {
  it("a rest-of-year build over 11 months makes at most two schedule builds per open loan", () => {
    const rest = companyRestOfYear(base);
    expect(rest?.months).toHaveLength(11);
    const open = LOANS.filter((loan) => loan.kind !== "demand").length;
    expect(schedules.mock.calls.length).toBeGreaterThan(0);
    expect(schedules.mock.calls.length).toBeLessThanOrEqual(2 * open);
  });

  it("each loan on its own, general and overhead ones included, makes at most two schedule builds over 11 months", () => {
    for (const loan of [...LOANS, REFUSED]) {
      schedules.mockClear();
      companyRestOfYear({ ...base, loans: [loan] });
      expect(schedules.mock.calls.length, loan.id).toBeLessThanOrEqual(2);
    }
  });

  it("a loan the schedule refuses is built once for the whole read, not once a month", () => {
    companyRestOfYear({ ...base, loans: [REFUSED] });
    expect(schedules).toHaveBeenCalledTimes(1);
  });
});
