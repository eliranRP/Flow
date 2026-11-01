import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { getSupabase } from "../lib/supabase";
import { useHomePreview } from "../preview";
import { waitForAccessToken } from "../wait-for-session";

/* ------------------------------------------------------------------------------------------------
 * FLOW-451 (decision 0244): a property's returns, read by get_property_returns for the last 12
 * months, and the lines behind one figure, read by get_property_return_lines 50 at a time. Both sit
 * under the "project" key, so an investment save or a tax bracket refreshes them.
 * ---------------------------------------------------------------------------------------------- */

const minorInput = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]);
const minor = minorInput.transform((value) => BigInt(value));
const minorOrNull = minorInput.nullable().optional().transform((value) => (value == null ? null : BigInt(value)));
const intOrNull = z.number().int().nullable().optional().transform((value) => value ?? null);
const dateOrNull = z.string().nullable().optional().transform((value) => value ?? null);

const valueAtSchema = z
  .object({ value_minor: minor, value_date: z.string() })
  .nullable()
  .optional()
  .transform((value) => (value == null ? null : { minor: value.value_minor, date: value.value_date }));

const lineSumSchema = z.object({ amount_minor: minor, lines: z.number().int() });
const lineCategorySchema = z.object({
  category_id: z.string().nullable(),
  name: z.string().nullable(),
  amount_minor: minor,
  lines: z.number().int(),
});

/**
 * The statement's lines for the period (FLOW-453, decision 0245): the four from the first rent on,
 * then the two shown apart. `before_rent` is the server's holding and renovation lines of the
 * period, `not_counted` its acquisition and financing lines.
 */
export const STATEMENT_LINES = ["income", "opex", "debt_service", "capex", "before_rent", "not_counted"] as const;
export type StatementLine = (typeof STATEMENT_LINES)[number];
/** The money in the deal by part, and the four together: all time, no period. */
export const ALL_TIME_LINES = ["acquisition", "renovation", "holding", "financing", "money_in"] as const;
export type AllTimeLine = (typeof ALL_TIME_LINES)[number];
/** The lines a line page opens: the statement's, the principal parts alone, and the money in's. */
export type ReturnLine = StatementLine | "principal" | AllTimeLine;
export const RETURN_LINES: readonly ReturnLine[] = [...STATEMENT_LINES, "principal", ...ALL_TIME_LINES];

export function isAllTimeLine(line: string): line is AllTimeLine {
  return (ALL_TIME_LINES as readonly string[]).includes(line);
}

/** The server's lines behind each statement line. */
const SERVER_LINES: Record<StatementLine, readonly string[]> = {
  income: ["income"],
  opex: ["opex"],
  debt_service: ["debt_service"],
  capex: ["capex"],
  before_rent: ["holding", "renovation"],
  not_counted: ["acquisition", "financing"],
};

export const MISSING_INPUTS = ["purchase", "value", "value_history", "land", "tax_bracket"] as const;
export type MissingInput = (typeof MISSING_INPUTS)[number];

const takenOverSchema = z.object({ loan_id: z.string(), name: z.string().nullable().optional().transform((value) => value ?? ""), principal_minor: minor });

const returnsSchema = z.object({
  currency: z.string(),
  from: z.string(),
  to: z.string(),
  days: z.number().int(),
  first_rent: dateOrNull,
  other_currencies: z.array(z.string()).optional().default([]),
  missing: z.array(z.string()).optional().default([]),
  inputs: z.object({
    purchase_minor: minorOrNull,
    purchase_source: z.enum(["lines", "typed"]).nullable().optional().transform((value) => value ?? null),
    purchase_typed_minor: minorOrNull,
    arv_minor: minorOrNull,
    value_minor: minorOrNull,
    value_date: dateOrNull,
    units: z.number().int().nullable().optional().transform((value) => value ?? 1),
    units_default: z.boolean().nullable().optional().transform((value) => value === true),
    taken_over_minor: minor.nullable().optional().transform((value) => value ?? 0n),
    taken_over_loans: z.array(takenOverSchema).optional().default([]),
    land_minor: minorOrNull,
    tax_bracket_bp: intOrNull,
    rehab_minor: minorOrNull,
    loan_balance_minor: minorOrNull,
    value_start: valueAtSchema,
    value_end: valueAtSchema,
  }),
  statement: z.object({
    income_minor: minor,
    opex_minor: minor,
    noi_minor: minor,
    debt_service_minor: minor,
    capex_minor: minor,
    cash_flow_minor: minor,
    before_rent_minor: minor.optional().default(0n),
    not_counted_minor: minor,
    lines: z.record(z.string(), lineSumSchema).optional().default({}),
    by_category: z.record(z.string(), z.array(lineCategorySchema)).optional().default({}),
  }),
  sources: z.object({
    cash_flow_minor: minor,
    principal_minor: minor,
    appreciation_minor: minorOrNull,
    tax_savings_minor: minorOrNull,
    depreciation_year_minor: minorOrNull,
    building_minor: minorOrNull,
    total_minor: minor,
    total_bp: intOrNull,
  }),
  equity: z.object({
    equity_today_minor: minorOrNull,
    forced_equity_minor: minorOrNull,
    money_in_minor: minorOrNull,
    money_in_parts: z
      .object({ acquisition_minor: minorOrNull, renovation_minor: minor, holding_minor: minor, financing_minor: minor })
      .optional()
      .default({ acquisition_minor: null, renovation_minor: 0n, holding_minor: 0n, financing_minor: 0n }),
    all_cash_out: z.boolean().nullable().optional().transform((value) => value === true),
  }),
  metrics: z.object({
    cash_on_cash_bp: intOrNull,
    cap_rate_bp: intOrNull,
    dscr_milli: intOrNull,
    cash_flow_per_unit_month_minor: minor,
  }),
});

