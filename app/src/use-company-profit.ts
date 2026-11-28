import type { Breakdown, BreakdownDirection, BreakdownLinesAll, BreakdownLinesPage, Dashboard } from "@flow/shared";
import { keepPreviousData, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAfterFirstPaint } from "./after-paint";
import { useCompanyCurrencyQuery } from "./company-currency";
import { projectGroupRow } from "./breakdown-project-group";
import type { OverheadProject } from "./overhead-project";
import { loadReadSchemas } from "./load-read-schemas";
import { type PeriodChoice } from "./period";
import { useHomePreview } from "./preview";
import { readyClient, type Ctx } from "./ready-client";

type PageRow = NonNullable<BreakdownLinesPage>["rows"][number];
/** A keyed read's row, or the no-key read's with its category id put back, which has no `category_name`, `currency` or `shared` (FLOW-1228). */
type KeyedRow = Omit<PageRow, "category_name" | "currency" | "shared"> & Partial<Pick<PageRow, "category_name" | "currency" | "shared">>;
type AllRows = NonNullable<BreakdownLinesAll>["rows"];

/**
 * FLOW-140c1. The company profit page reads its figures from the reads the books already have: the
 * month's dashboard, the year's dashboard (מתחילת השנה), one breakdown per direction for projects and
 * for categories, and the counted lines: a category's own (the category order), or each direction's in one read
 * (the date and amount orders, FLOW-1207). Nothing else new on the server.
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
export type ProfitLinesInput = { direction: BreakdownDirection; categoryKey: string; categoryName: string; rows: KeyedRow[]; keptOut?: boolean };

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
        // The no-key read's rows have no name of their own (FLOW-1228): the group's name, from get_breakdown. A keyed read's row names its category.
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

/** The page size of the paged line reads: the largest one the server gives (get_breakdown_lines caps p_limit at 200). */
const LINES_PAGE_ALL = 200;

type Range = { p_from?: string; p_to?: string };

function rangeArgs(period: PeriodChoice): Range {
  return period.from && period.to ? { p_from: period.from, p_to: period.to } : {};
}

async function fetchDashboard(period: PeriodChoice, q: Ctx): Promise<Dashboard> {
  const supabase = await readyClient(q);
  const { data, error } = await supabase.rpc("get_dashboard", rangeArgs(period));
  if (error) throw error;
  return (await loadReadSchemas()).dashboardSchema.parse(data);
}

async function fetchBreakdown(period: PeriodChoice, direction: BreakdownDirection, groupBy: "project" | "category", q: Ctx): Promise<Breakdown> {
  const supabase = await readyClient(q);
  const { data, error } = await supabase.rpc("get_breakdown", { ...rangeArgs(period), p_direction: direction, p_group_by: groupBy });
  if (error) throw error;
  return (await loadReadSchemas()).breakdownSchema.parse(data);
}

/** Every page of one category group's counted lines (or a direction's kept-out lines), in the company currency. */
async function fetchAllLines(period: PeriodChoice, direction: BreakdownDirection, key: string, currency: string, q: Ctx, excluded = false): Promise<KeyedRow[]> {
  const supabase = await readyClient(q);
  const rows: KeyedRow[] = [];
  for (let offset = 0; ; offset += LINES_PAGE_ALL) {
    const { data, error } = await supabase.rpc("get_breakdown_lines", {
      ...rangeArgs(period),
      p_direction: direction,
      p_group_by: "category",
      p_group_key: key,
      p_currency: currency,
      p_excluded: excluded,
      p_limit: LINES_PAGE_ALL,
      p_offset: offset,
    });
    if (error) throw error;
    const page = (await loadReadSchemas()).breakdownLinesSchema.parse(data);
    rows.push(...(page?.rows ?? []));
    if (page?.has_more !== true) return rows;
  }
}

/**
 * FLOW-1207, FLOW-1211. Every counted line of a direction in one read, with no group key: each row names its group
 * (`group_key`: the category id, or "none"). The read has no page. Should the database answer a page all the same (an
 * older function that binds the null limit to its default of 40: a rollback, or this app ahead of the migration), the
 * lines are read again in pages of 200 by offset, the first page's `count` saying how many follow, so they are always
 * complete.
 */
