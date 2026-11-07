import "../ui/lazy.css";
import type { CashMonths, ForecastOverrideRow, ProjectCashRow } from "@flow/shared";
import { useMemo, type ReactNode } from "react";
import { NOT_IN_PROFIT_LABEL } from "../cash";
import { companyExpenseNote, companyForecastCaption, companyIncomeNote, type CompanyNextMonth } from "../company-next-month";
import { restExpenseNote } from "../company-year-forecast";
import { forecastMonthSearch } from "../forecast-page-month";
import type { RentCategory } from "../next-month-chart";
import { useProjectsCashMonth } from "../project-cash";
import { LOAN_SOURCE, nextMonthKey } from "../project-next-month";
import { nothingExpected, thisMonthCashOut, useCompanyCashNextMonth } from "./company-cash-next-month";
import { orderParts, partHint, partRows } from "./company-next-month-screen";
import { groupSums, type ActivityGroup, type ActivityRow, type HomeFuture } from "./home-activity";
import { monthName, type HomeFutureFigureRows } from "./home-parts";
import { futureForecastKey } from "../forecast-skip";

/**
 * FLOW-1056 (owner, 2026-11-05: "Click on a future month should take me to the main screen in a future date with
 * its data"): Home on next month. The company's cash forecast for next month, the reads the drawer's card used
 * (FLOW-1036) and the פירוט ועריכה page lists (CompanyNextMonthScreen): its figures go on the band, its rows are
 * the month's activity. Home loads this in its own chunk, so the forecast's reads stay out of Home's first load.
 */

/** The forecast's rows by project, as the צפי page orders them (the general costs last), each still due. */
export function homeFutureGroups({ forecast, projects, currency, search }: {
  forecast: CompanyNextMonth;
  projects: readonly ProjectCashRow[];
  currency: string;
  search: string;
}): ActivityGroup[] {
  if (nothingExpected(forecast) && (forecast.skipped ?? []).length === 0 && !forecast.parts.some((part) => (part.skipped ?? []).length > 0)) return [];
  const names = new Map(projects.map((row) => [row.id, row.name]));
  const overhead = projects.find((row) => row.is_overhead) ?? null;
  const forecastKey = futureForecastKey(forecast, currency);
  // Each row opens its project's צפי page; a general row the overhead project's (FLOW-1002: its צפי page is the
  // general costs), and none when the company has none. Editing is פירוט ועריכה's (the band's foot row).
  const hrefOf = (partProject: string | null) => {
    const projectId = partProject == null ? overhead?.id ?? null : partProject;
    return projectId == null ? undefined : `/projects/${projectId}/profit/next${search}`;
  };
  const groups = orderParts(forecast.parts, projects, currency).flatMap((part) => {
    const general = part.projectId == null;
    const href = hrefOf(part.projectId);
    const rows: ActivityRow[] = partRows(part).map((item) => (item.kind === "kept"
      ? { key: "kept", title: NOT_IN_PROFIT_LABEL, meta: LOAN_SOURCE, mark: "due", minor: item.minor, currency, income: false, setAside: true, href }
      : {
          key: item.row.key,
          title: item.row.name,
          meta: partHint(item.row, part.forecast.averageMonths, part.forecast.month),
          mark: "due",
          minor: item.row.minor < 0n ? -item.row.minor : item.row.minor,
          currency,
          income: item.row.minor >= 0n,
          href,
          forecastKey: forecastKey(item.row.key, part.projectId),
        }));
    if (rows.length === 0) return [];
    const title = general ? "כללי" : names.get(part.projectId ?? "") ?? "פרויקט";
    return [{ id: part.projectId ?? "general", title, rows, ...groupSums(rows, currency), due: true }];
  });
  // FLOW-1096: from every part, a project left with no row included, so it can still be put back.
  const taken = forecast.skipped ?? forecast.parts.flatMap((part) => (part.forecast.skipped ?? []).map((row) => ({ projectId: part.projectId, row })));
  const skipped = taken.map(({ projectId, row }): ActivityRow => ({
    key: `${projectId ?? "general"}:${row.key}`,
    title: row.name,
    meta: `לא צפוי ב${monthName(forecast.month)}`,
    mark: "due",
    minor: row.minor < 0n ? -row.minor : row.minor,
    currency,
    income: row.minor >= 0n,
    href: hrefOf(projectId),
    forecastKey: forecastKey(row.key, projectId),
  }));
  // FLOW-1079: what was taken out of this month sits last, under the same head as on the current month.
  return skipped.length === 0 ? groups : [...groups, { id: "skipped", title: "הוצא מהצפי", rows: skipped, ...groupSums(skipped, currency), due: true }];
}

