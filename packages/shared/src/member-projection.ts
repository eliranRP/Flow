/**
 * FLOW-1126 (FLOW-1125's plan, option A approved 2026-11-09): the member report's forecast. Each property, year by
 * year from the last full month, and a refinance in a chosen year; one calculation for the app and for MCP
 * get_member_projection.
 *
 * Each year, per property:
 * - Rent: the scheduled monthly rent × 12, growing by that year's rent change from year 2 on. Vacancy: the monthly
 *   rent × empty months × (12 ÷ average stay). Turnover cost: units × the cost × (12 ÷ average stay).
 * - Costs: the last 12 months of operating costs by type (tax, insurance, HOA, other; repairs are left out, the
 *   maintenance percent takes their place), a partial year scaled to 12 months, each growing by its own change.
 * - Maintenance and the CapEx reserve: percents of that year's rent. NOI = rent − vacancy − turnover − costs −
 *   maintenance − CapEx. Debt service: each loan's scheduled principal and interest (no escrow; tax and insurance
 *   are in the costs). Cash flow = NOI − debt service.
 * - Value: grows by the appreciation each year. Balance: today's balance less the principal its schedule pays by
 *   then; a demand loan (a member's) keeps its balance.
 * The refinance in year N: a new loan at the LTV of that year's value, less that year's balances and the closing
 * costs; a property where that is not above zero is not refinanced. Members: each member's loans on a refinanced
 * property are paid off to them; the company's own member loans are repaid out of the total cash out first (in
 * proportion when short); the rest is split by ownership, and so is the cash flow until then. Before tax.
 */
import { buildLoanSchedule, type LoanKind } from "./loan-schedule.ts";
import { annuityPaymentMinor, applyBp, MEMBER_REPORT_DEFAULTS, type MemberReportConfig, type MemberReportLoan, type MemberReportProperty } from "./member-share.ts";
import { divHalfEven } from "./money.ts";

export type CostType = "tax" | "insurance" | "hoa" | "repairs" | "other";
export type ProjectionSeries = "rent" | "tax" | "insurance" | "hoa" | "other" | "appreciation";
export const PROJECTION_SERIES: readonly ProjectionSeries[] = ["rent", "tax", "insurance", "hoa", "other", "appreciation"];

/** The setting's `projection` part: every value optional, the defaults below. */
export type ProjectionConfig = {
  readonly years?: number;
  readonly rent_growth_bp?: number;
  readonly tax_growth_bp?: number;
  readonly insurance_growth_bp?: number;
  readonly hoa_growth_bp?: number;
  readonly other_growth_bp?: number;
  readonly appreciation_bp?: number;
  readonly maintenance_bp?: number;
  readonly capex_bp?: number;
  readonly stay_months?: number;
  readonly empty_months_tenths?: number;
  readonly turnover_cost_minor?: number;
  readonly ltv_bp?: number;
  readonly closing_bp?: number;
  /** Null or absent: today's expected rate (the report's Treasury + spread). */
  readonly rate_ppm?: number | null;
  readonly term_years?: number;
  /** A series' change in a given year (1 to 10) in basis points, over its yearly change. */
  readonly by_year?: Partial<Record<ProjectionSeries, Record<string, number>>>;
  /** A category's cost type, over the guess from its name. */
  readonly category_types?: Record<string, CostType>;
};

/** FLOW-1125's defaults, approved with the plan. */
export const PROJECTION_DEFAULTS = {
  years: 10,
  rentGrowthBp: 300,
  taxGrowthBp: 300,
  insuranceGrowthBp: 500,
  hoaGrowthBp: 300,
  otherGrowthBp: 300,
  appreciationBp: 300,
  maintenanceBp: 500,
  capexBp: 500,
  stayMonths: 24,
  emptyMonthsTenths: 10,
  turnoverCostMinor: 200_000,
} as const;

