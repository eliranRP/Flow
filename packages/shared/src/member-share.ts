/**
 * FLOW-1117 (decision 0263): an LLC member's share of the company's properties, two ways.
 *
 * Sell everything: each property's value, less its selling costs (its own selling_cost_bp, else 8%),
 * less its open loans. Refinance: a new loan at the loan-to-value, less the open loans and the closing
 * costs; what is left is cash out, and a property where it is not above zero is not refinanced. The
 * expected rate is the US Treasury yield (5 or 10 years) on the quotes' date, or the trading day
 * before (typed by the owner, else fetched from the Treasury: FLOW-1119), plus the spread; a lender
 * quote at or under it is a good quote. A member's share is their
 * ownership of each total. One calculation for the app and for MCP get_member_share.
 */
import { divHalfEven } from "./money.ts";

export const MEMBER_REPORT_DEFAULTS = {
  ltvBp: 7500,
  closingBp: 200,
  termYears: 30,
  tenorYears: 10 as 5 | 10,
  spreadBp: 150,
  /** The app's default selling cost when a property has none (as get_property_returns). */
  sellingCostBp: 800,
} as const;

/** A quote within this many ppm over the expected rate (0.25%) is near; above it, high. */
export const QUOTE_NEAR_PPM = 2500;

export type LoanType = "fixed" | "arm" | "dscr" | "other";

export type MemberReportQuote = {
  readonly id: string;
  readonly lender: string;
  /** The annual rate in parts per million of the principal (6.125% is 61250). */
  readonly rate_ppm: number;
  readonly points_bp?: number;
  readonly quoted_on: string;
  readonly loan_type?: LoanType;
  readonly project_id?: string | null;
};

export type MemberReportYield = {
  readonly on_date: string;
  readonly y5_ppm?: number | null;
  readonly y10_ppm?: number | null;
  readonly source?: "treasury" | "manual";
};

export type MemberReportConfig = {
  readonly members?: readonly { readonly name: string; readonly ownership_bp: number }[];
  readonly assumptions?: { readonly ltv_bp?: number; readonly closing_bp?: number; readonly term_years?: number };
  readonly rate_rule?: { readonly tenor_years?: 5 | 10; readonly spread_bp?: number };
  readonly quotes?: readonly MemberReportQuote[];
  readonly yields?: readonly MemberReportYield[];
  readonly quote_date?: string | null;
};

export type MemberReportProperty = {
  readonly project_id: string;
  readonly name: string;
  readonly currency: string;
  readonly value_minor: bigint | null;
  readonly value_date: string | null;
  readonly selling_cost_bp: number | null;
  readonly loan_balance_minor: bigint;
  readonly loans_other_currency: boolean;
};

export type PropertyShare = {
  readonly projectId: string;
  readonly name: string;
  readonly valueMinor: bigint;
  readonly valueDate: string | null;
  readonly sellingCostBp: number;
  readonly sellingCostDefault: boolean;
  readonly sellingCostMinor: bigint;
  readonly loanBalanceMinor: bigint;
  /** Value - selling costs - loans: what the company keeps when it sells. Can be below zero. */
  readonly saleNetMinor: bigint;
  readonly newLoanMinor: bigint;
  readonly closingMinor: bigint;
  /** New loan - loans - closing costs. Below zero, the property is not refinanced. */
  readonly cashOutMinor: bigint;
  readonly refinances: boolean;
  /** The new loan's monthly payment at the report's rate; null without a rate or when not refinanced. */
  readonly paymentMinor: bigint | null;
};

export type QuoteVerdict = "good" | "near" | "high";

export type QuoteShare = MemberReportQuote & {
  /** The rate with the points spread over six years (1 point is about 1/6% a year). */
  readonly effectivePpm: number;
  readonly diffPpm: number | null;
  readonly verdict: QuoteVerdict | null;
};

export type MemberShareResult = {
  readonly currency: string | null;
  readonly properties: readonly PropertyShare[];
  /** Properties left out: no value, another currency, or loans in another currency. */
  readonly missing: readonly { readonly projectId: string; readonly name: string; readonly reason: "value" | "currency" | "loan_currency" }[];
  readonly totals: {
    readonly valueMinor: bigint;
    readonly sellingCostMinor: bigint;
    readonly loanBalanceMinor: bigint;
    readonly saleNetMinor: bigint;
    readonly newLoanMinor: bigint;
    readonly payoffMinor: bigint;
    readonly closingMinor: bigint;
    readonly cashOutMinor: bigint;
    readonly paymentMinor: bigint | null;
    readonly refinancedCount: number;
  };
  readonly assumptions: { readonly ltvBp: number; readonly closingBp: number; readonly termYears: number };
  readonly rate: {
    readonly quoteDate: string | null;
    readonly yieldDate: string | null;
    readonly yieldSource: "treasury" | "manual" | null;
    readonly tenorYears: 5 | 10;
    readonly spreadBp: number;
    readonly yieldPpm: number | null;
    readonly expectedPpm: number | null;
    /** The rate the payments use: the expected rate, else the best quote's, else null. */
    readonly paymentPpm: number | null;
  };
  readonly quotes: readonly QuoteShare[];
  readonly members: readonly { readonly name: string; readonly ownershipBp: number; readonly saleMinor: bigint; readonly refinanceMinor: bigint }[];
  readonly ownershipSet: boolean;
};

