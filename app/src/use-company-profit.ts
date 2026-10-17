import type { Breakdown, BreakdownDirection, BreakdownLinesPage, Dashboard } from "@flow/shared";

type LinesRows = NonNullable<BreakdownLinesPage>["rows"];
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { type PeriodChoice } from "./period";
import { useHomePreview } from "./preview";
import { waitForAccessToken } from "./wait-for-session";

/**
 * FLOW-140c1. The company profit page reads its figures from the reads the books already have: the
 * month's dashboard, the year's dashboard (מתחילת השנה), one breakdown per direction for projects and
 * for categories, and each category's counted lines. Nothing new on the server.
 */

export type BasisName = "cash" | "invoiced";

/** One project's row: its counted income and expense, and the lines behind them. `shared` is כללי. */
export type ProfitProjectRow = { key: string; name: string; shared: boolean; income: bigint; expense: bigint; profit: bigint; count: number };

/** A category's row for one direction; `amount` is signed (income +, expense −). */
export type ProfitCategoryRow = { key: string; name: string; direction: BreakdownDirection; amount: bigint; count: number; projects: number };

/** One counted line, signed (income +, expense −), with the category group it came from. */
export type ProfitLine = {
  id: string;
  transactionId: string;
  title: string;
  source: string | undefined;
  date: string;
  project: string | null;
  category: string;
  categoryKey: string;
  direction: BreakdownDirection;
  amount: bigint;
};

/** The lines of one category group, as the read returned them (unsigned, on the group's direction). */
export type ProfitLinesInput = { direction: BreakdownDirection; categoryKey: string; categoryName: string; rows: LinesRows };

/** Every read the page needs, before it is shaped. The sample builds the same shape. */
export type ProfitInputs = {
  currency: string;
  basis: BasisName;
  month: { income: bigint; expense: bigint };
  ytdProfit: bigint | null;
  projects: { income: Breakdown | null; expense: Breakdown | null };
  categories: { income: Breakdown | null; expense: Breakdown | null };
  lines: ProfitLinesInput[];
};

export type ProfitModel = {
  currency: string;
  basis: BasisName;
  income: bigint;
  expense: bigint;
  profit: bigint;
  ytdProfit: bigint | null;
  projects: ProfitProjectRow[];
  categories: ProfitCategoryRow[];
  lines: ProfitLine[];
  /** Every counted line is loaded (the date and amount lists need all of them). */
  linesComplete: boolean;
};

function groupsIn(breakdown: Breakdown | null, currency: string) {
  return (breakdown?.groups ?? []).filter((group) => group.currency === currency);
}

/** The page's figures from its inputs. Money is in the company currency; other currencies do not count here. */
export function buildProfitModel(inputs: ProfitInputs, linesComplete = true): ProfitModel {
  const { currency } = inputs;
  const income = inputs.month.income;
  const expense = inputs.month.expense;
  const byProject = new Map<string, ProfitProjectRow>();
  for (const direction of ["income", "expense"] as const) {
    for (const group of groupsIn(inputs.projects[direction], currency)) {
      const row = byProject.get(group.key) ?? { key: group.key, name: group.shared ? "כללי" : group.name ?? "", shared: group.shared, income: 0n, expense: 0n, profit: 0n, count: 0 };
      if (direction === "income") row.income += group.amount_minor;
      else row.expense += group.amount_minor;
      row.count += group.count;
      row.profit = row.income - row.expense;
      byProject.set(group.key, row);
    }
  }
  const projects = [...byProject.values()].sort(byMagnitude((row) => row.profit, (a, b) => a.name.localeCompare(b.name)));
  const categories: ProfitCategoryRow[] = [];
  for (const direction of ["income", "expense"] as const) {
    for (const group of groupsIn(inputs.categories[direction], currency)) {
      const signed = direction === "income" ? group.amount_minor : -group.amount_minor;
      categories.push({ key: group.key, name: group.name ?? "", direction, amount: signed, count: group.count, projects: group.projects ?? 1 });
    }
  }
  categories.sort(byMagnitude((row) => row.amount, (a, b) => a.name.localeCompare(b.name)));
  const lines: ProfitLine[] = [];
  for (const input of inputs.lines) {
    for (const row of input.rows) {
      const signed = input.direction === "income" ? row.amount_minor : -row.amount_minor;
      lines.push({
        id: `${row.transaction_id}:${row.part ?? ""}`,
        transactionId: row.transaction_id,
        source: row.source,
        title: row.supplier_name ?? row.description,
        date: row.doc_date,
        project: row.project_name,
        category: row.category_name ?? input.categoryName,
        categoryKey: input.categoryKey,
        direction: input.direction,
        amount: signed,
      });
    }
  }
  return {
    currency,
    basis: inputs.basis,
    income,
    expense,
    profit: income - expense,
    ytdProfit: inputs.ytdProfit,
    projects,
    categories,
    lines,
    linesComplete,
  };
}