/** One open loan's terms, as get_member_projection_inputs returns them. */
export type ProjectionLoan = {
  readonly loan_id: string;
  readonly kind: LoanKind;
  readonly currency: string;
  readonly principal_minor: bigint;
  readonly annual_rate_ppm: number;
  readonly term_months: number | null;
  readonly start_date: string;
  readonly payment_minor: bigint | null;
  readonly interest_only_months: number | null;
  readonly amortization_months: number | null;
  readonly balance_minor: bigint;
  readonly rates: readonly { readonly effective_date: string; readonly annual_rate_ppm: number }[];
};

/** One property's starting point, as get_member_projection_inputs returns it. */
export type ProjectionInput = {
  readonly project_id: string;
  readonly rent_minor: bigint;
  readonly rented_months: number;
  readonly units: number;
  readonly costs: readonly { readonly category_id: string | null; readonly name: string | null; readonly amount_minor: bigint }[];
  readonly loans: readonly ProjectionLoan[];
};

/** A cost category's type from its name: tax, insurance, HOA, repairs, else other. */
export function guessCostType(name: string | null): CostType {
  const n = (name ?? "").toLowerCase();
  if (/insur|ביטוח/.test(n)) return "insurance";
  if (/hoa|association|ועד/.test(n)) return "hoa";
  if (/tax|מס /.test(n) || n.startsWith("מס") || n.includes("ארנונה")) return "tax";
  if (/repair|maint|תיקון|תיקונים|תחזוקה/.test(n)) return "repairs";
  return "other";
}

export type ProjectionYear = {
  readonly year: number;
  readonly rentMinor: bigint;
  readonly vacancyMinor: bigint;
  readonly turnoverMinor: bigint;
  readonly costs: Readonly<Record<Exclude<CostType, "repairs">, bigint>>;
  readonly maintenanceMinor: bigint;
  readonly capexMinor: bigint;
  readonly noiMinor: bigint;
  readonly debtServiceMinor: bigint;
  readonly cashFlowMinor: bigint;
  /** At the year's end. */
  readonly valueMinor: bigint;
  readonly balanceMinor: bigint;
};

export type PropertyProjection = {
  readonly projectId: string;
  readonly name: string;
  readonly years: readonly ProjectionYear[];
  readonly refi: {
    readonly newLoanMinor: bigint;
    readonly payoffMinor: bigint;
    /** Of the payoff, the members' loans on this property. */
    readonly memberLoansMinor: bigint;
    readonly closingMinor: bigint;
    readonly cashOutMinor: bigint;
    readonly refinances: boolean;
    /** The new loan's yearly principal and interest; null without a rate. */
    readonly debtServiceMinor: bigint | null;
  };
};

export type MemberProjection = {
  readonly name: string;
  readonly ownershipBp: number;
  /** Their part of the cash out left after the company's own member loans. */
  readonly cashShareMinor: bigint;
  /** Their own loans paid back by the refinance (on a refinanced property, or the company's out of the cash out). */
  readonly loansBackMinor: bigint;
  readonly totalMinor: bigint;
  /** Their part of the cash flow of the years until the refinance, it included. */
  readonly cashFlowMinor: bigint;
};

export type ProjectionResult = {
  readonly currency: string | null;
  readonly years: number;
  readonly asOf: string;
  readonly properties: readonly PropertyProjection[];
  readonly missing: readonly { readonly projectId: string; readonly name: string; readonly reason: "value" | "currency" | "loan_currency" | "rent" }[];
  /** The portfolio, year by year. */
  readonly totals: readonly ProjectionYear[];
  readonly refi: {
    readonly year: number;
    readonly valueMinor: bigint;
    readonly newLoanMinor: bigint;
    readonly payoffMinor: bigint;
    readonly payoffMemberLoansMinor: bigint;
    readonly closingMinor: bigint;
    readonly cashOutMinor: bigint;
    /** The company's own member loans repaid out of the cash out first. */
    readonly companyLoansRepaidMinor: bigint;
    /** What the members split. */
    readonly splitMinor: bigint;
    readonly refinancedCount: number;
    readonly ratePpm: number | null;
    readonly rateIsToday: boolean;
    readonly termYears: number;
    readonly debtServiceMinor: bigint | null;
    /** NOI of the refinanced properties in year N ÷ their new debt service, × 1000; null without a rate. */
    readonly dscrMilli: number | null;
  };
  readonly cashFlowMinor: bigint;
  readonly members: readonly MemberProjection[];
  /** Each assumption as used (the setting's, else the default). */
  readonly assumptions: {
    readonly growthBp: Readonly<Record<ProjectionSeries, number>>;
    readonly maintenanceBp: number;
    readonly capexBp: number;
    readonly stayMonths: number;
    readonly emptyMonthsTenths: number;
    readonly turnoverCostMinor: bigint;
    readonly ltvBp: number;
    readonly closingBp: number;
  };
};