/** amount × bp / 10000, rounded half to even, either sign. */
export function applyBp(amount: bigint, bp: number): bigint {
  const product = amount * BigInt(bp);
  return product < 0n ? -divHalfEven(-product, 10000n) : divHalfEven(product, 10000n);
}

/** A fixed-rate loan's monthly payment of principal and interest, to the cent. */
export function annuityPaymentMinor(principalMinor: bigint, annualRatePpm: number, termYears: number): bigint {
  if (principalMinor <= 0n || termYears <= 0) return 0n;
  const months = termYears * 12;
  if (annualRatePpm <= 0) return divHalfEven(principalMinor, BigInt(months));
  const r = annualRatePpm / 1_000_000 / 12;
  const payment = (Number(principalMinor) * r) / (1 - (1 + r) ** -months);
  return BigInt(Math.round(payment));
}

function pickCurrency(properties: readonly MemberReportProperty[]): string | null {
  const counts = new Map<string, number>();
  for (const p of properties) if (p.value_minor != null) counts.set(p.currency, (counts.get(p.currency) ?? 0) + 1);
  let best: string | null = null;
  for (const [currency, count] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
    if (best == null || count > (counts.get(best) ?? 0)) best = currency;
  }
  return best;
}

function latest(dates: readonly string[]): string | null {
  return dates.reduce<string | null>((max, d) => (max == null || d > max ? d : max), null);
}

/** The yield on the quote date, or on the closest day before it that has one for the tenor. */
/** A fetched day of the Treasury's yields (FLOW-1119), as get_member_report returns them. */
export type FetchedTreasuryYield = { readonly on_date: string; readonly y5_ppm: number | null; readonly y10_ppm: number | null };

type TenorYield = { onDate: string; ppm: number; source: "treasury" | "manual" };

/**
 * The yield on the quote date, or on the closest day before it that has one for the tenor. A yield the
 * owner typed (the setting's yields) wins over the Treasury's fetched one for its date (FLOW-1119).
 */
function yieldFor(
  typed: readonly MemberReportYield[],
  fetched: readonly FetchedTreasuryYield[],
  date: string | null,
  tenor: 5 | 10,
): TenorYield | null {
  if (date == null) return null;
  const byDate = new Map<string, TenorYield>();
  for (const y of fetched) {
    const ppm = tenor === 5 ? y.y5_ppm : y.y10_ppm;
    if (ppm != null) byDate.set(y.on_date, { onDate: y.on_date, ppm, source: "treasury" });
  }
  for (const y of typed) {
    const ppm = tenor === 5 ? y.y5_ppm : y.y10_ppm;
    if (ppm != null) byDate.set(y.on_date, { onDate: y.on_date, ppm, source: y.source ?? "manual" });
  }
  let found: TenorYield | null = null;
  for (const y of byDate.values()) {
    if (y.onDate > date) continue;
    if (found == null || y.onDate > found.onDate) found = y;
  }
  return found;
}