export type ValueAt = { minor: bigint; date: string };
export type TakenOverLoan = { id: string; name: string; minor: bigint };
export type LineCategory = { id: string | null; name: string | null; minor: bigint; count: number };

/** get_property_returns, typed: minor units as bigint, percents in basis points, DSCR × 1000. */
export type PropertyReturns = {
  currency: string;
  from: string;
  to: string;
  days: number;
  /** YYYY-MM-DD: the first rent payment; null before it. */
  firstRent: string | null;
  otherCurrencies: string[];
  missing: MissingInput[];
  inputs: {
    /** The acquisition lines, or the typed price when there are none. */
    purchaseMinor: bigint | null;
    purchaseSource: "lines" | "typed" | null;
    purchaseTypedMinor: bigint | null;
    arvMinor: bigint | null;
    valueMinor: bigint | null;
    valueDate: string | null;
    /** 1 until the owner sets it (decision 0246). */
    units: number;
    unitsDefault: boolean;
    /** A loan paid out at closing without passing through the bank (Sub2), inside the purchase; 0 when none. */
    takenOverMinor: bigint;
    takenOverLoans: TakenOverLoan[];
    landMinor: bigint | null;
    taxBracketBp: number | null;
    /** Null while rehab has a cost in another currency. */
    rehabMinor: bigint | null;
    loanBalanceMinor: bigint | null;
    valueStart: ValueAt | null;
    valueEnd: ValueAt | null;
  };
  statement: {
    incomeMinor: bigint;
    opexMinor: bigint;
    noiMinor: bigint;
    debtServiceMinor: bigint;
    capexMinor: bigint;
    cashFlowMinor: bigint;
    /** The period's holding and renovation before the first rent, not in the cash flow. */
    beforeRentMinor: bigint;
    notCountedMinor: bigint;
    /** How many transactions each line holds (0 when it has none). */
    counts: Record<StatementLine, number>;
    /** Each line's categories, largest first. */
    byCategory: Record<StatementLine, LineCategory[]>;
  };
  sources: {
    cashFlowMinor: bigint;
    principalMinor: bigint;
    appreciationMinor: bigint | null;
    taxSavingsMinor: bigint | null;
    depreciationYearMinor: bigint | null;
    buildingMinor: bigint | null;
    totalMinor: bigint;
    totalBp: number | null;
  };
  equity: {
    todayMinor: bigint | null;
    forcedMinor: bigint | null;
    moneyInMinor: bigint | null;
    /** Signed as the lines: costs negative, the loan proceeds positive. Acquisition is null with no purchase at all. */
    moneyInParts: MoneyInParts;
    /** Money in at or below zero: all the cash came out, and the per-cent figures are null. */
    allCashOut: boolean;
  };
  metrics: { cashOnCashBp: number | null; capRateBp: number | null; dscrMilli: number | null; perUnitMonthMinor: bigint };
};

export type MoneyInParts = { acquisitionMinor: bigint | null; renovationMinor: bigint; holdingMinor: bigint; financingMinor: bigint };

function isMissingInput(value: string): value is MissingInput {
  return (MISSING_INPUTS as readonly string[]).includes(value);
}