const ZERO_COSTS = { tax: 0n, insurance: 0n, hoa: 0n, other: 0n } as const;

/** A YYYY-MM-DD date `years` years on. */
function addYears(date: string, years: number): string {
  return `${String(Number(date.slice(0, 4)) + years)}${date.slice(4)}`;
}

/** amount × ratio, rounded half to even. */
function times(amount: bigint, numerator: bigint, denominator: bigint): bigint {
  const product = amount * numerator;
  return product < 0n ? -divHalfEven(-product, denominator) : divHalfEven(product, denominator);
}

/** A loan that keeps its balance, paying only interest (none for a member's demand loan). */
function flat(loan: ProjectionLoan, years: number, interest: boolean): { balance: bigint[]; debt: bigint[] } {
  const yearly = interest ? times(loan.balance_minor, BigInt(loan.annual_rate_ppm), 1_000_000n) : 0n;
  return { balance: Array.from({ length: years }, () => loan.balance_minor), debt: Array.from({ length: years }, () => yearly) };
}

/**
 * A loan's balance at the end of each year, and its principal and interest in each, from its schedule. The balance
 * is today's (at `today`) less the principal the schedule pays from today to then.
 */
function loanByYear(loan: ProjectionLoan, asOf: string, today: string, years: number): { balance: bigint[]; debt: bigint[] } {
  const balance: bigint[] = [];
  const debt: bigint[] = [];
  if (loan.kind === "demand") return flat(loan, years, false);
  // A loan without the terms for a schedule keeps its balance and pays interest.
  if (loan.term_months == null || loan.payment_minor == null) return flat(loan, years, true);
  let schedule: ReturnType<typeof buildLoanSchedule>;
  try {
    schedule = buildLoanSchedule({
    principalMinor: loan.principal_minor,
    annualRatePpm: loan.annual_rate_ppm,
    termMonths: loan.term_months,
    startDate: loan.start_date,
    paymentMinor: loan.payment_minor,
    escrowMinor: 0n,
    kind: loan.kind,
    interestOnlyMonths: loan.interest_only_months,
    amortizationMonths: loan.amortization_months,
    rates: loan.rates.map((r) => ({ effectiveDate: r.effective_date, annualRatePpm: r.annual_rate_ppm })),
    });
  } catch {
    // Terms the schedule refuses (a payment under the interest): the balance stays and only interest is paid.
    return flat(loan, years, true);
  }
  const rows = schedule.rows;
  // The schedule's balance after the last payment due on or before a date (its principal before the first).
  const scheduledAt = (date: string) => rows.reduce((bal, r) => (r.dueDate <= date ? r.balanceMinor : bal), loan.principal_minor);
  const now = scheduledAt(today);
  for (let y = 1; y <= years; y++) {
    const from = addYears(asOf, y - 1);
    const to = addYears(asOf, y);
    // Today's balance less the principal the schedule pays by then, so extra payments made so far carry over.
    const paid = now - scheduledAt(to);
    balance.push(loan.balance_minor - paid > 0n ? loan.balance_minor - paid : 0n);
    debt.push(rows.reduce((sum, r) => (r.dueDate > from && r.dueDate <= to ? sum + r.interestMinor + r.principalMinor : sum), 0n));
  }
  return { balance, debt };
}