async function fetchDirectionLines(period: PeriodChoice, direction: BreakdownDirection, currency: string, q: Ctx): Promise<AllRows> {
  const supabase = await readyClient(q);
  const schemas = await loadReadSchemas();
  const readPage = async (limit: number | null, offset: number) => {
    const { data, error } = await supabase.rpc("get_breakdown_lines", {
      ...rangeArgs(period),
      p_direction: direction,
      p_group_by: "category",
      // The generated types type a nullable argument as required (repo precedent: null as unknown as string).
      p_group_key: null as unknown as string,
      p_currency: currency,
      p_excluded: false,
      // No limit: the whole direction. An omitted argument would default to 40.
      p_limit: limit as number,
      ...(limit === null ? {} : { p_offset: offset }),
    });
    if (error) throw error;
    return schemas.breakdownLinesAllSchema.parse(data);
  };
  const whole = await readPage(null, 0);
  if (whole?.has_more !== true) return whole?.rows ?? [];
  const first = await readPage(LINES_PAGE_ALL, 0);
  const rows: AllRows = [...(first?.rows ?? [])];
  if (first?.has_more !== true) return rows;
  if (first.count !== undefined) {
    const offsets = Array.from({ length: Math.max(0, Math.ceil(first.count / LINES_PAGE_ALL) - 1) }, (_, index) => (index + 1) * LINES_PAGE_ALL);
    for (const page of await Promise.all(offsets.map((offset) => readPage(LINES_PAGE_ALL, offset)))) rows.push(...(page?.rows ?? []));
    return rows;
  }
  for (let offset = LINES_PAGE_ALL; ; offset += LINES_PAGE_ALL) {
    const page = await readPage(LINES_PAGE_ALL, offset);
    rows.push(...(page?.rows ?? []));
    if (page?.has_more !== true) return rows;
  }
}

/**
 * A category's own read, as the keyed read answers it, from the direction's rows: in the same order, with the category id
 * put back (the key, null for "none"). The no-key row also lacks `category_name`, `currency` and `shared` (FLOW-1228): the page
 * takes the name from the category's group (`ProfitLinesInput.categoryName`) and reads the other two nowhere.
 */
function keyedRowsOf(rows: AllRows, key: string): KeyedRow[] {
  return rows.filter((row) => row.group_key === key).map(({ group_key: _group, ...row }) => ({ ...row, category_id: key === "none" ? null : key }));
}

const DIRECTIONS = ["income", "expense"] as const;