/** Two server lines' categories as one list: a category in both added up, largest first. */
function mergeCategories(lists: readonly LineCategory[][]): LineCategory[] {
  const filled = lists.filter((list) => list.length > 0);
  if (filled.length <= 1) return filled[0] ?? [];
  const byId = new Map<string, LineCategory>();
  for (const item of filled.flat()) {
    const key = item.id ?? "";
    const seen = byId.get(key);
    byId.set(key, seen == null ? { ...item } : { ...seen, minor: seen.minor + item.minor, count: seen.count + item.count });
  }
  const size = (value: bigint) => (value < 0n ? -value : value);
  return [...byId.values()].sort((a, b) => (size(b.minor) > size(a.minor) ? 1 : size(b.minor) < size(a.minor) ? -1 : 0));
}

export function toPropertyReturns(data: unknown): PropertyReturns {
  const raw = returnsSchema.parse(data);
  const st = raw.statement;
  const counts = {} as Record<StatementLine, number>;
  const byCategory = {} as Record<StatementLine, LineCategory[]>;
  for (const line of STATEMENT_LINES) {
    const own = SERVER_LINES[line];
    counts[line] = own.reduce((sum, key) => sum + (st.lines[key]?.lines ?? 0), 0);
    byCategory[line] = mergeCategories(own.map((key) => (st.by_category[key] ?? []).map((row) => ({ id: row.category_id, name: row.name, minor: row.amount_minor, count: row.lines }))));
  }
  const inp = raw.inputs;
  return {
    currency: raw.currency,
    from: raw.from,
    to: raw.to,
    days: raw.days,
    firstRent: raw.first_rent,
    otherCurrencies: raw.other_currencies,
    missing: raw.missing.filter(isMissingInput),
    inputs: {
      purchaseMinor: inp.purchase_minor,
      purchaseSource: inp.purchase_source,
      purchaseTypedMinor: inp.purchase_typed_minor,
      arvMinor: inp.arv_minor,
      valueMinor: inp.value_minor,
      valueDate: inp.value_date,
      units: inp.units,
      unitsDefault: inp.units_default,
      takenOverMinor: inp.taken_over_minor,
      takenOverLoans: inp.taken_over_loans.map((loan) => ({ id: loan.loan_id, name: loan.name, minor: loan.principal_minor })),
      landMinor: inp.land_minor,
      taxBracketBp: inp.tax_bracket_bp,
      rehabMinor: inp.rehab_minor,
      loanBalanceMinor: inp.loan_balance_minor,
      valueStart: inp.value_start,
      valueEnd: inp.value_end,
    },
    statement: {
      incomeMinor: st.income_minor,
      opexMinor: st.opex_minor,
      noiMinor: st.noi_minor,
      debtServiceMinor: st.debt_service_minor,
      capexMinor: st.capex_minor,
      cashFlowMinor: st.cash_flow_minor,
      beforeRentMinor: st.before_rent_minor,
      notCountedMinor: st.not_counted_minor,
      counts,
      byCategory,
    },
    sources: {
      cashFlowMinor: raw.sources.cash_flow_minor,
      principalMinor: raw.sources.principal_minor,
      appreciationMinor: raw.sources.appreciation_minor,
      taxSavingsMinor: raw.sources.tax_savings_minor,
      depreciationYearMinor: raw.sources.depreciation_year_minor,
      buildingMinor: raw.sources.building_minor,
      totalMinor: raw.sources.total_minor,
      totalBp: raw.sources.total_bp,
    },
    equity: {
      todayMinor: raw.equity.equity_today_minor,
      forcedMinor: raw.equity.forced_equity_minor,
      moneyInMinor: raw.equity.money_in_minor,
      moneyInParts: {
        acquisitionMinor: raw.equity.money_in_parts.acquisition_minor,
        renovationMinor: raw.equity.money_in_parts.renovation_minor,
        holdingMinor: raw.equity.money_in_parts.holding_minor,
        financingMinor: raw.equity.money_in_parts.financing_minor,
      },
      allCashOut: raw.equity.all_cash_out,
    },
    metrics: {
      cashOnCashBp: raw.metrics.cash_on_cash_bp,
      capRateBp: raw.metrics.cap_rate_bp,
      dscrMilli: raw.metrics.dscr_milli,
      perUnitMonthMinor: raw.metrics.cash_flow_per_unit_month_minor,
    },
  };
}