/** Largest magnitude first, a tie by name. */
function byMagnitude<T>(value: (row: T) => bigint, tie: (a: T, b: T) => number): (a: T, b: T) => number {
  return (a, b) => {
    const abs = (n: bigint) => (n < 0n ? -n : n);
    const diff = abs(value(b)) - abs(value(a));
    if (diff !== 0n) return diff > 0n ? 1 : -1;
    return tie(a, b);
  };
}

/** The period's money in one currency: the dashboard's row for it. */
export function monthTotals(dashboard: Dashboard, currency: string): { income: bigint; expense: bigint } {
  const row = dashboard.by_currency.find((figure) => figure.currency === currency);
  if (row) return { income: row.income_minor, expense: row.expense_minor };
  if ((dashboard.base_currency ?? currency) === currency) return { income: dashboard.income_agorot, expense: dashboard.expense_agorot };
  return { income: 0n, expense: 0n };
}

const LINES_PAGE = 40;

type Range = { p_from?: string; p_to?: string };

function rangeArgs(period: PeriodChoice): Range {
  return period.from && period.to ? { p_from: period.from, p_to: period.to } : {};
}

async function readyClient() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  await waitForAccessToken(supabase);
  return supabase;
}

async function fetchDashboard(period: PeriodChoice): Promise<Dashboard> {
  const supabase = await readyClient();
  const { data, error } = await supabase.rpc("get_dashboard", rangeArgs(period));
  if (error) throw error;
  return (await loadReadSchemas()).dashboardSchema.parse(data);
}

async function fetchBreakdown(period: PeriodChoice, direction: BreakdownDirection, groupBy: "project" | "category"): Promise<Breakdown> {
  const supabase = await readyClient();
  const { data, error } = await supabase.rpc("get_breakdown", { ...rangeArgs(period), p_direction: direction, p_group_by: groupBy });
  if (error) throw error;
  return (await loadReadSchemas()).breakdownSchema.parse(data);
}

/** Every page of one category group's counted lines, in the company currency. */
async function fetchAllLines(period: PeriodChoice, direction: BreakdownDirection, key: string, currency: string): Promise<LinesRows> {
  const rows: LinesRows = [];
  const supabase = await readyClient();
  for (let offset = 0; ; offset += LINES_PAGE) {
    const { data, error } = await supabase.rpc("get_breakdown_lines", {
      ...rangeArgs(period),
      p_direction: direction,
      p_group_by: "category",
      p_group_key: key,
      p_currency: currency,
      p_excluded: false,
      p_limit: LINES_PAGE,
      p_offset: offset,
    });
    if (error) throw error;
    const page = (await loadReadSchemas()).breakdownLinesSchema.parse(data);
    rows.push(...(page?.rows ?? []));
    if (page?.has_more !== true) return rows;
  }
}

export type CompanyProfitRead = {
  /** False for a sample: nothing is read. */
  enabled: boolean;
  /** The month's period (the page's own), and the year to date for מתחילת השנה. */
  month: PeriodChoice;
  ytd: PeriodChoice;
  /** The company currency, as the rest of the books show it. */
  currency: string;
  /** Lines load only for the orders that list them (date, amount, category). */
  linesOn: boolean;
};

/**
 * The page's reads, live. Preview mode reads nothing (the screen takes its sample). Query keys start
 * with "dashboard", "breakdown" or "breakdown-lines", so the basis sheet's write refreshes them.
 */