/** The cache key of a category group's lines (or, with "all", a direction's lean lines; with "kept-out", its kept-out lines). */
function linesCacheKey(preview: string, monthRange: string, direction: BreakdownDirection, key: string, currency: string) {
  return ["breakdown-lines", "company-profit", preview, monthRange, direction, key, currency];
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
  /**
   * FLOW-1210. The order draws the project rows (לפי פרויקט): its project breakdowns hold `ready`. In the other orders
   * they load once the figures have drawn, so a switch to לפי פרויקט finds them in, and `ready` does not wait for them.
   */
  projectsDrawn: boolean;
  /** The company's overhead project (useOverheadProject); undefined while it loads keeps the page loading. */
  overhead: OverheadProject | null | undefined;
  /**
   * FLOW-1194, FLOW-1207, FLOW-1211. The date and amount orders need every counted line: one read of each direction,
   * with no group key, started with the page (it does not wait for the breakdowns). The category order reads none on entering: a category's lines are read once its id is in `lineIds`.
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

/** One of the month's breakdowns, kept and drawn again from the last answer while the month changes. */
function useBreakdownRead(preview: string, month: PeriodChoice, group: "project" | "category", direction: BreakdownDirection, enabled: boolean) {
  return useQuery({
    queryKey: ["breakdown", "company-profit", preview, `${month.from ?? ""}..${month.to ?? ""}`, group, direction],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: (q) => fetchBreakdown(month, direction, group, q),
  });
}

/**
 * The page's reads, live. Preview mode reads nothing (the screen takes its sample). Query keys start
 * with "dashboard", "breakdown" or "breakdown-lines", so the basis sheet's write refreshes them.
 */
export function useCompanyProfitRead({ enabled, month, ytd, currency, categoriesOn, projectsOn, projectsDrawn, overhead, linesAll, lineIds }: CompanyProfitRead) {
  const preview = useHomePreview();
  const client = useQueryClient();
  const live = enabled && preview === "off";
  // A read keyed by the currency waits for it: the phone has the last one, else the first read says (an earlier read for the
  // fallback currency would be wasted).
  const currencyKnown = useCompanyCurrencyQuery(live).data !== undefined;
  const monthRange = `${month.from ?? ""}..${month.to ?? ""}`;
  const dashboard = useQuery({
    queryKey: ["dashboard", "company-profit", preview, monthRange],
    enabled: live && projectsOn,
    placeholderData: keepPreviousData,
    queryFn: (q) => fetchDashboard(month, q),
  });
  const ytdDashboard = useQuery({
    queryKey: ["dashboard", "company-profit-ytd", preview, ytd.from ?? "", ytd.to ?? ""],
    enabled: live && projectsOn,
    placeholderData: keepPreviousData,
    queryFn: (q) => fetchDashboard(ytd, q),
  });
  const categoryIncome = useBreakdownRead(preview, month, "category", "income", live && categoriesOn);
  const categoryExpense = useBreakdownRead(preview, month, "category", "expense", live && categoriesOn);
  // A category read the order does not draw is not waited for (FLOW-1171).
  const categoriesReady = !categoriesOn || (categoryIncome.data !== undefined && categoryExpense.data !== undefined);
  // FLOW-1210: the project breakdowns are drawn by לפי פרויקט alone. In the other orders they start once the figures have
  // drawn (the same after-paint hook as the forecast), and `ready` does not wait for them.
  const figuresIn = projectsOn && dashboard.data != null && categoriesReady;
  const painted = useAfterFirstPaint(figuresIn);
  const projectReads = live && projectsOn && (projectsDrawn || painted);
  const projectIncome = useBreakdownRead(preview, month, "project", "income", projectReads);
  const projectExpense = useBreakdownRead(preview, month, "project", "expense", projectReads);
  const categoryGroups = [
    ...groupsIn(categoryIncome.data ?? null, currency).map((group) => ({ direction: "income" as const, group })),
    ...groupsIn(categoryExpense.data ?? null, currency).map((group) => ({ direction: "expense" as const, group })),
  ].filter((entry) => entry.group.key !== "");
  // FLOW-1194: a category's lines are read once, when the page asks for them (its row scrolled near, or a tap); the
  // cache keeps them. FLOW-1207: the date and amount orders read a direction's every counted line in one paged read,
  // with no group key, instead of one read per category. FLOW-954: every kept-out line of a direction is one read
  // (p_excluded), when it has a kept-out category.
  const keptOutDirections = (["income", "expense"] as const).filter((direction) =>
    ((direction === "income" ? categoryIncome.data : categoryExpense.data)?.excluded_groups ?? []).some((group) => group.currency === currency));
  const lineReads = [
    ...categoryGroups.map(({ direction, group }) => ({ id: `${direction === "income" ? "in" : "out"}:${group.key}`, direction, key: group.key, name: group.name ?? "", keptOut: false })),
    ...keptOutDirections.map((direction) => ({ id: `kept:${direction}`, direction, key: "", name: "", keptOut: true })),
  ];
  const lineQueries = useQueries({
    queries: lineReads.map((read) => ({
      queryKey: linesCacheKey(preview, monthRange, read.direction, read.keptOut ? "kept-out" : read.key, currency),
      enabled: live && categoriesOn && lineIds.has(read.id),
      queryFn: (q) => fetchAllLines(month, read.direction, read.key, currency, q, read.keptOut),
    })),
  });
  // FLOW-1210: the date and amount orders' one read of a direction starts with the page, whatever the breakdowns have
  // answered: its rows name their group, and are filed under the breakdown's categories once both are in.
  const allQueries = useQueries({
    queries: DIRECTIONS.map((direction) => ({
      queryKey: linesCacheKey(preview, monthRange, direction, "all", currency),
      enabled: live && categoriesOn && linesAll && currencyKnown,
      queryFn: (q) => fetchDirectionLines(month, direction, currency, q),
    })),
  });
  const allRows = [allQueries[0]?.data, allQueries[1]?.data] as const;
  const breakdownsAt = [categoryIncome.dataUpdatedAt, categoryExpense.dataUpdatedAt] as const;
  // Both are in (the lines and the breakdown, in either order): each counted category's own read is answered too, in the
  // shape and order that read has, so the category order shows these lines at once, with no read. The categories are those
  // the breakdown lists for this month now.
  useEffect(() => {
    DIRECTIONS.forEach((direction, index) => {
      const rows = allRows[index];
      const breakdown = client.getQueryData<NonNullable<typeof categoryIncome.data>>(["breakdown", "company-profit", preview, monthRange, "category", direction]);
      if (rows == null || breakdown == null) return;
      for (const group of groupsIn(breakdown, currency)) {
        if (group.key !== "") client.setQueryData(linesCacheKey(preview, monthRange, direction, group.key, currency), keyedRowsOf(rows, group.key));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the rows and the breakdowns' read times are the triggers
  }, [client, preview, monthRange, currency, allRows[0], allRows[1], breakdownsAt[0], breakdownsAt[1]]);
  // A read that failed in another view or order stays in the cache with its error: only a view that reads it
  // counts it.
  const failed = projectsOn && (dashboard.isError || (projectsDrawn && (projectIncome.isError || projectExpense.isError))
    || (categoriesOn && (categoryIncome.isError || categoryExpense.isError)));
  // FLOW-1207: the one read of a direction's lines failing is the list's own line with its retry, as a category's read
  // was, and the month's figures stay.
  const allFailed = categoriesOn && linesAll && allQueries.some((query) => query.isError);
  const allLoading = categoriesOn && linesAll && !allFailed && allQueries.some((query) => query.isPending);
  const ytdTotals = ytdDashboard.data == null ? null : monthTotals(ytdDashboard.data, currency);
  const ready = figuresIn && (!projectsDrawn || (projectIncome.data !== undefined && projectExpense.data !== undefined));
  const inputs: ProfitInputs | null = ready
    ? {
        currency,
        basis: dashboard.data.basis,
        month: monthTotals(dashboard.data, currency),
        ytdProfit: ytdTotals == null ? null : ytdTotals.income - ytdTotals.expense,
        projects: { income: projectIncome.data ?? null, expense: projectExpense.data ?? null },
        categories: { income: categoryIncome.data ?? null, expense: categoryExpense.data ?? null },
        lines: linesAll
          // Each direction's rows filed under the categories the breakdown lists, in its order, as the per-category reads were.
          ? categoryGroups.flatMap(({ direction, group }) => {
              const rows = allRows[DIRECTIONS.indexOf(direction)];
              return rows == null ? [] : [{ direction, categoryKey: group.key, categoryName: group.name ?? "", rows: rows.filter((row) => row.group_key === group.key) }];
            })
          : lineReads.flatMap((read, index) => {
              const rows = lineQueries[index]?.data;
              return rows == null ? [] : [{ direction: read.direction, categoryKey: read.key, categoryName: read.name, rows, keptOut: read.keptOut }];
            }),
      }
    : null;
  return {
    failed,
    /** FLOW-1207: where the date and amount orders' one read of every line stands: loading, or failed (retryAll reads again). */
    allState: allFailed ? "failed" : allLoading ? "loading" : null,
    retryAll: () => { for (const query of allQueries) if (query.isError) void query.refetch(); },
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
      if (projectReads) {
        void projectIncome.refetch();
        void projectExpense.refetch();
      }
      if (categoriesOn) {
        void categoryIncome.refetch();
        void categoryExpense.refetch();
      }
      if (categoriesOn && linesAll) for (const query of allQueries) if (query.isError) void query.refetch();
    },
  };
}
