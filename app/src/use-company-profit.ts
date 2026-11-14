import type { Breakdown, BreakdownDirection, BreakdownLinesPage, Dashboard } from "@flow/shared";

type LinesRows = NonNullable<BreakdownLinesPage>["rows"];
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { projectGroupRow } from "./breakdown-project-group";
import type { OverheadProject } from "./overhead-project";
import { loadReadSchemas } from "./load-read-schemas";
import { type PeriodChoice } from "./period";
import { useHomePreview } from "./preview";
import { readyClient } from "./ready-client";

/**
 * FLOW-140c1. The company profit page reads its figures from the reads the books already have: the
 * month's dashboard, the year's dashboard (מתחילת השנה), one breakdown per direction for projects and
 * for categories, and each category's counted lines. Nothing new on the server.
 */

export type BasisName = "cash" | "invoiced";

/**
 * One project's row: its counted income and expense, and the lines behind them. The general costs (get_breakdown's
 * `overhead` and `unassigned`, and the overhead project's own lines) are one row keyed "": the overhead project's
 * name, opening it, or כללי with no `projectId` when none is set. A project opens its profit page.
 */
export type ProfitProjectRow = { key: string; name: string; projectId: string | null; income: bigint; expense: bigint; profit: bigint; count: number };

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
  /** FLOW-946: a gross-up part — a real item netted against a deposit or payment ("paid from deposit"). */
  grossUp?: boolean;
  /** FLOW-954: a line of a kept-out category (לא נספר ברווח), drawn faded. */
  keptOut?: boolean;
};

/** FLOW-954. A kept-out category for one direction: its total positive on its side, and its loan part. */
export type ProfitKeptOutRow = {
  key: string;
  name: string;
  direction: BreakdownDirection;
  total: bigint;
  count: number;
  projects: number;
  loanPart: string | null;
  /** The ledger account its lines post to: asset or liability (null on an older payload). */
  accountType: string | null;
};

/**
 * The lines of one category group, as the read returned them (unsigned, on the group's direction). `keptOut`: every
 * kept-out line of the direction, each under its own category (`category_id`).
 */
export type ProfitLinesInput = { direction: BreakdownDirection; categoryKey: string; categoryName: string; rows: LinesRows; keptOut?: boolean };

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
  /** FLOW-954: the kept-out categories and their lines, for the category view's לא נספר ברווח group. */
  keptOut: ProfitKeptOutRow[];
  keptOutLines: ProfitLine[];
};

function groupsIn(breakdown: Breakdown | null, currency: string) {
  return (breakdown?.groups ?? []).filter((group) => group.currency === currency);
}

/**
 * The page's figures from its inputs and the company's overhead project. Money is in the company currency; other
 * currencies do not count here.
 */
