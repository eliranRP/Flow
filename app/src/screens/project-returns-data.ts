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

export const STATEMENT_LINES = ["income", "opex", "debt_service", "capex", "not_counted"] as const;
export type StatementLine = (typeof STATEMENT_LINES)[number];
/** The lines a line page opens: the statement's, and the principal parts alone. */
export type ReturnLine = StatementLine | "principal";
export const RETURN_LINES: readonly ReturnLine[] = [...STATEMENT_LINES, "principal"];

export const MISSING_INPUTS = ["purchase", "value", "value_history", "land", "tax_bracket", "units"] as const;
export type MissingInput = (typeof MISSING_INPUTS)[number];

const returnsSchema = z.object({
  currency: z.string(),
  from: z.string(),
  to: z.string(),
  days: z.number().int(),
  other_currencies: z.array(z.string()).optional().default([]),
  missing: z.array(z.string()).optional().default([]),
  inputs: z.object({
    purchase_minor: minorOrNull,
    arv_minor: minorOrNull,
    value_minor: minorOrNull,
    value_date: dateOrNull,
    units: intOrNull,
    land_minor: minorOrNull,
    tax_bracket_bp: intOrNull,
    rehab_minor: minorOrNull,
    borrowed_minor: minorOrNull,
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
  }),
  metrics: z.object({
    cash_on_cash_bp: intOrNull,
    cap_rate_bp: intOrNull,
    dscr_milli: intOrNull,
    cash_flow_per_unit_month_minor: minorOrNull,
  }),
});

export type ValueAt = { minor: bigint; date: string };
export type LineCategory = { id: string | null; name: string | null; minor: bigint; count: number };

/** get_property_returns, typed: minor units as bigint, percents in basis points, DSCR × 1000. */
export type PropertyReturns = {
  currency: string;
  from: string;
  to: string;
  days: number;
  otherCurrencies: string[];
  missing: MissingInput[];
  inputs: {
    purchaseMinor: bigint | null;
    arvMinor: bigint | null;
    valueMinor: bigint | null;
    valueDate: string | null;
    units: number | null;
    landMinor: bigint | null;
    taxBracketBp: number | null;
    /** Null while rehab has a cost in another currency. */
    rehabMinor: bigint | null;
    borrowedMinor: bigint | null;
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
  equity: { todayMinor: bigint | null; forcedMinor: bigint | null; moneyInMinor: bigint | null };
  metrics: { cashOnCashBp: number | null; capRateBp: number | null; dscrMilli: number | null; perUnitMonthMinor: bigint | null };
};

function isMissingInput(value: string): value is MissingInput {
  return (MISSING_INPUTS as readonly string[]).includes(value);
}

export function toPropertyReturns(data: unknown): PropertyReturns {
  const raw = returnsSchema.parse(data);
  const st = raw.statement;
  const counts = {} as Record<StatementLine, number>;
  const byCategory = {} as Record<StatementLine, LineCategory[]>;
  for (const line of STATEMENT_LINES) {
    counts[line] = st.lines[line]?.lines ?? 0;
    byCategory[line] = (st.by_category[line] ?? []).map((row) => ({ id: row.category_id, name: row.name, minor: row.amount_minor, count: row.lines }));
  }
  const inp = raw.inputs;
  return {
    currency: raw.currency,
    from: raw.from,
    to: raw.to,
    days: raw.days,
    otherCurrencies: raw.other_currencies,
    missing: raw.missing.filter(isMissingInput),
    inputs: {
      purchaseMinor: inp.purchase_minor,
      arvMinor: inp.arv_minor,
      valueMinor: inp.value_minor,
      valueDate: inp.value_date,
      units: inp.units,
      landMinor: inp.land_minor,
      taxBracketBp: inp.tax_bracket_bp,
      rehabMinor: inp.rehab_minor,
      borrowedMinor: inp.borrowed_minor,
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

/** The lines behind one figure: a line of the period, or `rehab` for all time (the building cost). */
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