export function computeMemberProjection(input: {
  readonly config: MemberReportConfig | null;
  readonly properties: readonly MemberReportProperty[];
  readonly loans: readonly MemberReportLoan[];
  readonly inputs: readonly ProjectionInput[];
  /** The last day of the last full month. */
  readonly asOf: string;
  /** The date today's loan balances are at; the schedules count principal from it. Defaults to asOf. */
  readonly today?: string;
  /** Today's expected rate (the report's), the default refinance rate. */
  readonly expectedRatePpm: number | null;
  /** The refinance year, 1 to 10; else the setting's, else 10. */
  readonly years?: number;
}): ProjectionResult {
  const cfg = input.config ?? {};
  const p = cfg.projection ?? {};
  const d = PROJECTION_DEFAULTS;
  const years = Math.min(10, Math.max(1, input.years ?? p.years ?? d.years));
  const growthBp: Record<ProjectionSeries, number> = {
    rent: p.rent_growth_bp ?? d.rentGrowthBp,
    tax: p.tax_growth_bp ?? d.taxGrowthBp,
    insurance: p.insurance_growth_bp ?? d.insuranceGrowthBp,
    hoa: p.hoa_growth_bp ?? d.hoaGrowthBp,
    other: p.other_growth_bp ?? d.otherGrowthBp,
    appreciation: p.appreciation_bp ?? d.appreciationBp,
  };
  const growth = (series: ProjectionSeries, year: number) => p.by_year?.[series]?.[String(year)] ?? growthBp[series];
  const maintenanceBp = p.maintenance_bp ?? d.maintenanceBp;
  const capexBp = p.capex_bp ?? d.capexBp;
  const stayMonths = p.stay_months ?? d.stayMonths;
  const emptyTenths = p.empty_months_tenths ?? d.emptyMonthsTenths;
  const turnoverCost = BigInt(p.turnover_cost_minor ?? d.turnoverCostMinor);
  const ltvBp = p.ltv_bp ?? cfg.assumptions?.ltv_bp ?? MEMBER_REPORT_DEFAULTS.ltvBp;
  const closingBp = p.closing_bp ?? cfg.assumptions?.closing_bp ?? MEMBER_REPORT_DEFAULTS.closingBp;
  const termYears = p.term_years ?? cfg.assumptions?.term_years ?? MEMBER_REPORT_DEFAULTS.termYears;
  const ratePpm = p.rate_ppm ?? input.expectedRatePpm;
  const typeOf = (id: string | null, name: string | null): CostType => (id != null ? p.category_types?.[id] : undefined) ?? guessCostType(name);

  // The report's currency: the one most valued properties use (as computeMemberShare).
  const counts = new Map<string, number>();
  for (const prop of input.properties) if (prop.value_minor != null) counts.set(prop.currency, (counts.get(prop.currency) ?? 0) + 1);
  const currency = [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0]?.[0] ?? null;

  const byId = new Map(input.inputs.map((i) => [i.project_id, i]));
  const owner = new Map<string, string>();
  for (const m of cfg.members ?? []) for (const id of m.loan_ids ?? []) owner.set(id, m.name);
  const missing: ProjectionResult["missing"][number][] = [];
  const properties: PropertyProjection[] = [];
  // Each property loan's balance in year N, so a member's amortizing loan is repaid at what is left of it.
  const projected = new Map<string, bigint>();

  for (const prop of input.properties) {
    const inp = byId.get(prop.project_id);
    if (prop.value_minor == null) { missing.push({ projectId: prop.project_id, name: prop.name, reason: "value" }); continue; }
    if (prop.currency !== currency) { missing.push({ projectId: prop.project_id, name: prop.name, reason: "currency" }); continue; }
    if (prop.loans_other_currency || (inp?.loans ?? []).some((l) => l.currency !== currency)) {
      missing.push({ projectId: prop.project_id, name: prop.name, reason: "loan_currency" }); continue;
    }
    if (inp == null || inp.rent_minor <= 0n) { missing.push({ projectId: prop.project_id, name: prop.name, reason: "rent" }); continue; }

    // Costs by type, a partial year scaled to 12 months; repairs are left out.
    const base = { ...ZERO_COSTS } as Record<Exclude<CostType, "repairs">, bigint>;
    const scale = inp.rented_months > 0 && inp.rented_months < 12 ? inp.rented_months : 12;
    for (const c of inp.costs) {
      const type = typeOf(c.category_id, c.name);
      if (type === "repairs") continue;
      base[type] += times(c.amount_minor, 12n, BigInt(scale));
    }
    const loans = inp.loans.map((l) => ({ loan: l, ...loanByYear(l, input.asOf, input.today ?? input.asOf, years) }));
    for (const l of loans) projected.set(l.loan.loan_id, l.balance[years - 1] ?? l.loan.balance_minor);
    const memberLoanIds = new Set(inp.loans.filter((l) => owner.has(l.loan_id)).map((l) => l.loan_id));

    const turns = (n: bigint) => times(n, 12n, BigInt(stayMonths));
    const rows: ProjectionYear[] = [];
    let rentMonthly = inp.rent_minor;
    const costs = { ...base };
    let value = prop.value_minor;
    // Year 1 starts from the last 12 months; a change set for year 1 itself still applies.
    const change = (series: ProjectionSeries, y: number) => (y > 1 ? growth(series, y) : p.by_year?.[series]?.["1"] ?? 0);
    for (let y = 1; y <= years; y++) {
      rentMonthly = applyBp(rentMonthly, 10_000 + change("rent", y));
      for (const t of ["tax", "insurance", "hoa", "other"] as const) costs[t] = applyBp(costs[t], 10_000 + change(t, y));
      value = applyBp(value, 10_000 + growth("appreciation", y));
      const rent = rentMonthly * 12n;
      const vacancy = turns(times(rentMonthly, BigInt(emptyTenths), 10n));
      const turnover = turns(turnoverCost * BigInt(Math.max(1, inp.units)));
      const maintenance = applyBp(rent, maintenanceBp);
      const capex = applyBp(rent, capexBp);
      const costSum = costs.tax + costs.insurance + costs.hoa + costs.other;
      const noi = rent - vacancy - turnover - costSum - maintenance - capex;
      const debt = loans.reduce((sum, l) => sum + (l.debt[y - 1] ?? 0n), 0n);
      rows.push({
        year: y,
        rentMinor: rent,
        vacancyMinor: vacancy,
        turnoverMinor: turnover,
        costs: { ...costs },
        maintenanceMinor: maintenance,
        capexMinor: capex,
        noiMinor: noi,
        debtServiceMinor: debt,
        cashFlowMinor: noi - debt,
        valueMinor: value,
        balanceMinor: loans.reduce((sum, l) => sum + (l.balance[y - 1] ?? 0n), 0n),
      });
    }
    const last = rows[rows.length - 1];
    if (last == null) continue;
    const newLoan = applyBp(last.valueMinor, ltvBp);
    const closing = applyBp(newLoan, closingBp);
    const cashOut = newLoan - last.balanceMinor - closing;
    const refinances = cashOut > 0n;
    properties.push({
      projectId: prop.project_id,
      name: prop.name,
      years: rows,
      refi: {
        newLoanMinor: newLoan,
        payoffMinor: last.balanceMinor,
        memberLoansMinor: loans.reduce((sum, l) => (memberLoanIds.has(l.loan.loan_id) ? sum + (l.balance[years - 1] ?? 0n) : sum), 0n),
        closingMinor: closing,
        cashOutMinor: cashOut,
        refinances,
        debtServiceMinor: refinances && ratePpm != null ? annuityPaymentMinor(newLoan, ratePpm, termYears) * 12n : null,
      },
    });
  }

  const totals: ProjectionYear[] = [];
  for (let y = 1; y <= years; y++) {
    const at = properties.map((pr) => pr.years[y - 1]).filter((r): r is ProjectionYear => r != null);
    const sum = (f: (r: ProjectionYear) => bigint) => at.reduce((s, r) => s + f(r), 0n);
    totals.push({
      year: y,
      rentMinor: sum((r) => r.rentMinor),
      vacancyMinor: sum((r) => r.vacancyMinor),
      turnoverMinor: sum((r) => r.turnoverMinor),
      costs: { tax: sum((r) => r.costs.tax), insurance: sum((r) => r.costs.insurance), hoa: sum((r) => r.costs.hoa), other: sum((r) => r.costs.other) },
      maintenanceMinor: sum((r) => r.maintenanceMinor),
      capexMinor: sum((r) => r.capexMinor),
      noiMinor: sum((r) => r.noiMinor),
      debtServiceMinor: sum((r) => r.debtServiceMinor),
      cashFlowMinor: sum((r) => r.cashFlowMinor),
      valueMinor: sum((r) => r.valueMinor),
      balanceMinor: sum((r) => r.balanceMinor),
    });
  }

  const refinanced = properties.filter((pr) => pr.refi.refinances);
  const rsum = (f: (pr: PropertyProjection) => bigint) => refinanced.reduce((s, pr) => s + f(pr), 0n);
  const cashOut = rsum((pr) => pr.refi.cashOutMinor);
  const refiNoi = refinanced.reduce((s, pr) => s + (pr.years[years - 1]?.noiMinor ?? 0n), 0n);
  const refiDebt = ratePpm == null ? null : rsum((pr) => pr.refi.debtServiceMinor ?? 0n);

  // Members' loans: on a refinanced property, paid off with it; the company's own (on no report property), out of the
  // total cash out first, in proportion to their balances when it is short.
  const reported = new Set(input.properties.map((pr) => pr.project_id));
  const refinancedIds = new Set(refinanced.map((pr) => pr.projectId));
  const memberLoans = input.loans.filter((l) => owner.has(l.loan_id) && l.currency === currency);
  const onRefinanced = memberLoans.filter((l) => l.project_id != null && refinancedIds.has(l.project_id));
  const companyLoans = memberLoans.filter((l) => l.project_id == null || !reported.has(l.project_id));
  const balanceN = (l: MemberReportLoan) => projected.get(l.loan_id) ?? l.balance_minor;
  const companyOwed = companyLoans.reduce((s, l) => s + balanceN(l), 0n);
  const companyRepaid = cashOut <= 0n ? 0n : companyOwed <= cashOut ? companyOwed : cashOut;
  const split = cashOut - companyRepaid;
  const cashFlow = totals.reduce((s, r) => s + r.cashFlowMinor, 0n);
  const members = (cfg.members ?? []).map((m): MemberProjection => {
    const own = onRefinanced.reduce((s, l) => (owner.get(l.loan_id) === m.name ? s + balanceN(l) : s), 0n);
    const mine = companyLoans.reduce((s, l) => (owner.get(l.loan_id) === m.name ? s + balanceN(l) : s), 0n);
    const fromCompany = companyOwed === 0n ? 0n : times(companyRepaid, mine, companyOwed);
    const cashShare = applyBp(split, m.ownership_bp);
    return {
      name: m.name,
      ownershipBp: m.ownership_bp,
      cashShareMinor: cashShare,
      loansBackMinor: own + fromCompany,
      totalMinor: cashShare + own + fromCompany,
      cashFlowMinor: applyBp(cashFlow, m.ownership_bp),
    };
  });

  return {
    currency,
    years,
    asOf: input.asOf,
    properties,
    missing,
    totals,
    refi: {
      year: years,
      valueMinor: rsum((pr) => pr.years[years - 1]?.valueMinor ?? 0n),
      newLoanMinor: rsum((pr) => pr.refi.newLoanMinor),
      payoffMinor: rsum((pr) => pr.refi.payoffMinor),
      payoffMemberLoansMinor: onRefinanced.reduce((s, l) => s + balanceN(l), 0n),
      closingMinor: rsum((pr) => pr.refi.closingMinor),
      cashOutMinor: cashOut,
      companyLoansRepaidMinor: companyRepaid,
      splitMinor: split,
      refinancedCount: refinanced.length,
      ratePpm,
      rateIsToday: p.rate_ppm == null,
      termYears,
      debtServiceMinor: refiDebt,
      dscrMilli: refiDebt == null || refiDebt === 0n ? null : Number((refiNoi * 1000n) / refiDebt),
    },
    cashFlowMinor: cashFlow,
    members,
    assumptions: { growthBp, maintenanceBp, capexBp, stayMonths, emptyMonthsTenths: emptyTenths, turnoverCostMinor: turnoverCost, ltvBp, closingBp },
  };
}
