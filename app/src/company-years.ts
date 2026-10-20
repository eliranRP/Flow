import { formatAmountText, type ProfitMonth } from "@flow/shared";
import type { SummaryLine } from "./company-profit-rows";
import type { RestOfYear } from "./company-year-forecast";
import { profitMonthFigures } from "./next-month-chart";
import { shortMonth } from "./party-charges";
import { shiftMonthKey } from "./period";
import { HEBREW_MONTHS } from "./ui/date-math";
import type { ChartMonth } from "./ui/month-chart-scale";

/**
 * The company profit page's year and since-the-start views (canvas note spec-years, decision 0200), pure: the
 * company's profit months (one get_profit_months read since the start) by year, and what each view's head
 * says: the sub, the summary rows, the chart's months, sub and spoken label.
 */

/** A month's two figures, positive, in minor units. */
export type MonthTotals = { key: string; incomeMinor: bigint; expenseMinor: bigint };

export type YearFigures = {
  /** yyyy */
  year: string;
  incomeMinor: bigint;
  expenseMinor: bigint;
  profitMinor: bigint;
  /** January to December, or to this month in the current year (to date), zeros filled. */
  months: MonthTotals[];
  /** This year, to date. */
  current: boolean;
};

export type CompanyYears = {
  /** yyyy-mm, the first month with a counted line; null when none has one. */
  first: string | null;
  /** Oldest first, from the first month's year to this year. */
  years: YearFigures[];
};

/** How far back the since-the-start read goes: get_profit_months takes at most 240 months. */
export const YEARS_BACK = 20;

/** The since-the-start read's range: January twenty years back (19 years and this one) to today. */
export function yearsRange(today: string): { from: string; to: string } {
  return { from: `${String(Number(today.slice(0, 4)) - (YEARS_BACK - 1))}-01-01`, to: today };
}

function monthName(key: string): string {
  return HEBREW_MONTHS[Number(key.slice(5, 7)) - 1] ?? key;
}

/**
 * The months by year, in the currency: the months after this one drop out, and so do the empty years before the
 * first month with a counted line. With no line at all, this year alone, empty.
 */
export function companyYears(months: readonly ProfitMonth[], currency: string, today: string): CompanyYears {
  const current = today.slice(0, 7);
  const figures = profitMonthFigures(months, currency);
  const filled = [...figures.entries()]
    .filter(([key, value]) => key <= current && (value.incomeMinor !== 0n || value.expenseMinor !== 0n))
    .map(([key]) => key)
    .sort();
  const first = filled[0] ?? null;
  const lastYear = Number(current.slice(0, 4));
  const firstYear = first == null ? lastYear : Number(first.slice(0, 4));
  const years: YearFigures[] = [];
  for (let year = firstYear; year <= lastYear; year += 1) {
    const isCurrent = year === lastYear;
    const end = isCurrent ? current : `${String(year)}-12`;
    const list: MonthTotals[] = [];
    for (let key = `${String(year)}-01`; key <= end; key = shiftMonthKey(key, 1)) {
      const value = figures.get(key);
      list.push({ key, incomeMinor: value?.incomeMinor ?? 0n, expenseMinor: value?.expenseMinor ?? 0n });
    }
    const incomeMinor = list.reduce((sum, month) => sum + month.incomeMinor, 0n);
    const expenseMinor = list.reduce((sum, month) => sum + month.expenseMinor, 0n);
    years.push({ year: String(year), incomeMinor, expenseMinor, profitMinor: incomeMinor - expenseMinor, months: list, current: isCurrent });
  }
  return { first, years };
}

/** Since the start: every year's figures summed. */
export function allTimeTotals(data: CompanyYears): { incomeMinor: bigint; expenseMinor: bigint; profitMinor: bigint } {
  const incomeMinor = data.years.reduce((sum, year) => sum + year.incomeMinor, 0n);
  const expenseMinor = data.years.reduce((sum, year) => sum + year.expenseMinor, 0n);
  return { incomeMinor, expenseMinor, profitMinor: incomeMinor - expenseMinor };
}

/** The year view's sub: "2026 · עד היום, 20/10", or "2025 · שנה סגורה". */
export function yearSub(year: YearFigures, today: string): string {
  return year.current ? `${year.year} · עד היום, ${today.slice(8, 10)}/${today.slice(5, 7)}` : `${year.year} · שנה סגורה`;
}

function yearsWord(count: number): string {
  if (count === 1) return "שנה אחת";
  if (count === 2) return "שנתיים";
  return `${String(count)} שנים`;
}