const lineRowSchema = z.object({
  transaction_id: z.string(),
  description: z.string().nullable().optional().transform((value) => value ?? ""),
  supplier_name: z.string().nullable().optional().transform((value) => value ?? null),
  category_id: z.string().nullable().optional().transform((value) => value ?? null),
  category_name: z.string().nullable().optional().transform((value) => value ?? null),
  date: z.string(),
  amount_minor: minor,
  parts: z.string().nullable().optional().transform((value) => value ?? null),
  shared: z.boolean().nullable().optional().transform((value) => value === true),
  /** Not sent yet; the row's source icon reads it when it is. */
  source: z.string().nullable().optional().transform((value) => value ?? null),
});

const linesPageSchema = z.object({
  line: z.string(),
  currency: z.string(),
  total_minor: minor,
  count: z.number().int(),
  has_more: z.boolean(),
  rows: z.array(lineRowSchema),
});

export type ReturnLineRow = {
  transactionId: string;
  description: string;
  supplierName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  /** YYYY-MM-DD. */
  date: string;
  /** Signed as in the statement: costs negative. */
  minor: bigint;
  /** The loan parts in the line ("interest,principal"), null when none. */
  parts: string | null;
  shared: boolean;
  source: string | null;
};

export type ReturnLinesPage = { currency: string; totalMinor: bigint; count: number; hasMore: boolean; rows: ReturnLineRow[] };

export function toReturnLinesPage(data: unknown): ReturnLinesPage {
  const raw = linesPageSchema.parse(data);
  return {
    currency: raw.currency,
    totalMinor: raw.total_minor,
    count: raw.count,
    hasMore: raw.has_more,
    rows: raw.rows.map((row) => ({
      transactionId: row.transaction_id,
      description: row.description,
      supplierName: row.supplier_name,
      categoryId: row.category_id,
      categoryName: row.category_name,
      date: row.date,
      minor: row.amount_minor,
      parts: row.parts,
      shared: row.shared,
      source: row.source,
    })),
  };
}

/** The read's own key: under "project", so an investment save refreshes it. */
export function returnsKey(preview: string, projectId: string): readonly unknown[] {
  return ["project", preview, projectId, "returns"];
}

/** get_property_returns for the default period (the last 12 months to today). */
export function usePropertyReturnsQuery(projectId: string, enabled = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: returnsKey(preview, projectId),
    enabled: enabled && preview === "off" && projectId !== "",
    staleTime: 10_000,
    queryFn: async (): Promise<PropertyReturns> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("get_property_returns", { p_project_id: projectId });
      if (error) throw error;
      return toPropertyReturns(data);
    },
  });
}

export const LINES_PAGE = 50;

/** The lines behind one figure: a line of the period, or one for all time (the money in's, `rehab` the building cost). */
export type LinesSource = ReturnLine | "rehab";

/** get_property_return_lines, 50 at a time, newest first; `categoryId` narrows to one category. */
export function usePropertyReturnLinesQuery(projectId: string, line: LinesSource, categoryId: string | null, enabled = true) {
  const preview = useHomePreview();
  return useInfiniteQuery({
    queryKey: ["project", preview, projectId, "return-lines", line, categoryId ?? ""],
    enabled: enabled && preview === "off" && projectId !== "",
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<ReturnLinesPage> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("get_property_return_lines", {
        p_project_id: projectId,
        p_line: line,
        ...(categoryId == null ? {} : { p_category_id: categoryId }),
        p_limit: LINES_PAGE,
        p_offset: pageParam,
      });
      if (error) throw error;
      return toReturnLinesPage(data);
    },
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length * LINES_PAGE : undefined),
  });
}

/* ------------------------------------------------------------------------------------------------
 * Figures as text: percents from basis points, DSCR from thousandths. The minus is U+2212.
 * ---------------------------------------------------------------------------------------------- */

function signed(text: string, negative: boolean): string {
  return negative ? `−${text}` : text;
}

/** 920 → "9.2%", −150 → "−1.5%". */
export function percentText(bp: number): string {
  return `${signed((Math.abs(bp) / 100).toFixed(1), bp < 0)}%`;
}

/** 1800 → "1.80". */
export function dscrText(milli: number): string {
  return signed((Math.abs(milli) / 1000).toFixed(2), milli < 0);
}

/** 2400 → "24%", 2450 → "24.5%". */
export function bracketText(bp: number): string {
  const whole = bp % 100 === 0;
  return `${whole ? String(bp / 100) : String(Number((bp / 100).toFixed(2)))}%`;
}

/** A part's share of the money in the deal, per year, in basis points; null when there is no money in. */
export function shareOfMoneyIn(part: bigint, moneyIn: bigint | null, days: number): number | null {
  if (moneyIn == null || moneyIn <= 0n || days <= 0) return null;
  return Math.round((Number(part) * 365 * 10_000) / (days * Number(moneyIn)));
}
