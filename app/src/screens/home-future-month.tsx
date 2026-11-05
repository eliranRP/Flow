import type { CashMonths, ProjectCashRow } from "@flow/shared";
import type { ReactNode } from "react";
import { NOT_IN_PROFIT_LABEL } from "../cash";
import { companyExpenseNote, companyForecastCaption, companyIncomeNote, type CompanyNextMonth } from "../company-next-month";
import type { RentCategory } from "../next-month-chart";
import { useProjectsCashMonth } from "../project-cash";
import { LOAN_SOURCE } from "../project-next-month";
import { useHoldWrites } from "../use-is-viewer";
import { nothingExpected, thisMonthCashOut, useCompanyCashNextMonth } from "./company-cash-next-month";
import { orderParts, partHint, partRows } from "./company-next-month-screen";
import { groupSums, type ActivityGroup, type ActivityRow, type HomeFuture } from "./home-activity";
import type { HomeFutureFigureRows } from "./home-parts";
import { editPath } from "./project-next-month-screen";

/**
 * FLOW-1056 (owner, 2026-11-05: "Click on a future month should take me to the main screen in a future date with
 * its data"): Home on next month. The company's cash forecast for next month, the reads the drawer's card used
 * (FLOW-1036) and the פירוט ועריכה page lists (CompanyNextMonthScreen): its figures go on the band, its rows are
 * the month's activity. Home loads this in its own chunk, so the forecast's reads stay out of Home's first load.
 */

/** The forecast's rows by project, as the צפי page orders them (the general costs last), each still due. */
export function homeFutureGroups({ forecast, projects, currency, search, hold }: {
  forecast: CompanyNextMonth;
  projects: readonly ProjectCashRow[];
  currency: string;
  search: string;
  /** A viewer: the rows open nothing (the צפי page's edit is the owner's and an editor's). */
  hold: boolean;
}): ActivityGroup[] {
  if (nothingExpected(forecast)) return [];
  const names = new Map(projects.map((row) => [row.id, row.name]));
  const overhead = projects.find((row) => row.is_overhead) ?? null;
  return orderParts(forecast.parts, projects, currency).flatMap((part) => {
    const general = part.projectId == null;
    // FLOW-1002: a general row opens the overhead project's edit page, and none when the company has none.
    const projectId = general ? overhead?.id ?? null : part.projectId;
    const rows: ActivityRow[] = partRows(part).map((item) => (item.kind === "kept"
      ? { key: "kept", title: NOT_IN_PROFIT_LABEL, meta: LOAN_SOURCE, mark: "due", minor: item.minor, currency, income: false, setAside: true }
      : {
          key: item.row.key,
          title: item.row.name,
          meta: partHint(item.row, part.forecast.averageMonths, part.forecast.month),
          mark: "due",
          minor: item.row.minor < 0n ? -item.row.minor : item.row.minor,
          currency,
          income: item.row.minor >= 0n,
          href: hold || projectId == null ? undefined : `${editPath(projectId, item.row.key)}${search}`,
        }));
    if (rows.length === 0) return [];
    const title = general ? "כללי" : names.get(part.projectId ?? "") ?? "פרויקט";
    return [{ id: part.projectId ?? "general", title, rows, ...groupSums(rows, currency), due: true }];
  });
}

/** The band's figures: the expected net, in and out, and their lines, as the drawer's card wrote them. */
export function homeFutureFigures(forecast: CompanyNextMonth, categories: readonly RentCategory[], thisMonthOut: bigint | null, today: string, currency: string): HomeFutureFigureRows {
  return {
    currency,
    netMinor: forecast.netMinor,
    incomeMinor: forecast.incomeMinor,
    expenseMinor: forecast.expenseMinor,
    incomeNote: companyIncomeNote(forecast, categories),
    // "מול $0" never shows: until this month's cash is read the line waits.
    expenseNote: thisMonthOut == null ? "" : companyExpenseNote(forecast, today.slice(0, 7), thisMonthOut, currency),
    caption: companyForecastCaption(forecast),
  };
}

/** What Home draws for next month from the reads; stories and the dev route call it with a sample. */
export function homeFutureView({ forecast, categories, projects, cash, today, currency, search, hold, loading, failed, offline, onRetry }: {
  forecast: CompanyNextMonth | null;
  categories: readonly RentCategory[];
  projects: readonly ProjectCashRow[];
  /** Home's cash months: this month's cash out, which the expense line compares with. */
  cash: NonNullable<CashMonths> | null;
  /** yyyy-mm-dd. */
  today: string;
  currency: string;
  search: string;
  hold: boolean;
  loading: boolean;
  failed: boolean;
  offline: boolean;
  onRetry: () => void;
}): HomeFuture {
  if (failed) return { phase: "failed", offline, onRetry, figures: null, groups: [] };
  if (loading || forecast == null) return { phase: "loading", offline, onRetry, figures: null, groups: [] };
  return {
    phase: "ready",
    offline,
    onRetry,
    figures: homeFutureFigures(forecast, categories, thisMonthCashOut(cash, today, currency), today, currency),
    groups: homeFutureGroups({ forecast, projects, currency, search, hold }),
  };
}

/** The reads for next month on Home; `children` draws Home with them. */
export function HomeFutureReads({ today, currency, cash, search, children }: {
  today: string;
  currency: string;
  cash: NonNullable<CashMonths> | null;
  search: string;
  children: (future: HomeFuture) => ReactNode;
}) {
  const next = useCompanyCashNextMonth(currency, today, true);
  // The Projects tab's rows, for the groups' names and order; a failed read leaves the names as פרויקט.
  const list = useProjectsCashMonth();
  const hold = useHoldWrites();
  const future = homeFutureView({
    forecast: next.forecast,
    categories: next.categories,
    projects: list.data?.projects ?? [],
    cash,
    today,
    currency,
    search,
    hold,
    loading: next.loading || (list.isPending && !list.isError),
    // A read waiting for the network says so, with its retry, as a failed one does.
    failed: next.failed || next.paused,
    offline: next.paused,
    onRetry: () => {
      void next.refetch();
      if (list.isError) void list.refetch();
    },
  });
  return children(future);
}
