import { formatAmountText, type Breakdown } from "@flow/shared";
import { projectGroupRow } from "./breakdown-project-group";
import type { OverheadProject } from "./overhead-project";
import type { CompanyYears, YearFigures } from "./company-years";
import { HEBREW_MONTHS } from "./ui/date-math";

/**
 * The lists under the year and since-the-start views (canvas note spec-years), pure: a year's months or its
 * projects, and the years. Each row has its income, its counted expenses and its profit; what it opens is
 * the screen's to wire (`opens`).
 */

export type YearRow = {
  key: string;
  title: string;
  incomeMinor: bigint;
  expenseMinor: bigint;
  profitMinor: bigint;
  /**
   * What a tap opens: the month view (this month's row), a year (since the start's rows), a project's profit
   * page (the overhead project's row among them); none for a closed month, the finished projects' row or כללי.
   */
  opens: { kind: "month" } | { kind: "year"; year: string } | { kind: "project"; projectId: string } | null;
};

/** Under a row's title: "הכנסות $X · הוצאות $Y", or the expenses alone when nothing came in. */
export function yearRowMeta(row: Pick<YearRow, "incomeMinor" | "expenseMinor">, currency: string): string {
  const expense = `הוצאות ${formatAmountText(row.expenseMinor, currency)}`;
  return row.incomeMinor === 0n ? expense : `הכנסות ${formatAmountText(row.incomeMinor, currency)} · ${expense}`;
}

/** A year's months, newest first; this month's row ("אוקטובר · עד היום") opens the month view. */
export function yearMonthRows(year: YearFigures): YearRow[] {
  return [...year.months].reverse().map((month, index) => {
    const now = year.current && index === 0;
    const name = HEBREW_MONTHS[Number(month.key.slice(5, 7)) - 1] ?? month.key;
    return {
      key: month.key,
      title: now ? `${name} · עד היום` : name,
      incomeMinor: month.incomeMinor,
      expenseMinor: month.expenseMinor,
      profitMinor: month.incomeMinor - month.expenseMinor,
      opens: now ? { kind: "month" } : null,
    };
  });
}

/** Since the start's list, "לפי שנה": a row per year, newest first, each opening its year. */
export function allTimeYearRows(data: CompanyYears): YearRow[] {
  return [...data.years].reverse().map((year) => ({
    key: year.year,
    title: year.current ? `${year.year} · עד היום` : year.year,
    incomeMinor: year.incomeMinor,
    expenseMinor: year.expenseMinor,
    profitMinor: year.profitMinor,
    opens: { kind: "year", year: year.year },
  }));
}

/** A project's status as the dashboard lists it. */
export type ProjectStatus = { id: string; status: string };

/**
 * A year's projects from the year's two project breakdowns (income and expense, in the currency): a row per
 * project, opening its profit page; the finished ones summed into one row, "פרויקטים שהסתיימו · 4"; the general
 * costs in one row, under the overhead project's name and opening it, or כללי when none is set (projectGroupRow).
 * The overhead project is never folded into the finished row. The biggest profit first.
 */
export function yearProjectRows(
  breakdowns: { income: Breakdown | null; expense: Breakdown | null },
  currency: string,
  statuses: readonly ProjectStatus[],
  overhead: OverheadProject | null,
): YearRow[] {
  const finishedIds = new Set(statuses.filter((project) => project.status === "finished" && project.id !== overhead?.id).map((project) => project.id));
  const rows = new Map<string, YearRow>();
  const finished = { income: 0n, expense: 0n, ids: new Set<string>() };
  for (const direction of ["income", "expense"] as const) {
    for (const group of breakdowns[direction]?.groups ?? []) {
      if (group.currency !== currency) continue;
      const { key, title, projectId } = projectGroupRow(group, overhead);
      if (projectId != null && finishedIds.has(projectId)) {
        finished[direction] += group.amount_minor;
        finished.ids.add(projectId);
        continue;
      }
      const row = rows.get(key) ?? {
        key,
        title,
        incomeMinor: 0n,
        expenseMinor: 0n,
        profitMinor: 0n,
        opens: projectId == null ? null : { kind: "project" as const, projectId },
      };
      if (direction === "income") row.incomeMinor += group.amount_minor;
      else row.expenseMinor += group.amount_minor;
      row.profitMinor = row.incomeMinor - row.expenseMinor;
      rows.set(key, row);
    }
  }
  const list = [...rows.values()];
  if (finished.ids.size > 0) {
    list.push({
      key: "finished",
      title: `פרויקטים שהסתיימו · ${String(finished.ids.size)}`,
      incomeMinor: finished.income,
      expenseMinor: finished.expense,
      profitMinor: finished.income - finished.expense,
      opens: null,
    });
  }
  return list.sort((a, b) => (a.profitMinor === b.profitMinor ? a.title.localeCompare(b.title, "he") : a.profitMinor > b.profitMinor ? -1 : 1));
}