/** Since the start's sub: "מאז ינואר 2024 · 3 שנים" (the calendar years it spans, this one counted). */
export function allTimeSub(data: CompanyYears, today: string): string {
  const first = data.first ?? today.slice(0, 7);
  return `מאז ${monthName(first)} ${first.slice(0, 4)} · ${yearsWord(data.years.length)}`;
}

/**
 * The year's summary: הכנסות, הוצאות שנספרות ברווח, the year's profit (bold; "עד היום" in this year) and, when
 * the company has the year before, that whole year's profit to compare.
 */
export function yearSummaryRows(data: CompanyYears, year: YearFigures): SummaryLine[] {
  const rows: SummaryLine[] = [
    { id: "income", label: "הכנסות", minor: year.incomeMinor, strong: false },
    { id: "expense", label: "הוצאות שנספרות ברווח", minor: year.expenseMinor, strong: false },
    { id: "profit", label: `רווח ${year.year}${year.current ? " עד היום" : ""}`, minor: year.profitMinor, strong: true },
  ];
  const before = data.years.find((row) => Number(row.year) === Number(year.year) - 1);
  if (before != null) rows.push({ id: "compare", label: `רווח ${before.year} כולה`, minor: before.profitMinor, strong: false });
  return rows;
}

/**
 * Since the start's summary: הכנסות, הוצאות שנספרות ברווח, bold רווח מתחילת הדרך and the most profitable closed
 * year (this year, still to date, does not compete).
 */
export function allTimeSummaryRows(data: CompanyYears): SummaryLine[] {
  const totals = allTimeTotals(data);
  const rows: SummaryLine[] = [
    { id: "income", label: "הכנסות", minor: totals.incomeMinor, strong: false },
    { id: "expense", label: "הוצאות שנספרות ברווח", minor: totals.expenseMinor, strong: false },
    { id: "profit", label: "רווח מתחילת הדרך", minor: totals.profitMinor, strong: true },
  ];
  const best = data.years
    .filter((year) => !year.current)
    .reduce<YearFigures | null>((most, year) => (most == null || year.profitMinor > most.profitMinor ? year : most), null);
  if (best != null) rows.push({ id: "compare", label: `השנה הרווחית ביותר · ${best.year}`, minor: best.profitMinor, strong: false });
  return rows;
}

/** A year's chart: its months solid (to date in this year), and the rest of this year dashed after them. */
export type YearChart = { history: ChartMonth[]; forecast: ChartMonth[]; sub: string; label: string };

/** The chart under the year's head: "הכנסות והוצאות לפי חודש", January to this month, then the months left. */
export function yearChart(year: YearFigures, rest: RestOfYear | null, restCaption: string): YearChart {
  const ahead = year.current && rest != null ? rest.months : [];
  return {
    history: year.months.map((month) => ({ ...month, label: shortMonth(month.key) })),
    forecast: ahead.map((month) => ({ key: month.month, label: shortMonth(month.month), incomeMinor: month.incomeMinor, expenseMinor: month.expenseMinor })),
    sub: ahead.length > 0 ? `${year.year} וצפי לסוף השנה` : year.year,
    label: `הכנסות והוצאות לפי חודש ב־${year.year}${ahead.length > 0 ? `, וצפי ל${restCaption}` : ""}`,
  };
}

/**
 * Since the start's chart, "הכנסות והוצאות לפי שנה": a pair per year, this year solid to date with a dashed cap
 * for the rest of the year (the תזרים צפוי form).
 */
export function allTimeChart(data: CompanyYears, rest: RestOfYear | null, currency: string): { months: ChartMonth[]; sub: string; label: string } {
  const cap = rest != null && (rest.incomeMinor > 0n || rest.expenseMinor > 0n) ? { incomeMinor: rest.incomeMinor, expenseMinor: rest.expenseMinor } : null;
  const months = data.years.map((year): ChartMonth => {
    const ahead = year.current ? cap : null;
    return {
      key: year.year,
      label: ahead != null ? `${year.year} · צפי` : year.year,
      incomeMinor: year.incomeMinor,
      expenseMinor: year.expenseMinor,
      ...(ahead != null ? { ahead } : {}),
    };
  });
  const first = data.years[0]?.year ?? "";
  const last = data.years.at(-1);
  const money = (minor: bigint) => formatAmountText(minor, currency);
  const parts = data.years.map((year) => (year.current ? `${year.year} עד היום ${money(year.incomeMinor)}` : `${year.year} ${money(year.incomeMinor)}`));
  return {
    months,
    sub: cap != null ? `מאז ${first} וצפי לסוף ${last?.year ?? ""}` : `מאז ${first}`,
    label: `הכנסות לפי שנה: ${parts.join(", ")}${cap != null && last != null ? ` וצפי לסוף השנה ${money(last.incomeMinor + cap.incomeMinor)}` : ""}`,
  };
}