export function computeMemberShare(
  config: MemberReportConfig | null,
  properties: readonly MemberReportProperty[],
  fetchedYields: readonly FetchedTreasuryYield[] = [],
): MemberShareResult {
  const cfg = config ?? {};
  const ltvBp = cfg.assumptions?.ltv_bp ?? MEMBER_REPORT_DEFAULTS.ltvBp;
  const closingBp = cfg.assumptions?.closing_bp ?? MEMBER_REPORT_DEFAULTS.closingBp;
  const termYears = cfg.assumptions?.term_years ?? MEMBER_REPORT_DEFAULTS.termYears;
  const tenorYears = cfg.rate_rule?.tenor_years ?? MEMBER_REPORT_DEFAULTS.tenorYears;
  const spreadBp = cfg.rate_rule?.spread_bp ?? MEMBER_REPORT_DEFAULTS.spreadBp;
  const quotes = cfg.quotes ?? [];
  const yields = cfg.yields ?? [];

  const quoteDate = cfg.quote_date ?? latest(quotes.map((q) => q.quoted_on))
    ?? latest([...yields, ...fetchedYields].map((y) => y.on_date));
  const y = yieldFor(yields, fetchedYields, quoteDate, tenorYears);
  const yieldPpm = y?.ppm ?? null;
  const expectedPpm = yieldPpm == null ? null : yieldPpm + spreadBp * 100;
  const quoteShares: QuoteShare[] = quotes.map((q) => {
    const diffPpm = expectedPpm == null ? null : q.rate_ppm - expectedPpm;
    return {
      ...q,
      effectivePpm: q.rate_ppm + Math.round(((q.points_bp ?? 0) * 100) / 6),
      diffPpm,
      verdict: diffPpm == null ? null : diffPpm <= 0 ? "good" : diffPpm <= QUOTE_NEAR_PPM ? "near" : "high",
    };
  });
  const bestQuote = quotes.reduce<number | null>((min, q) => (min == null || q.rate_ppm < min ? q.rate_ppm : min), null);
  const paymentPpm = expectedPpm ?? bestQuote;

  const currency = pickCurrency(properties);
  const missing: MemberShareResult["missing"][number][] = [];
  const shares: PropertyShare[] = [];
  for (const p of properties) {
    if (p.value_minor == null) { missing.push({ projectId: p.project_id, name: p.name, reason: "value" }); continue; }
    if (p.currency !== currency) { missing.push({ projectId: p.project_id, name: p.name, reason: "currency" }); continue; }
    if (p.loans_other_currency) { missing.push({ projectId: p.project_id, name: p.name, reason: "loan_currency" }); continue; }
    const sellingCostBp = p.selling_cost_bp ?? MEMBER_REPORT_DEFAULTS.sellingCostBp;
    const sellingCostMinor = applyBp(p.value_minor, sellingCostBp);
    const newLoanMinor = applyBp(p.value_minor, ltvBp);
    const closingMinor = applyBp(newLoanMinor, closingBp);
    const cashOutMinor = newLoanMinor - p.loan_balance_minor - closingMinor;
    const refinances = cashOutMinor > 0n;
    shares.push({
      projectId: p.project_id,
      name: p.name,
      valueMinor: p.value_minor,
      valueDate: p.value_date,
      sellingCostBp,
      sellingCostDefault: p.selling_cost_bp == null,
      sellingCostMinor,
      loanBalanceMinor: p.loan_balance_minor,
      saleNetMinor: p.value_minor - sellingCostMinor - p.loan_balance_minor,
      newLoanMinor,
      closingMinor,
      cashOutMinor,
      refinances,
      paymentMinor: refinances && paymentPpm != null ? annuityPaymentMinor(newLoanMinor, paymentPpm, termYears) : null,
    });
  }

  const sum = (pick: (s: PropertyShare) => bigint, only?: (s: PropertyShare) => boolean) =>
    shares.reduce((total, s) => (only == null || only(s) ? total + pick(s) : total), 0n);
  const refinanced = (s: PropertyShare) => s.refinances;
  const saleNetMinor = sum((s) => s.saleNetMinor);
  const cashOutMinor = sum((s) => s.cashOutMinor, refinanced);
  const members = (cfg.members ?? []).map((m) => ({
    name: m.name,
    ownershipBp: m.ownership_bp,
    saleMinor: applyBp(saleNetMinor, m.ownership_bp),
    refinanceMinor: applyBp(cashOutMinor, m.ownership_bp),
  }));

  return {
    currency,
    properties: shares,
    missing,
    totals: {
      valueMinor: sum((s) => s.valueMinor),
      sellingCostMinor: sum((s) => s.sellingCostMinor),
      loanBalanceMinor: sum((s) => s.loanBalanceMinor),
      saleNetMinor,
      newLoanMinor: sum((s) => s.newLoanMinor, refinanced),
      payoffMinor: sum((s) => s.loanBalanceMinor, refinanced),
      closingMinor: sum((s) => s.closingMinor, refinanced),
      cashOutMinor,
      paymentMinor: paymentPpm == null ? null : sum((s) => s.paymentMinor ?? 0n, refinanced),
      refinancedCount: shares.filter(refinanced).length,
    },
    assumptions: { ltvBp, closingBp, termYears },
    rate: {
      quoteDate,
      yieldDate: y?.onDate ?? null,
      yieldSource: y?.source ?? null,
      tenorYears,
      spreadBp,
      yieldPpm,
      expectedPpm,
      paymentPpm,
    },
    quotes: quoteShares,
    members,
    ownershipSet: members.length > 0,
  };
}