export function useCompanyProfitRead({ enabled, month, ytd, currency, linesOn }: CompanyProfitRead) {
  const preview = useHomePreview();
  const live = enabled && preview === "off";
  const monthRange = `${month.from ?? ""}..${month.to ?? ""}`;
  const dashboard = useQuery({
    queryKey: ["dashboard", "company-profit", preview, monthRange],
    enabled: live,
    placeholderData: keepPreviousData,
    queryFn: () => fetchDashboard(month),
  });
  const ytdDashboard = useQuery({
    queryKey: ["dashboard", "company-profit-ytd", preview, ytd.from ?? "", ytd.to ?? ""],
    enabled: live,
    placeholderData: keepPreviousData,
    queryFn: () => fetchDashboard(ytd),
  });
  const projectIncome = useQuery({ queryKey: ["breakdown", "company-profit", preview, monthRange, "project", "income"], enabled: live, placeholderData: keepPreviousData, queryFn: () => fetchBreakdown(month, "income", "project") });
  const projectExpense = useQuery({ queryKey: ["breakdown", "company-profit", preview, monthRange, "project", "expense"], enabled: live, placeholderData: keepPreviousData, queryFn: () => fetchBreakdown(month, "expense", "project") });
  const categoryIncome = useQuery({ queryKey: ["breakdown", "company-profit", preview, monthRange, "category", "income"], enabled: live, placeholderData: keepPreviousData, queryFn: () => fetchBreakdown(month, "income", "category") });
  const categoryExpense = useQuery({ queryKey: ["breakdown", "company-profit", preview, monthRange, "category", "expense"], enabled: live, placeholderData: keepPreviousData, queryFn: () => fetchBreakdown(month, "expense", "category") });
  const categoryGroups = [
    ...groupsIn(categoryIncome.data ?? null, currency).map((group) => ({ direction: "income" as const, group })),
    ...groupsIn(categoryExpense.data ?? null, currency).map((group) => ({ direction: "expense" as const, group })),
  ].filter((entry) => entry.group.key !== "");
  // Each category group's lines load in parallel, every page of each.
  const lineQueries = useQueries({
    queries: categoryGroups.map(({ direction, group }) => ({
      queryKey: ["breakdown-lines", "company-profit", preview, monthRange, direction, group.key, currency],
      enabled: live && linesOn,
      queryFn: () => fetchAllLines(month, direction, group.key, currency),
    })),
  });
  const linesComplete = categoryGroups.length === 0 || lineQueries.every((query) => query.isSuccess);
  const failed = dashboard.isError || projectIncome.isError || projectExpense.isError || categoryIncome.isError || categoryExpense.isError;
  const ytdTotals = ytdDashboard.data == null ? null : monthTotals(ytdDashboard.data, currency);
  const ready = dashboard.data != null && projectIncome.data !== undefined && projectExpense.data !== undefined && categoryIncome.data !== undefined && categoryExpense.data !== undefined;
  const inputs: ProfitInputs | null = ready && dashboard.data != null
    ? {
        currency,
        basis: dashboard.data.basis,
        month: monthTotals(dashboard.data, currency),
        ytdProfit: ytdTotals == null ? null : ytdTotals.income - ytdTotals.expense,
        projects: { income: projectIncome.data ?? null, expense: projectExpense.data ?? null },
        categories: { income: categoryIncome.data ?? null, expense: categoryExpense.data ?? null },
        lines: categoryGroups.flatMap(({ direction, group }, index) => {
          const result = lineQueries[index]?.data;
          return result == null ? [] : [{ direction, categoryKey: group.key, categoryName: group.name ?? "", rows: result }];
        }),
      }
    : null;
  return {
    failed,
    loading: !failed && inputs == null,
    model: inputs == null ? null : buildProfitModel(inputs, linesComplete),
    refetch: () => {
      void dashboard.refetch();
      void ytdDashboard.refetch();
      void projectIncome.refetch();
      void projectExpense.refetch();
      void categoryIncome.refetch();
      void categoryExpense.refetch();
    },
  };
}