/** FLOW-1066 (mockup): a month after next says what its estimate is built from, in the caption's place. */
export const FAR_MONTH_CAPTION = "לפי קבועים, הלוואות וממוצע 6 חודשים";

/**
 * The band's figures: the expected net, in and out, and their lines, as the drawer's card wrote them. FLOW-1066:
 * a month after next compares its expenses with nothing (קבועים וממוצעים) and its caption is FAR_MONTH_CAPTION;
 * `profitMinor` is the month's expected profit, for the פירוט ועריכה row.
 */
export function homeFutureFigures(forecast: CompanyNextMonth, categories: readonly RentCategory[], thisMonthOut: bigint | null, today: string, currency: string, profitMinor: bigint): HomeFutureFigureRows {
  const far = forecast.month !== nextMonthKey(today);
  // "מול $0" never shows: until this month's cash is read the line waits.
  const nextNote = thisMonthOut == null ? "" : companyExpenseNote(forecast, today.slice(0, 7), thisMonthOut, currency);
  return {
    currency,
    netMinor: forecast.netMinor,
    incomeMinor: forecast.incomeMinor,
    expenseMinor: forecast.expenseMinor,
    incomeNote: companyIncomeNote(forecast, categories),
    expenseNote: far ? restExpenseNote(forecast) : nextNote,
    caption: far ? FAR_MONTH_CAPTION : companyForecastCaption(forecast),
    profitMinor,
  };
}

/**
 * What Home draws for a month to come from the reads; stories and the dev route call it with a sample. FLOW-1066:
 * the month is the forecast's; its rows open their project's צפי page for that month.
 */
export function homeFutureView({ forecast, profitMinor, categories, projects, cash, today, currency, search, loading, failed, offline, onRetry, overrides = null }: {
  /** The month's forecast in cash terms (companyCashForecast). */
  forecast: CompanyNextMonth | null;
  /** The same month's expected profit (the profit-basis net); null with the forecast. */
  profitMinor: bigint | null;
  categories: readonly RentCategory[];
  projects: readonly ProjectCashRow[];
  /** Home's cash months: this month's cash out, which the expense line compares with. */
  cash: NonNullable<CashMonths> | null;
  /** yyyy-mm-dd. */
  today: string;
  currency: string;
  search: string;
  loading: boolean;
  failed: boolean;
  offline: boolean;
  onRetry: () => void;
  /** FLOW-1079: the month's forecast overrides, for a skip's undo. */
  overrides?: readonly ForecastOverrideRow[] | null;
}): HomeFuture {
  if (failed) return { phase: "failed", offline, onRetry, figures: null, groups: [] };
  if (loading || forecast == null || profitMinor == null) return { phase: "loading", offline, onRetry, figures: null, groups: [] };
  return {
    phase: "ready",
    offline,
    onRetry,
    overrides,
    figures: homeFutureFigures(forecast, categories, thisMonthCashOut(cash, today, currency), today, currency, profitMinor),
    groups: homeFutureGroups({ forecast, projects, currency, search: forecastMonthSearch(search, forecast.month, today) }),
  };
}

/** The reads for a month to come on Home (`month`, FLOW-1066: any month of the forecast); `children` draws Home with them. */
export function HomeFutureReads({ today, month, currency, cash, search, children }: {
  today: string;
  /** yyyy-mm, a month of the forecast. */
  month: string;
  currency: string;
  cash: NonNullable<CashMonths> | null;
  search: string;
  children: (future: HomeFuture) => ReactNode;
}) {
  const next = useCompanyCashNextMonth(currency, today, true, undefined, month);
  // The Projects tab's rows, for the groups' names and order; a failed read leaves the names as פרויקט.
  const list = useProjectsCashMonth();
  const projects = list.data?.projects;
  const loading = next.loading || (list.isPending && !list.isError);
  // A read waiting for the network says so, with its retry, as a failed one does.
  const failed = next.failed || next.paused;
  const { forecast, profitMinor, categories, paused, refetch, overrides } = next;
  const { isError: listFailed, refetch: refetchList } = list;
  // FLOW-1052: the groups and figures are built once per read, not on every render of Home (a scroll, a dock).
  const future = useMemo(() => homeFutureView({
    forecast,
    profitMinor,
    categories,
    projects: projects ?? [],
    cash,
    today,
    currency,
    search,
    loading,
    failed,
    offline: paused,
    onRetry: () => {
      void refetch();
      if (listFailed) void refetchList();
    },
    overrides,
  }), [forecast, profitMinor, categories, projects, cash, today, currency, search, loading, failed, paused, refetch, listFailed, refetchList, overrides]);
  return children(future);
}