export function buildProfitModel(inputs: ProfitInputs, overhead: OverheadProject | null): ProfitModel {
  const { currency } = inputs;
  const income = inputs.month.income;
  const expense = inputs.month.expense;
  const byProject = new Map<string, ProfitProjectRow>();
  for (const direction of ["income", "expense"] as const) {
    for (const group of groupsIn(inputs.projects[direction], currency)) {
      const { key, title, projectId } = projectGroupRow(group, overhead);
      const row = byProject.get(key) ?? { key, name: title, projectId, income: 0n, expense: 0n, profit: 0n, count: 0 };
      if (direction === "income") row.income += group.amount_minor;
      else row.expense += group.amount_minor;
      row.count += group.count;
      row.profit = row.income - row.expense;
      byProject.set(key, row);
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
  const keptOut: ProfitKeptOutRow[] = [];
  for (const direction of ["income", "expense"] as const) {
    for (const group of inputs.categories[direction]?.excluded_groups ?? []) {
      if (group.currency !== currency) continue;
      keptOut.push({ key: group.key, name: group.name ?? "בלי קטגוריה", direction, total: group.amount_minor, count: group.count, projects: group.projects, loanPart: group.loan_part, accountType: group.account_type ?? null });
    }
  }
  keptOut.sort(byMagnitude((row) => row.total, (a, b) => a.name.localeCompare(b.name)));
  const lines: ProfitLine[] = [];
  const keptOutLines: ProfitLine[] = [];
  for (const input of inputs.lines) {
    const kept = input.keptOut === true;
    for (const row of input.rows) {
      const signed = input.direction === "income" ? row.amount_minor : -row.amount_minor;
      (kept ? keptOutLines : lines).push({
        id: `${row.transaction_id}:${row.part ?? ""}`,
        transactionId: row.transaction_id,
        source: row.source,
        title: row.supplier_name ?? row.description,
        date: row.doc_date,
        project: row.project_name,
        category: row.category_name ?? input.categoryName,
        categoryKey: kept ? (row.category_id ?? "none") : input.categoryKey,
        direction: input.direction,
        amount: signed,
        grossUp: row.gross_up === true,
        ...(kept ? { keptOut: true } : {}),
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
    keptOut,
    keptOutLines,
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
async function fetchAllLines(period: PeriodChoice, direction: BreakdownDirection, key: string, currency: string, excluded = false): Promise<LinesRows> {
  const rows: LinesRows = [];
  const supabase = await readyClient();
  for (let offset = 0; ; offset += LINES_PAGE) {
    const { data, error } = await supabase.rpc("get_breakdown_lines", {
      ...rangeArgs(period),
      p_direction: direction,
      p_group_by: "category",
      p_group_key: key,
      p_currency: currency,
      p_excluded: excluded,
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
  /**
   * The category breakdowns, and through them the counted lines, load only for the orders that list them (category,
   * date, amount). The project order draws the summary and the project rows alone (FLOW-1171).
   */
  categoriesOn: boolean;
  /**
   * The month's figures and its project breakdowns load only in the month view (FLOW-1191). The year and since-the-start
   * views draw from the years' read (get_profit_months), which also holds the basis, and read none of these.
   */
  projectsOn: boolean;
  /** The company's overhead project (useOverheadProject); undefined while it loads keeps the page loading. */
  overhead: OverheadProject | null | undefined;
  /**
   * FLOW-1194. The date and amount orders need every counted line, so each category is read. The category order reads
   * none on entering: a category's lines are read once its id is in `lineIds`.
   */
  linesAll: boolean;
  /** The lines reads asked for, by `linesIdOfRow`. */
  lineIds: ReadonlySet<string>;
};

/**
 * The id of the lines read a category view row needs: the row's own key (`in:` or `out:` and the category), or for a
 * kept-out row (`kept:<direction>:<category>`) the direction's one kept-out read (`kept:<direction>`).
 */
export const linesIdOfRow = (rowKey: string) => (rowKey.startsWith("kept:") ? rowKey.slice(0, rowKey.indexOf(":", 5)) : rowKey);

/**
 * The page's reads, live. Preview mode reads nothing (the screen takes its sample). Query keys start
 * with "dashboard", "breakdown" or "breakdown-lines", so the basis sheet's write refreshes them.
 */
export function useCompanyProfitRead({ enabled, month, ytd, currency, categoriesOn, projectsOn, overhead, linesAll, lineIds }: CompanyProfitRead) {
  const preview = useHomePreview();
  const live = enabled && preview === "off";
  const monthRange = `${month.from ?? ""}..${month.to ?? ""}`;
  const dashboard = useQuery({
    queryKey: ["dashboard", "company-profit", preview, monthRange],
    enabled: live && projectsOn,
    placeholderData: keepPreviousData,
    queryFn: () => fetchDashboard(month),
  });
  const ytdDashboard = useQuery({
    queryKey: ["dashboard", "company-profit-ytd", preview, ytd.from ?? "", ytd.to ?? ""],
    enabled: live && projectsOn,
    placeholderData: keepPreviousData,
    queryFn: () => fetchDashboard(ytd),
  });
  const projectIncome = useQuery({ queryKey: ["breakdown", "company-profit", preview, monthRange, "project", "income"], enabled: live && projectsOn, placeholderData: keepPreviousData, queryFn: () => fetchBreakdown(month, "income", "project") });
  const projectExpense = useQuery({ queryKey: ["breakdown", "company-profit", preview, monthRange, "project", "expense"], enabled: live && projectsOn, placeholderData: keepPreviousData, queryFn: () => fetchBreakdown(month, "expense", "project") });
  const categoryIncome = useQuery({ queryKey: ["breakdown", "company-profit", preview, monthRange, "category", "income"], enabled: live && categoriesOn, placeholderData: keepPreviousData, queryFn: () => fetchBreakdown(month, "income", "category") });
  const categoryExpense = useQuery({ queryKey: ["breakdown", "company-profit", preview, monthRange, "category", "expense"], enabled: live && categoriesOn, placeholderData: keepPreviousData, queryFn: () => fetchBreakdown(month, "expense", "category") });
  const categoryGroups = [
    ...groupsIn(categoryIncome.data ?? null, currency).map((group) => ({ direction: "income" as const, group })),
    ...groupsIn(categoryExpense.data ?? null, currency).map((group) => ({ direction: "expense" as const, group })),
  ].filter((entry) => entry.group.key !== "");
  // FLOW-1194: a category's lines are read once, when the page asks for them (its row scrolled near, or a tap); the
  // cache keeps them. The date and amount orders ask for every category, with the larger page. FLOW-954: every
  // kept-out line of a direction is one read (p_excluded), when it has a kept-out category.
  const keptOutDirections = (["income", "expense"] as const).filter((direction) =>
    ((direction === "income" ? categoryIncome.data : categoryExpense.data)?.excluded_groups ?? []).some((group) => group.currency === currency));
  const lineReads = [
    ...categoryGroups.map(({ direction, group }) => ({ id: `${direction === "income" ? "in" : "out"}:${group.key}`, direction, key: group.key, name: group.name ?? "", keptOut: false })),
    ...keptOutDirections.map((direction) => ({ id: `kept:${direction}`, direction, key: "", name: "", keptOut: true })),
  ];
  const lineQueries = useQueries({
    queries: lineReads.map((read) => ({
      queryKey: ["breakdown-lines", "company-profit", preview, monthRange, read.direction, read.keptOut ? "kept-out" : read.key, currency],
      enabled: live && categoriesOn && ((linesAll && !read.keptOut) || lineIds.has(read.id)),
      queryFn: () => fetchAllLines(month, read.direction, read.key, currency, read.keptOut),
    })),
  });
  // A read that failed in another view or order stays in the cache with its error: only a view that reads it
  // counts it.
  const failed = projectsOn && (dashboard.isError || projectIncome.isError || projectExpense.isError
    || (categoriesOn && (categoryIncome.isError || categoryExpense.isError)));
  const ytdTotals = ytdDashboard.data == null ? null : monthTotals(ytdDashboard.data, currency);
  // A category read the order does not draw is not waited for (FLOW-1171).
  const categoriesReady = !categoriesOn || (categoryIncome.data !== undefined && categoryExpense.data !== undefined);
  const ready = projectsOn && dashboard.data != null && projectIncome.data !== undefined && projectExpense.data !== undefined && categoriesReady;
  const inputs: ProfitInputs | null = ready
    ? {
        currency,
        basis: dashboard.data.basis,
        month: monthTotals(dashboard.data, currency),
        ytdProfit: ytdTotals == null ? null : ytdTotals.income - ytdTotals.expense,
        projects: { income: projectIncome.data ?? null, expense: projectExpense.data ?? null },
        categories: { income: categoryIncome.data ?? null, expense: categoryExpense.data ?? null },
        lines: lineReads.flatMap((read, index) => {
          const rows = lineQueries[index]?.data;
          return rows == null ? [] : [{ direction: read.direction, categoryKey: read.key, categoryName: read.name, rows, keptOut: read.keptOut }];
        }),
      }
    : null;
  return {
    failed,
    /** FLOW-1194: where an asked-for category's lines stand while they are not in: loading, or failed (retryLines reads again). */
    linesState: (rowKey: string): "loading" | "failed" | null => {
      const query = lineQueries[lineReads.findIndex((read) => read.id === linesIdOfRow(rowKey))];
      return query?.isError === true ? "failed" : query?.isPending === true && lineIds.has(linesIdOfRow(rowKey)) ? "loading" : null;
    },
    retryLines: (rowKey: string) => { void lineQueries[lineReads.findIndex((read) => read.id === linesIdOfRow(rowKey))]?.refetch(); },
    /** FLOW-969: when the month's figures were read, for the offline line (0 before any read). */
    readAt: dashboard.dataUpdatedAt,
    loading: !failed && (inputs == null || overhead === undefined),
    model: inputs == null || overhead === undefined ? null : buildProfitModel(inputs, overhead),
    refetch: () => {
      // refetch ignores `enabled`: a read the view or order does not draw stays unread.
      if (!projectsOn) return;
      void dashboard.refetch();
      void ytdDashboard.refetch();
      void projectIncome.refetch();
      void projectExpense.refetch();
      if (categoriesOn) {
        void categoryIncome.refetch();
        void categoryExpense.refetch();
      }
    },
  };
}
